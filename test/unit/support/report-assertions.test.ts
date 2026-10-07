import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createFsStorage } from '../../../src/adapters/storage/fs-storage.js';
import { REPORT_SCHEMA_VERSION, ReportEnvelope, type ReportEnvelope as ReportEnvelopeType } from '../../../src/report/schema.js';
import { finalizeReportEnvelope } from '../../../src/usecases/report-finalization.js';
import { buildRunReport } from '../../../src/usecases/run-report.js';
import { createInMemoryStorage } from '../../doubles/create-in-memory-storage.js';
import { assertDiagnosable, assertNoSecretDisclosure, assertZeroAiCalls, collectStorageArtifacts, GENERIC_FALLBACK_MESSAGES } from '../../support/report-assertions.js';

const summary = { total: 1, passed: 1, failed: 0, errored: 0, skipped: 0 };
const passed = { id: 'case-a', file: 'case-a.test.md', planFile: 'case-a.ambercast.plan.json', status: 'passed' as const, durationMs: 1, aiCalls: 0, steps: [], sessions: {}, explanation: '' };
const step = { id: 'step-a', type: 'assert' as const, target: 'web', status: 'failed' as const, kind: 'assertion' as const, expected: 'visible', actual: 'missing' };
const caseError = (caseId = 'case-a') => ({ scope: 'case' as const, kind: 'usage' as const, code: 'MISSING_PLAN' as const, caseId, message: 'The plan is missing.' });
const runError = { scope: 'run' as const, kind: 'environment' as const, code: 'BROWSER_LAUNCH_FAILED' as const, message: 'Browser executable is missing.' };

function envelope(command: ReportEnvelopeType['command'], results: unknown[], errors: unknown[] = []): ReportEnvelopeType {
  return ReportEnvelope.parse({ schemaVersion: REPORT_SCHEMA_VERSION, command, startedAt: '2026-01-01T00:00:00Z', durationMs: 1, summary, errors, results, ...(command === 'run' ? { reportPersistence: 'not-attempted' } : {}) });
}

function violation<T>(assertion: (value: T) => void, value: T): string {
  try { assertion(value); } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return (error as Error).message;
  }
  throw new Error('expected a contract violation');
}

async function rejection(action: () => Promise<unknown>): Promise<Error> {
  try { await action(); } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error as Error;
  }
  throw new Error('expected a contract rejection');
}

