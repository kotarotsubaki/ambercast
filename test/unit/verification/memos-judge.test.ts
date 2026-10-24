import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REPORT_SCHEMA_VERSION, ReportEnvelope, type ExecutedRunResult } from '#report/schema.js';
import * as reportAssertions from '../../support/report-assertions.js';
import { judgeSmokeReport } from '../../verification/memos/support/judge.js';
import * as judgeModule from '../../verification/memos/support/judge.js';

// Widen the test boundary so malformed case counts reach runtime validation.
const judgeWithCaseCount = judgeSmokeReport as (input: {
  report: unknown; artifactRoots: readonly string[]; secrets: Record<string, string>;
  expectedCases?: unknown; mode?: 'full' | 'disclosure-only' | 'heal-report';
}) => Promise<void>;
const parseJudgeEnv = (env: NodeJS.ProcessEnv): unknown => {
  const parse = (judgeModule as unknown as {
  parseJudgeEnv: (env: NodeJS.ProcessEnv) => unknown;
  }).parseJudgeEnv;
  expect(parse).toBeTypeOf('function');
  return parse(env);
};

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
  const plan = join(root, 'case-a.ambercast.plan.json');
  const grounding = join(root, 'case-a.ambercast.grounding.json');
  writeFileSync(plan, '{}');
  writeFileSync(grounding, '{}');
  return { root, runs, artifactRoots: [runs, plan, grounding], report: validReport(), secrets: { password } };
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
type Violation = { name: string; expected: RegExp; inject: (input: Fixture) => unknown };

const violations: Violation[] = [
  { name: 'nonzero aiCalls', expected: /assertZeroAiCalls:/, inject: ({ report }) => ({ ...report, results: [{ ...report.results[0], aiCalls: 1 }] }) },
  { name: 'missing aiCalls', expected: /assertZeroAiCalls:/, inject: ({ report }) => {
    const { aiCalls: _aiCalls, ...result } = report.results[0] as ExecutedRunResult;
    return { ...report, results: [result] };
  } },
  { name: 'two results', expected: /summary.total is 2, expected 1/, inject: ({ report }) => ({
    ...report, summary: { ...report.summary, total: 2, passed: 2 },
    results: [report.results[0], { ...report.results[0], id: 'case-b' }],
  }) },
  { name: 'extra skipped result alongside the passing one', expected: /results\.length is 2, expected 1/, inject: ({ report }) => ({
    ...report, results: [report.results[0], { id: 'case-b', file: 'case-b.test.md', status: 'skipped' }],
  }) },
  { name: 'failed result without evidence', expected: /assertDiagnosable:/, inject: ({ report }) => ({
    ...report, summary: { ...report.summary, passed: 0, failed: 1 },
    results: [{ ...report.results[0], status: 'failed' }],
  }) },
  { name: 'errored result without matching case error', expected: /assertDiagnosable:/, inject: ({ report }) => ({
    ...report, summary: { ...report.summary, passed: 0, errored: 1 },
    results: [{ ...report.results[0], status: 'error' }],
  }) },
  { name: 'password in artifacts', expected: /assertNoSecretDisclosure:/, inject: ({ runs, report }) => {
    writeFileSync(join(runs, 'leaked.txt'), password);
    return report;
  } },
  { name: 'password in report', expected: /assertNoSecretDisclosure:/, inject: ({ report }) => ({
    ...report, results: [{ ...report.results[0], explanation: password }],
  }) },
  { name: 'invalid schema', expected: /assertDiagnosable:/, inject: ({ report }) => ({ ...report, schemaVersion: 'invalid' }) },
  { name: 'no persisted report', expected: /no persisted report found in .runs directory/, inject: ({ report }) => report },
  { name: 'persisted report differs', expected: /persisted report differs from provided report/, inject: ({ report }) => report },
];

