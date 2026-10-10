import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REPORT_SCHEMA_VERSION, ReportEnvelope, type ExecutedRunResult } from '#report/schema.js';
import * as reportAssertions from '../../support/report-assertions.js';
import { judgeSmokeReport } from '../../verification/memos/support/judge.js';

const temporaryDirectories: string[] = [];
const password = 'memos-test-password-549';

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function validReport() {
  return ReportEnvelope.parse({
    schemaVersion: REPORT_SCHEMA_VERSION,
    command: 'run',
    startedAt: '2026-01-01T00:00:00Z',
    durationMs: 1,
    summary: { total: 1, passed: 1, failed: 0, errored: 0, skipped: 0 },
    errors: [],
    reportPersistence: 'persisted',
    results: [{
      id: 'case-a', file: 'case-a.test.md', planFile: 'case-a.ambercast.plan.json',
      status: 'passed', durationMs: 1, aiCalls: 0, steps: [], sessions: {}, explanation: '',
    }],
  });
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'memos-judge-'));
  temporaryDirectories.push(root);
  const runs = join(root, '.runs');
  mkdirSync(runs);
  return { root, runs, report: validReport(), secrets: { password } };
}

function persist(runs: string, name: string, report: unknown, timestamp?: number) {
  const directory = join(runs, name);
  mkdirSync(directory);
  const path = join(directory, 'report.json');
  writeFileSync(path, JSON.stringify(report));
  if (timestamp !== undefined) {
    utimesSync(path, timestamp, timestamp);
    utimesSync(directory, timestamp, timestamp);
  }
}

type Fixture = ReturnType<typeof fixture>;
type Violation = { name: string; inject: (input: Fixture) => unknown };

const violations: Violation[] = [
  { name: 'nonzero aiCalls', inject: ({ report }) => ({ ...report, results: [{ ...report.results[0], aiCalls: 1 }] }) },
  { name: 'missing aiCalls', inject: ({ report }) => {
    const { aiCalls: _aiCalls, ...result } = report.results[0] as ExecutedRunResult;
    return { ...report, results: [result] };
  } },
  { name: 'two results', inject: ({ report }) => ({
    ...report, summary: { ...report.summary, total: 2, passed: 2 },
    results: [report.results[0], { ...report.results[0], id: 'case-b' }],
  }) },
  { name: 'failed result without evidence', inject: ({ report }) => ({
    ...report, summary: { ...report.summary, passed: 0, failed: 1 },
    results: [{ ...report.results[0], status: 'failed' }],
  }) },
  { name: 'errored result without matching case error', inject: ({ report }) => ({
    ...report, summary: { ...report.summary, passed: 0, errored: 1 },
    results: [{ ...report.results[0], status: 'error' }],
  }) },
  { name: 'password in artifacts', inject: ({ root, report }) => {
    writeFileSync(join(root, 'leaked.txt'), password);
    return report;
  } },
  { name: 'password in report', inject: ({ report }) => ({
    ...report, results: [{ ...report.results[0], explanation: password }],
  }) },
  { name: 'invalid schema', inject: ({ report }) => ({ ...report, schemaVersion: 'invalid' }) },
  { name: 'no persisted report', inject: ({ report }) => report },
  { name: 'persisted report differs', inject: ({ report }) => report },
];