const temporaryDirectories: string[] = [];
afterEach(async () => { await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe('report assertions', () => {
  it('TEST-A1 validates schema issues, aggregates ordered violations, and preserves input', () => {
    for (const assertion of [assertDiagnosable, assertZeroAiCalls]) {
      for (const raw of [null, {}, { ...envelope('run', [passed]), schemaVersion: 'wrong' }]) {
        const message = violation(assertion, raw);
        expect(message).toContain(assertion.name);
        expect(message).toMatch(/schemaVersion|command|report/);
      }
      const valid = envelope('run', [passed]);
      const before = structuredClone(valid);
      expect(assertion(valid)).toBeUndefined();
      expect(valid).toStrictEqual(before);
    }
    const schemaIssues = violation(assertDiagnosable, { ...envelope('run', [passed]), schemaVersion: 'wrong', durationMs: -1 });
    expect(schemaIssues).toMatch(/2/);
    expect(schemaIssues).toContain('schemaVersion');
    expect(schemaIssues).toContain('durationMs');
    expect(schemaIssues.indexOf('schemaVersion')).toBeLessThan(schemaIssues.indexOf('durationMs'));
    const newlineId = envelope('run', [{ ...passed, id: 'bad\nid', status: 'error' }]);
    const escaped = violation(assertDiagnosable, newlineId);
    expect(escaped).toContain(JSON.stringify('bad\nid'));
    expect(escaped).not.toContain('bad\nid');
    const combined = envelope('run', [{ ...passed, status: 'error', steps: [{ ...step, status: 'error' }] }], [{ ...caseError('other'), message: '  ' }]);
    const message = violation(assertDiagnosable, combined);
    expect(message).toMatch(/2/);
    expect(message.indexOf('errors[0]')).toBeLessThan(message.indexOf('case-a'));
    expect(message).toMatch(/case-a[^\n]*(?:case error|case-scoped error)[^\n]*(?:step|error-status)|case-a[^\n]*(?:step|error-status)[^\n]*(?:case error|case-scoped error)/i);
    expect(assertDiagnosable(envelope('review', [{ id: 'review-a', file: 'review-a.test.md', planFile: 'review-a.ambercast.plan.json', status: 'insufficient', concerns: [] }]))).toBeUndefined();
  });

  it('TEST-A2 accepts producer, finalized, and serialized run envelopes', () => {
    const built = buildRunReport({ startedAt: '2026-01-01T00:00:00Z', durationMs: 1, options: { allowEmpty: false, list: false }, outcome: { results: [{ result: passed }], listed: [], skipped: [], interrupted: false, noTestsFound: false } });
    const finalized = finalizeReportEnvelope(built.envelope, '/project');
    for (const report of [built.envelope, finalized, JSON.parse(JSON.stringify(finalized))]) {
      expect(assertDiagnosable(report)).toBeUndefined();
      expect(assertZeroAiCalls(report)).toBeUndefined();
    }
  });

  it.each([
    ['blank message', envelope('run', [passed], [{ ...caseError(), message: '  ' }]), true, 'errors[0]'],
    ['generic without details', envelope('run', [passed], [{ scope: 'case', kind: 'environment', code: 'AGENTIC_STEP_FAILED', caseId: 'case-a', message: 'The AI-directed interaction did not complete successfully.' }]), true, 'generic fallback'],
    ['generic with details', envelope('run', [passed], [{ scope: 'case', kind: 'environment', code: 'AGENTIC_STEP_FAILED', caseId: 'case-a', message: 'The AI-directed interaction did not complete successfully.', details: { stepId: 's1', actions: 1, assertions: 1, passedAssertions: 0, failedAssertions: 1, targetRejections: 0 } }]), false, ''],
    ['unsupported details code', envelope('run', [passed], [{ ...caseError(), message: 'Healing failed for this case.' }]), true, 'generic fallback'],
    ['specific run message', envelope('run', [passed], [runError]), false, ''],
    ['specific case message', envelope('run', [passed], [{ scope: 'case', kind: 'environment', code: 'FS_IO_ERROR', caseId: 'case-a', message: 'Disk is full.' }]), false, ''],
  ])('TEST-A3 checks %s', (_name, report, fails, fragment) => {
    if (fails) {
      const message = violation(assertDiagnosable, report);
      expect(message).toContain(fragment);
      if (_name === 'generic without details') expect(message).toContain('AGENTIC_STEP_FAILED');
    } else expect(assertDiagnosable(report)).toBeUndefined();
  });

  it('TEST-A3 checks the finalization emergency envelope by its details', () => {
    const emergency = finalizeReportEnvelope({ ...envelope('run', [passed]), schemaVersion: 'invalid' } as unknown as ReportEnvelopeType, '/project');
    expect(assertDiagnosable(emergency)).toBeUndefined();
    const { details: _details, ...errorWithoutDetails } = emergency.errors[0] as Record<string, unknown>;
    const withoutDetails = { ...emergency, errors: [errorWithoutDetails] };
    expect(ReportEnvelope.safeParse(withoutDetails).success).toBe(true);
    const message = violation(assertDiagnosable, withoutDetails);
    expect(message).toContain('generic fallback');
    expect(message).toContain('errors[0]');
  });

  it('TEST-A4 keeps all ten generic fallbacks anchored in production source', () => {
    expect(GENERIC_FALLBACK_MESSAGES).toHaveLength(10);
    expect(new Set(GENERIC_FALLBACK_MESSAGES).size).toBe(10);
    const src = fileURLToPath(new URL('../../../src/', import.meta.url));
    const files = readdirSync(src, { recursive: true, encoding: 'utf8' }).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));
    const texts = files.map((name) => readFileSync(join(src, name), 'utf8'));
    for (const fallback of GENERIC_FALLBACK_MESSAGES) expect(texts.some((source) => source.includes(fallback))).toBe(true);
  });

  it.each([
    ['run error lacks case error', envelope('run', [{ ...passed, status: 'error' }]), true],
    ['run error has case error', envelope('run', [{ ...passed, status: 'error' }], [caseError()]), false],
    ['explanation alone', envelope('run', [{ ...passed, status: 'error', explanation: 'Failed because of browser.' }]), true],
    ['failed assertion', envelope('run', [{ ...passed, status: 'failed', steps: [step] }]), false],
    ['environment step', envelope('run', [{ ...passed, status: 'failed', steps: [{ ...step, kind: 'environment' }] }]), true],
    ['passed with environment failed step', envelope('run', [{ ...passed, steps: [{ ...step, status: 'failed', kind: 'environment' }] }]), true],
    ['blank expected', envelope('run', [{ ...passed, status: 'failed', steps: [{ ...step, expected: ' ' }] }]), true],
    ['blank actual', envelope('run', [{ ...passed, status: 'failed', steps: [{ ...step, actual: ' ' }] }]), true],
    ['listed exempt', envelope('run', [{ id: 'case-a', file: 'case-a.test.md', status: 'listed' }]), false],
    ['passed with error step', envelope('run', [{ ...passed, steps: [{ ...step, status: 'error' }] }]), true],
    ['generate failed without case error', envelope('generate', [{ id: 'case-a', file: 'case-a.test.md', status: 'failed', dryRun: false }]), true],
    ['generate failed with case error', envelope('generate', [{ id: 'case-a', file: 'case-a.test.md', status: 'failed', dryRun: false }], [caseError()]), false],
    ['heal unresolved', envelope('heal', [{ ...passed, status: 'completed', repairOutcome: 'unresolved', application: 'not-eligible', stopReason: 'settled' }]), false],
    ['heal completed', envelope('heal', [{ ...passed, status: 'completed', repairOutcome: 'healed', application: 'applied', stopReason: 'settled' }]), false],
    ['check stale', envelope('check', [{ id: 'case-a', file: 'case-a.test.md', planFile: 'case-a.ambercast.plan.json', status: 'stale', reason: 'stale' }]), false],
    ['review insufficient', envelope('review', [{ id: 'case-a', file: 'case-a.test.md', planFile: 'case-a.ambercast.plan.json', status: 'insufficient', concerns: [] }]), false],
    ['wrong case id', envelope('run', [{ ...passed, status: 'error' }], [caseError('other')]), true],
    ['run scoped error', envelope('run', [{ ...passed, status: 'error' }], [runError]), true],
    ['empty report', envelope('run', []), false],
    ['orphan case error', envelope('run', [], [caseError()]), false],
  ])('TEST-A5 requires evidence for %s', (_name, report, fails) => {
    if (fails) expect(violation(assertDiagnosable, report)).toContain('case-a');
    else expect(assertDiagnosable(report)).toBeUndefined();
  });

  it('TEST-A5 reports both invalid result identities', () => {
    const message = violation(assertDiagnosable, envelope('run', [{ ...passed, id: 'first', status: 'error' }, { ...passed, id: 'second', status: 'error' }]));
    expect(message).toContain('first');
    expect(message).toContain('second');
  });

  const { aiCalls: _aiCalls, ...withoutAiCalls } = passed;
  it.each([
    ['nonzero executed run', envelope('run', [{ ...passed, aiCalls: 1 }]), true, 'case-a'],
    ['missing executed count', envelope('run', [withoutAiCalls]), true, 'case-a'],
    ['missing failed count', envelope('run', [{ ...withoutAiCalls, status: 'failed' }]), true, 'case-a'],
    ['missing error count', envelope('run', [{ ...withoutAiCalls, status: 'error' }]), true, 'case-a'],
    ['empty report', envelope('run', []), true, 'report'],
    ['check without counts', envelope('check', [{ id: 'case-a', file: 'case-a.test.md', planFile: 'case-a.ambercast.plan.json', status: 'stale', reason: 'stale' }]), true, 'report'],
    ['listed only', envelope('run', [{ id: 'case-a', file: 'case-a.test.md', status: 'listed' }]), true, 'report'],
    ['heal zero count', envelope('heal', [{ ...passed, status: 'completed', repairOutcome: 'unresolved', application: 'not-eligible', stopReason: 'settled' }]), false, ''],
    ['generate nonzero count', envelope('generate', [{ id: 'case-a', file: 'case-a.test.md', planFile: 'case-a.ambercast.plan.json', status: 'generated', dryRun: false, ambiguities: [], secrets: [], aiCalls: 2 }]), true, 'case-a'],
  ])('TEST-A6 counts AI calls for %s', (_name, report, fails, location) => {
    if (fails) {
      const message = violation(assertZeroAiCalls, report);
      expect(message).toContain(location);
      if (_name === 'nonzero executed run') expect(message).toContain('1');
    } else expect(assertZeroAiCalls(report)).toBeUndefined();
  });

  it('TEST-A7 scans report text, binary content, escaped forms, and paths without echoing secrets', () => {
    const token = 'hidden-token';
    const bytes = (text: string) => Buffer.from(text);
    const reportMessage = violation(assertNoSecretDisclosure, { secrets: { credential: token }, report: { value: token } });
    expect(reportMessage).toContain('credential');
    expect(reportMessage).toContain('report');
    expect(reportMessage).not.toContain(token);
    const binary = violation(assertNoSecretDisclosure, { secrets: { credential: token }, artifacts: [{ path: 'binary.dat', bytes: Buffer.concat([Buffer.from([0xff]), bytes(token), Buffer.from([0xfe])]) }] });
    expect(binary).toContain('binary.dat');
    expect(binary).toBe('assertNoSecretDisclosure: 1 violation(s)\n- secret "credential" found in "binary.dat" at byte 1');
    const escapedSecret = '"\\\n';
    expect(violation(assertNoSecretDisclosure, { secrets: { escaped: escapedSecret }, artifacts: [{ path: 'report.json', bytes: bytes(JSON.stringify({ secret: escapedSecret })) }] })).toContain('report.json');
    expect(violation(assertNoSecretDisclosure, { secrets: { credential: token }, report: `stdout ${token}` })).toContain('report');
    expect(assertNoSecretDisclosure({ secrets: { credential: token }, report: null })).toBeUndefined();
    expect(violation(assertNoSecretDisclosure, { secrets: { credential: token }, report: token, artifacts: [] })).toContain('report');
    const mixedSecret = '\n';
    const escaped = JSON.stringify(mixedSecret).slice(1, -1);
    const mixed = Buffer.from('x'.repeat(10) + escaped + 'x'.repeat(40 - 10 - escaped.length) + mixedSecret);
    expect(violation(assertNoSecretDisclosure, { secrets: { newline: mixedSecret }, artifacts: [{ path: 'mixed', bytes: mixed }] })).toBe('assertNoSecretDisclosure: 1 violation(s)\n- secret "newline" found in "mixed" at byte 10');
    const pathMessage = violation(assertNoSecretDisclosure, { secrets: { credential: token }, artifacts: [{ path: `file-${token}`, bytes: bytes(token) }] });
    expect(pathMessage).toContain('path of artifacts[0]');
    expect(pathMessage).toContain('artifacts[0]');
    expect(pathMessage).toMatch(/2/);
    expect(pathMessage).not.toContain(token);
    const split = violation(assertNoSecretDisclosure, { secrets: { pathSecret: 'path-token', contentSecret: 'content-token' }, artifacts: [{ path: 'file-path-token', bytes: bytes('content-token') }] });
    expect(split).toContain('pathSecret');
    expect(split).toContain('contentSecret');
    expect(split).toContain('path of artifacts[0]');
    expect(split).toContain('artifacts[0]');
    expect(split).toMatch(/2/);
    expect(split).not.toContain('path-token');
    expect(split).not.toContain('content-token');
    expect(assertNoSecretDisclosure({ secrets: { credential: token }, report: 'safe', artifacts: [{ path: 'safe', bytes: bytes('safe') }] })).toBeUndefined();
  });

  it('TEST-A7 rejects invalid inputs, preserves finding order, and is deterministic', () => {
    const invalid = [
      { secrets: {}, report: 'safe' },
      { secrets: { a: '' }, report: 'safe' },
      { secrets: { label: 'opaque-token-123' } },
      { secrets: { label: 'opaque-token-123' }, artifacts: [] },
      { secrets: { label: 'opaque-token-123' }, report: (() => { const value: { self?: unknown } = {}; value.self = value; return value; })() },
      { secrets: { 'opaque-token-123': 'opaque-token-123' }, report: 'safe' },
      { secrets: { x: 'short', labelThatContains_short: 'other' }, report: 'safe' },
    ];
    for (const input of invalid) {
      const message = violation(assertNoSecretDisclosure, input);
      expect(message).toMatch(/^assertNoSecretDisclosure: invalid input:/);
      expect(message).not.toContain('opaque-token-123');
      if (input === invalid[invalid.length - 1]) expect(message).not.toContain('short');
    }
    const input = { secrets: { first: 'alpha', second: 'beta' }, report: 'alpha beta', artifacts: [{ path: 'one', bytes: Buffer.from('alpha beta') }, { path: 'two', bytes: Buffer.from('alpha beta') }] };
    const first = violation(assertNoSecretDisclosure, input);
    expect(violation(assertNoSecretDisclosure, input)).toBe(first);
    expect(first.indexOf('report')).toBeLessThan(first.indexOf('one'));
    expect(first.indexOf('one')).toBeLessThan(first.indexOf('two'));
    expect(first).toMatch(/first[\s\S]*second/);
  });

  it('TEST-A8 collects all files, deduplicates roots, and uses UTF-16 path order', async () => {
    const storage = createInMemoryStorage();
    const data = new Map([
      ['.runs/r1/case/step.png', new Uint8Array(Buffer.from([0xff, 0, 1]))],
      ['.runs/r1/report.json', new Uint8Array(Buffer.from('{"ok":true}'))],
      ['.runs/r1/.ambercast-tmp-x', new Uint8Array(Buffer.from('temporary'))],
      ['case.ambercast.plan.json', new Uint8Array(Buffer.from('plan'))],
      ['case.ambercast.grounding.json', new Uint8Array(Buffer.from('grounding'))],
    ]);
    for (const [path, bytes] of data) await storage.writeBinary(path, bytes);
    const paths = [...data.keys()].sort();
    const collected = await collectStorageArtifacts(storage, ['.runs', 'case.ambercast.plan.json', 'case.ambercast.grounding.json']);
    expect(collected).toEqual(paths.map((path) => ({ path, bytes: data.get(path) })));
    expect(await collectStorageArtifacts(storage, ['.runs', '.runs/r1', 'case.ambercast.plan.json', 'case.ambercast.plan.json', 'case.ambercast.grounding.json'])).toEqual(collected);
    for (const roots of [[], ['missing'], ['empty']]) {
      if (roots[0] === 'empty') await storage.ensureDir('empty');
      expect((await rejection(() => collectStorageArtifacts(storage, roots))).message).toBe(roots.length === 0
        ? 'collectStorageArtifacts: invalid input: no roots'
        : `collectStorageArtifacts: root ${JSON.stringify(roots[0])} contained no files`);
    }
    await storage.writeBinary('unicode-\uE000', Buffer.from('bmp'));
    await storage.writeBinary('unicode-\u{10000}', Buffer.from('astral'));
    expect((await collectStorageArtifacts(storage, ['unicode-\uE000', 'unicode-\u{10000}'])).map(({ path }) => path)).toStrictEqual(['unicode-\u{10000}', 'unicode-\uE000']);
    const root = await realpath(await mkdtemp(join(tmpdir(), 'ambercast-artifacts-')));
    temporaryDirectories.push(root);
    const disk = createFsStorage();
    for (const [path, bytes] of data) await disk.writeBinary(join(root, path), bytes);
    expect(await collectStorageArtifacts(disk, [join(root, '.runs'), join(root, 'case.ambercast.plan.json'), join(root, 'case.ambercast.grounding.json')])).toEqual(paths.map((path) => ({ path: join(root, path), bytes: data.get(path) })));
  });

  it('TEST-A12 rejects malformed artifact and root inputs with named errors', async () => {
    expect(violation(assertNoSecretDisclosure, { secrets: { safe: 'token' }, report: () => {} })).toMatch(/^assertNoSecretDisclosure: invalid input:/);
    for (const artifacts of [[{ path: 1, bytes: new Uint8Array() }], [{ path: 'a', bytes: 'text' }]]) {
      const message = violation(assertNoSecretDisclosure, { secrets: { safe: 'token' }, artifacts } as never);
      expect(message).toMatch(/^assertNoSecretDisclosure: invalid input:/);
    }
    await expect(collectStorageArtifacts(createInMemoryStorage(), [1] as never)).rejects.toThrow(/^collectStorageArtifacts: invalid input:/);
  });

  it('TEST-A12 rejects a read failure without returning partial artifacts', async () => {
    const storage = createInMemoryStorage();
    await storage.writeBinary('first', Buffer.from('ok'));
    await storage.writeBinary('second', Buffer.from('bad'));
    const broken = { ...storage, readBinary: async (path: string) => { if (path === 'second') throw new Error('read exploded'); return storage.readBinary(path); } };
    await expect(collectStorageArtifacts(broken, ['first', 'second'])).rejects.toThrow(/collectStorageArtifacts: cannot read.*second.*read exploded/);
  });

  it('TEST-FA2 renders ordered report, artifact content, and path findings exactly', () => {
    const message = violation(assertNoSecretDisclosure, {
      secrets: { tok: 'S3CR3T' }, report: 'xS3CR3T', artifacts: [
        { path: 'a.txt', bytes: new Uint8Array(Buffer.from('S3CR3T')) },
        { path: 'dir/S3CR3T.png', bytes: Buffer.from('zzS3CR3T') },
      ],
    });
    expect(message).toBe('assertNoSecretDisclosure: 4 violation(s)\n- secret "tok" found in report at byte 1\n- secret "tok" found in "a.txt" at byte 0\n- secret "tok" found in artifacts[1] at byte 2\n- secret "tok" found in path of artifacts[1]');
  });

  it('TEST-FA2 keeps control characters in labels and safe paths on one physical finding line', () => {
    const message = violation(assertNoSecretDisclosure, { secrets: { 'a\nb': 'S3CR3T' }, artifacts: [{ path: 'x\ny.txt', bytes: Buffer.from('S3CR3T') }] });
    expect(message).toBe('assertNoSecretDisclosure: 1 violation(s)\n- secret "a\\nb" found in "x\\ny.txt" at byte 0');
    expect(message.split('\n')).toHaveLength(2);
    expect(message).not.toContain('S3CR3T');
  });

  it.each([
    ['label is a substring of its own value', { token: 'my-token-1' }],
    ['labels overlap', { ab: 'one', abc: 'two' }],
    ['values overlap', { shorter: 'token-123', longer: 'opaque-token-123' }],
  ])('TEST-FA3 accepts %s', (_name, secrets) => {
    expect(assertNoSecretDisclosure({ secrets, report: 'safe' })).toBeUndefined();
  });

  it.each([
    ['own value inside label', { 'my-token-1-label': 'my-token-1' }, 'a label contains a secret value'],
    ['other value inside label', { a: 'secret', 'x-secret': 'other' }, 'a label contains a secret value'],
    ['empty value before overlap', { 'x-secret': '', a: 'secret' }, 'secret value is empty'],
  ])('TEST-FA3 rejects %s', (_name, secrets, reason) => {
    expect(violation(assertNoSecretDisclosure, { secrets, report: 'safe' })).toBe(`assertNoSecretDisclosure: invalid input: ${reason}`);
  });

  it('TEST-FA4 quotes a result id containing a newline', () => {
    const report = envelope('run', [{ ...passed, id: 'a\nb', aiCalls: 1 }]);
    expect(violation(assertZeroAiCalls, report)).toBe('assertZeroAiCalls: 1 violation(s)\n- "a\\nb": aiCalls is 1, expected 0');
  });

  it.each(['run', 'check'] as const)('TEST-FA5 reports both empty-results violations for %s', (command) => {
    expect(violation(assertZeroAiCalls, envelope(command, []))).toBe('assertZeroAiCalls: 2 violation(s)\n- report: empty results array - cannot demonstrate zero AI usage\n- report: no row carries aiCalls field - cannot demonstrate zero AI usage');
  });

  it('TEST-FA6 names an empty root list exactly', async () => {
    expect((await rejection(() => collectStorageArtifacts(createInMemoryStorage(), []))).message).toBe('collectStorageArtifacts: invalid input: no roots');
  });

  it.each([
    ['undefined input', undefined, 'input must be an object'],
    ['null input', null, 'input must be an object'],
    ['primitive input', 'x', 'input must be an object'],
    ['array input', [], 'input must be an object'],
    ['null artifacts', { secrets: { safe: 'token' }, artifacts: null }, 'artifacts must be an array'],
    ['string artifacts', { secrets: { safe: 'token' }, artifacts: 'x' }, 'artifacts must be an array'],
    ['null artifact', { secrets: { safe: 'token' }, artifacts: [null] }, 'artifacts[0] is malformed'],
    ['numeric artifact', { secrets: { safe: 'token' }, artifacts: [1] }, 'artifacts[0] is malformed'],
    ['numeric path', { secrets: { safe: 'token' }, artifacts: [{ path: 1, bytes: new Uint8Array() }] }, 'artifacts[0] is malformed'],
    ['array artifact', { secrets: { safe: 'token' }, artifacts: [[]] }, 'artifacts[0] is malformed'],
    ['secrets before artifacts', { secrets: {}, artifacts: 'x' }, 'secrets is empty'],
  ])('TEST-FA7 validates disclosure %s', (_name, input, reason) => {
    try { assertNoSecretDisclosure(input as never); throw new Error('accepted invalid input'); }
    catch (error) {
      expect(error).not.toBeInstanceOf(TypeError);
      expect((error as Error).message).toBe(`assertNoSecretDisclosure: invalid input: ${reason}`);
    }
  });

  it.each([
    ['undefined storage', undefined, ['a'], 'storage is not a StorageAdapter'],
    ['array storage', [], ['a'], 'storage is not a StorageAdapter'],
    ['null storage', null, ['a'], 'storage is not a StorageAdapter'],
    ['empty object storage', {}, ['a'], 'storage is not a StorageAdapter'],
    ['string roots', createInMemoryStorage(), 'a', 'roots must be an array'],
  ])('TEST-FA7 validates collector %s', async (_name, storage, roots, reason) => {
    const error = await rejection(() => collectStorageArtifacts(storage as never, roots as never));
    expect(error).not.toBeInstanceOf(TypeError);
    expect(error.message).toBe(`collectStorageArtifacts: invalid input: ${reason}`);
  });

  it.each(['exists', 'listFiles', 'listDirectories', 'readBinary'] as const)('TEST-FA8 wraps %s failures once', async (method) => {
    const base = createInMemoryStorage();
    await base.writeBinary('root/child/file', Buffer.from('ok'));
    const path = method === 'listDirectories' ? 'root/child' : method === 'readBinary' ? 'root/child/file' : 'root';
    const broken = { ...base, [method]: async (candidate: string) => {
      if (candidate === path) throw new Error('boom');
      return base[method](candidate);
    } };
    const error = await rejection(() => collectStorageArtifacts(broken as never, ['root']));
    expect(error.message).toBe(`collectStorageArtifacts: cannot read ${JSON.stringify(path)}: boom`);
    expect(error.message.match(/cannot read/g)).toHaveLength(1);
  });

  it('TEST-FA8 stringifies a non-Error readBinary rejection', async () => {
    const base = createInMemoryStorage();
    await base.writeBinary('file', Buffer.from('ok'));
    const broken = { ...base, readBinary: async () => { throw 'boom'; } };
    const error = await rejection(() => collectStorageArtifacts(broken, ['file']));
    expect(error.message).toBe('collectStorageArtifacts: cannot read "file": boom');
    expect(error.message.match(/cannot read/g)).toHaveLength(1);
  });

  it('TEST-FA9 limits the branch diff and untracked files to the four planned paths', () => {
    const cwd = fileURLToPath(new URL('../../../', import.meta.url));
    const allowed = [
      'test/support/report-assertions.ts', 'test/support/corpus.ts',
      'test/unit/support/report-assertions.test.ts', 'test/unit/support/corpus.test.ts',
    ];
    const mergeBase = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd, encoding: 'utf8' }).trim();
    const changed = execFileSync('git', ['diff', mergeBase, '--name-only'], { cwd, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    const status = execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' });
    expect(status.split('\n').filter((line) => line.startsWith('?? '))).toEqual([]);
    expect(changed.sort()).toEqual(allowed.sort());
  });
});