describe('judgeSmokeReport', () => {
  function sevenCaseReport() {
    const report = validReport();
    return ReportEnvelope.parse({ ...report,
      summary: { total: 7, passed: 7, failed: 0, errored: 0, skipped: 0 },
      results: Array.from({ length: 7 }, (_, index) => ({ ...report.results[0], id: `case-${index}`, file: `case-${index}.test.md` })),
    });
  }
  it('TEST-544-10 accepts seven passing zero-AI cases when seven are expected', async () => {
    const input = fixture();
    const report = sevenCaseReport();
    persist(input.runs, 'replay', report);
    await expect(judgeWithCaseCount({ ...input, report, expectedCases: 7 })).resolves.toBeUndefined();
  });
  it.each(['six rows', 'one failed row', 'summary total six'])(
    'TEST-544-10 aggregates count violations for $0 with seven expected', async variation => {
      const input = fixture();
      const report = sevenCaseReport();
      if (variation === 'six rows') {
        report.results.pop();
        report.summary.total = 6;
        report.summary.passed = 6;
      } else if (variation === 'one failed row') {
        report.results[0] = { ...report.results[0], status: 'failed' } as ExecutedRunResult;
        report.summary.passed = 6;
        report.summary.failed = 1;
      } else report.summary.total = 6;
      persist(input.runs, 'replay', report);
      const failure = await judgeWithCaseCount({ ...input, report, expectedCases: 7 }).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toMatch(/^judgeSmokeReport: \d+ violation\(s\)/);
      expect((failure as Error).message).toMatch(/(?:total|passed|results|result)[^\n]*(?:expected 7|7[^\n]*expected)/);
    },
  );
  it.each([0, -1, 1.5, NaN, '7'])('TEST-544-10 rejects invalid expectedCases %s before artifact collection', async expectedCases => {
    const collect = vi.spyOn(reportAssertions, 'collectStorageArtifacts');
    try {
      await expect(judgeWithCaseCount({ report: null, artifactRoots: [], secrets: {}, expectedCases }))
        .rejects.toBeInstanceOf(typeof expectedCases === 'number' ? RangeError : TypeError);
      expect(collect).not.toHaveBeenCalled();
    } finally { collect.mockRestore(); }
  });

  function healReport() {
    return ReportEnvelope.parse({
      schemaVersion: REPORT_SCHEMA_VERSION,
      command: 'heal',
      startedAt: '2026-01-01T00:00:00Z',
      durationMs: 1,
      summary: { total: 1, passed: 0, failed: 0, errored: 0, skipped: 0 },
      errors: [],
      results: [{
        id: 'case-a', file: 'case-a.test.md', planFile: 'case-a.ambercast.plan.json',
        status: 'completed', repairOutcome: 'healed', application: 'applied', stopReason: 'settled',
        durationMs: 1, aiCalls: 2, steps: [], sessions: {}, explanation: '',
      }],
    });
  }
  it('TEST-544-26 heal-report accepts a conforming heal without replay counts, zero-AI, or storage identity checks', async () => {
    const report = healReport();
    const collect = vi.spyOn(reportAssertions, 'collectStorageArtifacts');
    const zeroAi = vi.spyOn(reportAssertions, 'assertZeroAiCalls');
    const diagnose = vi.spyOn(reportAssertions, 'assertDiagnosable');
    const disclosure = vi.spyOn(reportAssertions, 'assertNoSecretDisclosure');
    try {
      await expect(judgeWithCaseCount({ report, artifactRoots: ['/nonexistent-heal-artifacts'], secrets: { password }, mode: 'heal-report', expectedCases: 7 }))
        .resolves.toBeUndefined();
      expect(collect).not.toHaveBeenCalled();
      expect(zeroAi).not.toHaveBeenCalled();
      expect(diagnose).toHaveBeenCalledWith(report);
      expect(disclosure).toHaveBeenCalledWith({ secrets: { password }, report, artifacts: [] });
    } finally { collect.mockRestore(); zeroAi.mockRestore(); diagnose.mockRestore(); disclosure.mockRestore(); }
  });
  it.each(['invalid schema', 'run command', 'password disclosure'])(
    'TEST-544-26 heal-report rejects $0', async variation => {
      const report = healReport();
      const invalid = variation === 'invalid schema' ? { ...report, schemaVersion: 'invalid' }
        : variation === 'run command' ? validReport()
          : { ...report, results: [{ ...report.results[0], explanation: password }] };
      await expect(judgeWithCaseCount({ report: invalid, artifactRoots: [], secrets: { password }, mode: 'heal-report' }))
        .rejects.toThrow();
    },
  );
  it('TEST-43 passes with the harness artifact roots: .runs directory, plan file, and grounding file', async () => {
    const { artifactRoots, runs, report, secrets } = fixture();
    persist(runs, 'replay', report);
    await expect(judgeSmokeReport({ report, artifactRoots, secrets })).resolves.toBeUndefined();
  });

  it.each(violations)('TEST-44 rejects $name', async ({ name, expected, inject }) => {
    const input = fixture();
    const report = inject(input);
    if (name !== 'no persisted report') {
      const stored = name === 'persisted report differs'
        ? { ...input.report, durationMs: 2 }
        : report;
      persist(input.runs, 'replay', stored);
    }
    await expect(judgeSmokeReport({
      report, artifactRoots: input.artifactRoots, secrets: input.secrets,
    })).rejects.toThrow(expected);
  });

  it('TEST-44 selects only the latest replay report after regenerate', async () => {
    const { artifactRoots, runs, report, secrets } = fixture();
    persist(runs, 'resolve', {
      ...report, results: [{ ...report.results[0], aiCalls: 1 }],
    }, 1_700_000_000);
    persist(runs, 'replay', report, 1_700_000_100);
    await expect(judgeSmokeReport({ report, artifactRoots, secrets })).resolves.toBeUndefined();
  });

  it('TEST-44 accepts a persisted report whose JSON keys are reordered but deeply equal', async () => {
    const { artifactRoots, runs, report, secrets } = fixture();
    const reordered = Object.fromEntries([...Object.entries(report)].reverse());
    mkdirSync(join(runs, 'replay'));
    writeFileSync(join(runs, 'replay', 'report.json'), JSON.stringify(reordered));
    await expect(judgeSmokeReport({ report, artifactRoots, secrets })).resolves.toBeUndefined();
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
    const { artifactRoots, runs, report, secrets } = fixture();
    const invalid = {
      ...report,
      summary: { ...report.summary, total: 2, passed: 2 },
      results: [{ ...report.results[0], aiCalls: 1 }, { ...report.results[0], id: 'case-b', aiCalls: 1 }],
    };
    persist(runs, 'replay', invalid);
    const failure = await judgeSmokeReport({ report: invalid, artifactRoots, secrets }).catch((error: Error) => error);
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
    const { artifactRoots, runs, report, secrets } = fixture();
    persist(runs, 'replay', { ...report, durationMs: 2 });
    const collect = vi.spyOn(reportAssertions, 'collectStorageArtifacts');
    try {
      await expect(judgeSmokeReport({ report, artifactRoots, secrets }))
        .rejects.toThrow(/persisted report differs from provided report/);
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

describe('parseJudgeEnv', () => {
  const reportEnv = { AMBERCAST_VERIFY_MEMOS_REPORT: '/unused/report.json', AMBERCAST_VERIFY_MEMOS_MODE: 'full' };
  it.each([undefined, ''])('TEST-544-11 skips without an expected count when report is %s', report => {
    const env: NodeJS.ProcessEnv = { AMBERCAST_VERIFY_MEMOS_MODE: 'full' };
    if (report !== undefined) env.AMBERCAST_VERIFY_MEMOS_REPORT = report;
    expect(parseJudgeEnv(env)).toBeUndefined();
  });
  it.each([undefined, '0', '-1', '1.5', 'abc', '07', '9007199254740993', '', '+7', ' 7', '7 ', '1e1', '9007199254740992'])(
    'TEST-544-11 rejects invalid full-mode expected count %s', value => {
      expect(judgeModule).toHaveProperty('parseJudgeEnv', expect.any(Function));
      const env: NodeJS.ProcessEnv = { ...reportEnv };
      if (value !== undefined) env.AMBERCAST_VERIFY_MEMOS_EXPECTED_CASES = value;
      expect(() => parseJudgeEnv(env)).toThrow();
    },
  );
  it.each(['1', '7', '9007199254740991'])('TEST-544-11 parses safe positive decimal count %s', value => {
    expect(parseJudgeEnv({ ...reportEnv, AMBERCAST_VERIFY_MEMOS_EXPECTED_CASES: value }))
      .toEqual(expect.objectContaining({ expectedCases: Number(value) }));
  });
  it.each(['disclosure-only', 'heal-report'])('TEST-544-11 %s never reads expected count', mode => {
    const env: NodeJS.ProcessEnv = { ...reportEnv, AMBERCAST_VERIFY_MEMOS_MODE: mode };
    Object.defineProperty(env, 'AMBERCAST_VERIFY_MEMOS_EXPECTED_CASES', {
      get() { throw new Error('expected count must not be read'); },
    });
    expect(() => parseJudgeEnv(env)).not.toThrow();
  });
  it('TEST-544-11 rejects an unknown mode', () => {
    expect(judgeModule).toHaveProperty('parseJudgeEnv', expect.any(Function));
    expect(() => parseJudgeEnv({ ...reportEnv, AMBERCAST_VERIFY_MEMOS_MODE: 'other', AMBERCAST_VERIFY_MEMOS_EXPECTED_CASES: '7' })).toThrow();
  });
});