describe('judgeSmokeReport', () => {
  it('TEST-43 passes on a fully valid report and artifacts', async () => {
    const { root, runs, report, secrets } = fixture();
    persist(runs, 'replay', report);
    await expect(judgeSmokeReport({ report, artifactRoots: [root], secrets })).resolves.toBeUndefined();
  });

  it.each(violations)('TEST-44 rejects $name', async ({ name, inject }) => {
    const input = fixture();
    const report = inject(input);
    if (name !== 'no persisted report') {
      const stored = name === 'persisted report differs'
        ? { ...input.report, durationMs: 2 }
        : report;
      persist(input.runs, 'replay', stored);
    }
    await expect(judgeSmokeReport({
      report, artifactRoots: [input.root], secrets: input.secrets,
    })).rejects.toThrow(/assertDiagnosable:|assertZeroAiCalls:|assertNoSecretDisclosure:|judgeSmokeReport:/);
  });

  it('TEST-44 selects only the latest replay report after regenerate', async () => {
    const { root, runs, report, secrets } = fixture();
    persist(runs, 'resolve', {
      ...report, results: [{ ...report.results[0], aiCalls: 1 }],
    }, 1_700_000_000);
    persist(runs, 'replay', report, 1_700_000_100);
    await expect(judgeSmokeReport({ report, artifactRoots: [root], secrets })).resolves.toBeUndefined();
  });

  it('TEST-44 disclosure-only accepts diagnostic, AI, summary, and identity violations without disclosure', async () => {
    const { root, report, secrets } = fixture();
    writeFileSync(join(root, 'benign.txt'), 'safe artifact');
    const invalid = {
      ...report,
      summary: { ...report.summary, total: 2, passed: 0, failed: 2 },
      results: [{ ...report.results[0], status: 'failed', aiCalls: 1 }, { ...report.results[0], id: 'case-b' }],
    };
    // No persisted report also violates full-mode identity.
    await expect(judgeSmokeReport({ report: invalid, artifactRoots: [root], secrets, mode: 'disclosure-only' }))
      .resolves.toBeUndefined();
  });

  it('TEST-44 disclosure-only rejects disclosure despite diagnostic, AI, summary, and identity violations', async () => {
    const { root, report, secrets } = fixture();
    writeFileSync(join(root, 'benign.txt'), 'safe artifact');
    const invalid = {
      ...report,
      summary: { ...report.summary, total: 2, passed: 0, failed: 2 },
      results: [{ ...report.results[0], status: 'failed', aiCalls: 1, explanation: password }, { ...report.results[0], id: 'case-b' }],
    };
    await expect(judgeSmokeReport({ report: invalid, artifactRoots: [root], secrets, mode: 'disclosure-only' }))
      .rejects.toThrow(/assertNoSecretDisclosure:|judgeSmokeReport:.*violation/);
  });

  it('TEST-44 aggregates distinct AI and result-count violations as separate lines', async () => {
    const { root, runs, report, secrets } = fixture();
    const invalid = {
      ...report,
      summary: { ...report.summary, total: 2, passed: 2 },
      results: [{ ...report.results[0], aiCalls: 1 }, { ...report.results[0], id: 'case-b', aiCalls: 1 }],
    };
    persist(runs, 'replay', invalid);
    const failure = await judgeSmokeReport({ report: invalid, artifactRoots: [root], secrets }).catch((error: Error) => error);
    expect(failure).toBeInstanceOf(Error);
    const message = (failure as Error).message;
    const count = /^judgeSmokeReport: (\d+) violation\(s\)/.exec(message);
    expect(count).not.toBeNull();
    expect(Number(count?.[1])).toBeGreaterThanOrEqual(2);
    const violationLines = message.split('\n').filter((line) => line.startsWith('- '));
    expect(violationLines.some((line) => /aiCalls/.test(line))).toBe(true);
    expect(violationLines.some((line) => /(?:result|total)/.test(line) && !/aiCalls/.test(line))).toBe(true);
  });

  it('TEST-44 verifies identity before collecting storage artifacts', async () => {
    const { root, runs, report, secrets } = fixture();
    persist(runs, 'replay', { ...report, durationMs: 2 });
    const collect = vi.spyOn(reportAssertions, 'collectStorageArtifacts');
    try {
      await expect(judgeSmokeReport({ report, artifactRoots: [root], secrets }))
        .rejects.toThrow(/judgeSmokeReport:[\s\S]*(?:identity|persisted report|report[\s\S]*differ)/i);
      expect(collect).not.toHaveBeenCalled();
    } finally {
      collect.mockRestore();
    }
  });

  it('TEST-44 wraps storage read failures with the judge prefix', async () => {
    const { root, report, secrets } = fixture();
    const missing = join(root, 'missing');
    const failure = await judgeSmokeReport({
      report, artifactRoots: [missing], secrets, mode: 'disclosure-only',
    }).catch((error: Error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/^judgeSmokeReport: cannot read /);
    expect((failure as Error).message).toContain(missing);
  });
});
