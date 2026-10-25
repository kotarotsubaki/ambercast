/** Entry-boundary contracts without Docker, network, AI or real child processes. */
import { createHash } from 'node:crypto';
import * as childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error The production ESM script is deliberately untyped JavaScript.
import { main, parseArgs, CASES } from '../../../scripts/verify-memos.mjs';
import { REPORT_SCHEMA_VERSION, ReportEnvelope } from '#report/schema.js';
import { PLAN_SCHEMA_VERSION, PlanDocument } from '#core/ir/schema.js';
// @ts-expect-error The production ESM script is deliberately untyped JavaScript.
import { runProcess, createDockerRunner, TerminationUnconfirmedError } from '../../../scripts/lib/memos-harness.mjs';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

// Preserve real files, observing only the public copy/publication boundary.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, renameSync: vi.fn(actual.renameSync), writeFileSync: vi.fn(actual.writeFileSync), mkdirSync: vi.fn(actual.mkdirSync),
    copyFileSync: vi.fn(actual.copyFileSync), rmSync: vi.fn(actual.rmSync),
    existsSync: vi.fn(actual.existsSync), readFileSync: vi.fn(actual.readFileSync) };
});
const configFile = 'ambercast.config.json';
const caseTable = CASES as readonly { id: string; target: string }[];
const caseIds = caseTable.map(c => c.id);
const prompts = caseTable.map(c => `tests/ambercast/${c.id}.test.md`);
const plans = prompts.map(p => p.replace('.test.md', '.ambercast.plan.json'));
const groundings = prompts.map(p => p.replace('.test.md', '.ambercast.grounding.json'));
const prompt = prompts[0]!;
const plan = plans[0]!;
const grounding = groundings[0]!;
const files = [configFile, ...caseTable.flatMap((_, i) => [prompts[i]!, plans[i]!, groundings[i]!])] as const;
const suiteFiles = files;
const publications = [files[0], ...plans, ...groundings];
const targets = [...new Set(caseTable.map(c => c.target))];
const healIndex = caseTable.findIndex(c => c.id === 'memos-settings-dialog');
const healPrompt = prompts[healIndex]!;
const healPlan = plans[healIndex]!;
const healGrounding = groundings[healIndex]!;
const settingsPath = '/api/v1/instance/settings/GENERAL';
// The synthetic plan and miss report share an identity so each rejection case
// changes one piece of evidence without depending on generated fixture bytes.
const fakeHealStepId = 'settings-entry';
const fakeSourceSpan = { startLine: 1, startColumn: 1, endLine: 1, endColumn: 2 };
function readOnlyPlan(settingsLabel = 'Open settings') {
  return PlanDocument.parse({ schemaVersion: PLAN_SCHEMA_VERSION, source: { inputsDigest: '0'.repeat(64) },
    targets: { 'memos-readonly': { surface: 'web', baseUrl: 'http://127.0.0.1:5230', locale: 'en-US' } }, steps: [
      { id: 'username', kind: 'action', action: 'fill', target: 'memos-readonly', value: 'verifier', intent: { description: 'Username input', roleHint: 'textbox', sourceSpan: fakeSourceSpan } },
      { id: 'password', kind: 'action', action: 'fill-secret', target: 'memos-readonly', secretRef: '{{secrets.memos.password}}', intent: { description: 'Password input', roleHint: 'textbox', sourceSpan: fakeSourceSpan } },
      { id: fakeHealStepId, kind: 'action', action: 'click', target: 'memos-readonly', intent: { description: settingsLabel, roleHint: 'menuitem', sourceSpan: fakeSourceSpan } },
    ] });
}
function suiteReport(selected: readonly string[] = prompts, aiCalls = 0) {
  return { schemaVersion: REPORT_SCHEMA_VERSION, command: 'run', startedAt: '2026-01-01T00:00:00Z', durationMs: 1,
    summary: { total: selected.length, passed: selected.length, failed: 0, errored: 0, skipped: 0 }, errors: [] as Record<string, unknown>[],
    reportPersistence: 'persisted', results: selected.map(file => ({ id: file, file,
      planFile: file.replace('.test.md', '.ambercast.plan.json'), status: 'passed', durationMs: 1, aiCalls,
      steps: [], sessions: {}, explanation: '' })) };
}
function brokenReport(aiCalls = 0) {
  const envelope = suiteReport([healPrompt], aiCalls);
  envelope.results[0]!.status = 'error';
  envelope.summary = { total: 1, passed: 0, failed: 0, errored: 1, skipped: 0 };
  envelope.errors = [{ code: 'GROUNDING_UNRESOLVED', scope: 'case', kind: 'usage', caseId: healPrompt,
    message: 'Settings entry needs grounding', details: { stepId: fakeHealStepId, reason: 'missing' } }];
  ReportEnvelope.parse(envelope);
  return envelope;
}
function healReport(apply: boolean, aiCalls: number | undefined = apply ? 3 : 2) {
  const base = suiteReport([healPrompt]);
  const { reportPersistence: _persistence, ...envelope } = base;
  const { status: _status, aiCalls: _calls, ...identity } = base.results[0]!;
  const healed = { ...envelope, command: 'heal', results: [{ ...identity, status: 'completed', repairOutcome: 'healed',
    application: apply ? 'applied' : 'preview-only', stopReason: 'settled', ...(aiCalls === undefined ? {} : { aiCalls }) }] };
  ReportEnvelope.parse(healed);
  return healed;
}
function navigationPlan(c: { id: string; target: string }, generated = false) {
  return PlanDocument.parse({ schemaVersion: PLAN_SCHEMA_VERSION, source: { inputsDigest: '0'.repeat(64) },
    ...(generated ? { generatorMeta: { generated: c.id } } : {}),
    targets: { [c.target]: { surface: 'web', baseUrl: 'http://127.0.0.1:5230', locale: c.target === 'memos-ja' ? 'ja-JP' : 'en-US' } },
    steps: [{ id: 'open', kind: 'action', action: 'navigate', target: c.target, url: 'http://127.0.0.1:5230/auth' }] });
}
function writeSuiteFixture(fixture: string, generated: readonly string[] = caseIds) {
  write(join(fixture, files[0]), JSON.stringify({ testDir: 'tests/ambercast', defaultTarget: 'memos',
    targets: { memos: { baseUrl: 'http://127.0.0.1:5230', locale: 'en-US' },
      'memos-readonly': { baseUrl: 'http://127.0.0.1:5230', locale: 'en-US', healReplayIsolation: 'idempotent' },
      'memos-ja': { baseUrl: 'http://127.0.0.1:5230', locale: 'ja-JP' } },
    secrets: { allow: ['memos.password'] }, heal: { maxStepRepairs: 2 } }));
  for (const [i, c] of caseTable.entries()) {
    write(join(fixture, prompts[i]!), i === 0 ? 'Sign in and create a memo.\n' : `# ${c.id}\n`);
    if (!generated.includes(c.id)) continue;
    write(join(fixture, plans[i]!), JSON.stringify(i === healIndex ? readOnlyPlan() : navigationPlan(c)));
    write(join(fixture, groundings[i]!), JSON.stringify({ seed: c.id }));
  }
}
const sha = '0123456789abcdef'.repeat(4);
const password = 'ab'.repeat(16);
const report = suiteReport();
const reportText = `  ${JSON.stringify(report)}\n`;
const dirs: string[] = [];
type ProcessOptions = { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; signal: AbortSignal;
  stdio?: string; password?: string; onStderrChunk?: (chunk: string) => void };
type ProcessResult = { status: number | null; stdout: string; stderr: string; signal: string | null;
  termination?: 'none' | 'confirmed' | 'unconfirmed'; pgid?: number };
type ProcessCall = { argv: string[]; opts: ProcessOptions; kind: string };
type ContainerSpec = { runId: string; name: string; data: string; uid: number; gid: number };
type RunnerCall = { method: string; args: unknown[] };
// The untyped entry boundary accepts heterogeneous runner methods; narrow in each fake.
type RunnerMethod = (...args: never[]) => unknown;
type FetchResult = { status: number; ok?: boolean; json: () => Promise<unknown>; text?: () => Promise<string> };
type Overrides = { runner?: Record<string, RunnerMethod>; runProcess?: (call: ProcessCall) => Promise<ProcessResult> | ProcessResult;
  fetch?: (url: string, opts: RequestInit) => Promise<FetchResult>; assertPortFree?: RunnerMethod; readPlaywrightVersion?: RunnerMethod;
  /** Cases whose plan and grounding exist in the fake fixture; prompts and config are always written. */
  fixtureCases?: readonly string[] };
function result(status: number | null = 0, stdout = '', stderr = '', signal: string | null = null): ProcessResult { return { status, stdout, stderr, signal }; }
function write(path: string, value: string) { fs.mkdirSync(dirname(path), { recursive: true }); fs.writeFileSync(path, value); }
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else out[relative(root, path)] = createHash('sha256').update(fs.readFileSync(path)).digest('hex');
    }
  };
  visit(root); return out;
}
/** All injectable dependencies and their histories are built at this one seam. */
function createFakeDeps(overrides: Overrides = {}) {
  const tmpRoot = fs.mkdtempSync(join(tmpdir(), 'ambercast-verify-unit-')); dirs.push(tmpRoot);
  const repoRoot = join(tmpRoot, 'repo'), fixture = join(repoRoot, 'test/verification/memos/fixture');
  const manifest = join(repoRoot, 'pack-manifest.json');
  write(manifest, JSON.stringify({ sha, dirty: false }));
  writeSuiteFixture(fixture, overrides.fixtureCases);
  const stdout: string[] = [], stderr: string[] = [], events: string[] = [];
  const runnerCalls: RunnerCall[] = [], processCalls: ProcessCall[] = [], starts: ContainerSpec[] = [];
  const fetchCalls: { url: string; opts: RequestInit }[] = [], signalCalls: { method: string; name: string; handler: () => void }[] = [];
  const containers = new Set<string>(), handlers = new Map<string, Set<() => void>>();
  const randomBytesSizes: number[] = [];
  let now = 0, sequence = 0;
  let additionalScript = '';
  const signals = {
    on(name: string, handler: () => void) { signalCalls.push({ method: 'on', name, handler });
      if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name)!.add(handler); return this; },
    off(name: string, handler: () => void) { signalCalls.push({ method: 'off', name, handler }); handlers.get(name)?.delete(handler); return this; },
    emit(name: string) { for (const handler of [...(handlers.get(name) ?? [])]) handler(); },
    listenerCount(name: string) { return handlers.get(name)?.size ?? 0; },
  };
  const defaults: Record<string, RunnerMethod> = {
    checkDaemon: async () => undefined, hasImage: async () => true, pullImage: async () => undefined,
    startContainer: async (spec: ContainerSpec) => { expect(fs.readdirSync(spec.data)).toEqual([]); containers.add(spec.name); },
    removeContainer: async (name: string) => { containers.delete(name); }, isRunning: async (name: string) => containers.has(name),
    listContainers: async () => [...containers], inspectEnv: async () => ['MEMOS_RATE_LIMIT=false'],
    tailLogs: async () => 'fake container logs', inspectCreated: async () => new Date(0).toISOString(),
  };
  const runner = Object.fromEntries(Object.entries({ ...defaults, ...overrides.runner }).map(([method, impl]) => [method, async (...args: unknown[]) => {
    runnerCalls.push({ method, args }); events.push(method);
    if (method === 'startContainer') starts.push(args[0] as ContainerSpec);
    return impl(...args as never[]);
  }]));
  // Overrides replace a single operation; successful behavior for all others stays centralized.
  async function successfulProcess(call: ProcessCall): Promise<ProcessResult> {
    const { kind, opts } = call;
    if (kind === 'pack') return result(0, `build output\nmanifest: ${manifest}\n`);
    if (kind === 'check') return result(0, JSON.stringify({ results: prompts.map(file => ({ file, status: 'fresh' })) }));
    if (kind === 'generate') {
      const path = join(opts.cwd, files[0]), config = JSON.parse(fs.readFileSync(path, 'utf8'));
      config.secrets.allow = ['memos.password']; write(path, JSON.stringify(config));
      opts.onStderrChunk?.('generated safely\n');
      for (const i of caseTable.keys()) {
        if (!call.argv.includes(prompts[i]!)) continue;
        const generatedPlan = i === healIndex ? readOnlyPlan() : navigationPlan(caseTable[i]!, true);
        write(join(opts.cwd, plans[i]!), JSON.stringify(generatedPlan));
        write(join(opts.cwd, groundings[i]!), JSON.stringify({ generated: caseTable[i]!.id }));
      }
    }
    if (kind === 'install') write(join(opts.cwd, 'node_modules/ambercast/package.json'), JSON.stringify({ name: 'ambercast', version: '0.10.0' }));
    if (kind === 'heal-dry-run' || kind === 'heal-apply') {
      if (kind === 'heal-apply') write(join(opts.cwd, healPlan), JSON.stringify(readOnlyPlan('Open Control panel')));
      return result(0, JSON.stringify(healReport(kind === 'heal-apply')));
    }
    if (kind === 'resolve' || kind === 'replay') {
      const replayNumber = processCalls.filter(c => c.kind === 'replay' && c.opts.cwd === opts.cwd).length;
      const envelope = kind === 'resolve' ? suiteReport(prompts, 9)
        : replayNumber === 1 ? report : replayNumber === 2 ? brokenReport() : suiteReport([healPrompt]);
      const text = kind === 'replay' && replayNumber === 1 ? reportText : JSON.stringify(envelope);
      write(join(opts.cwd, 'tests/ambercast/.runs', `${kind}-${replayNumber}`, 'report.json'), text);
      return result(kind === 'replay' && replayNumber === 2 ? 4 : 0, text);
    }
    return result();
  }
  async function successfulFetch(url: string, opts: RequestInit = {}): Promise<FetchResult> {
    if (new URL(url).pathname === settingsPath) {
      if (opts.method === 'PATCH') additionalScript = JSON.parse(String(opts.body)).generalSetting.additionalScript;
      const body = { name: 'instance/settings/GENERAL', generalSetting: { additionalScript } };
      return { status: 200, ok: true, json: async () => body, text: async () => JSON.stringify(body) };
    }
    const body = url.endsWith('/profile') ? { needsSetup: true } : url.endsWith('/signin') ? { accessToken: 'token' } : {};
    return { status: 200, ok: true, json: async () => body, text: async () => JSON.stringify(body) };
  }
  const deps = {
    runner, tmpRoot, repoRoot, uid: 501, gid: 20,
    healStepId: fakeHealStepId,
    stdout: { write(s: string) { stdout.push(String(s)); } }, stderr: { write(s: string) { stderr.push(String(s)); } },
    randomBytes(size: number) { randomBytesSizes.push(size); if (size === 16) { events.push('password-generated'); return Buffer.from(password, 'hex'); } const bytes = Buffer.alloc(size); bytes.writeUInt32BE(++sequence); return bytes; },
    clock: { now: () => now, async sleep(ms: number, signal?: AbortSignal) { signal?.throwIfAborted(); now += ms; } },
    async assertPortFree(...args: unknown[]) { events.push('port'); return overrides.assertPortFree?.(...args as never[]); },
    readPlaywrightVersion(...args: unknown[]) { events.push('version'); return overrides.readPlaywrightVersion ? overrides.readPlaywrightVersion(...args as never[]) : '1.62.1'; },
    resolveChromiumPath: () => '/fake/chromium',
    async fetch(input: string | URL, opts: RequestInit = {}) {
      const url = String(input); fetchCalls.push({ url, opts }); events.push(new URL(url).pathname);
      if (overrides.fetch) return overrides.fetch(url, opts);
      return successfulFetch(url, opts);
    },
    async runProcess(command: string, args: string[], opts: ProcessOptions) {
      const kind = args.includes('pack') ? 'pack' : args.includes('install') ? 'install' : args.includes('--input-type=module') ? 'chromium'
        : command.endsWith('/vitest') ? 'judge' : args.includes('generate') ? 'generate' : args.includes('check') ? 'check'
          : args.includes('heal') && args.includes('--dry-run') ? 'heal-dry-run'
            : args.includes('heal') && args.includes('--yes') ? 'heal-apply' : args.includes('--resolve') ? 'resolve' : 'replay';
      const call = { argv: [command, ...args], opts, kind }; processCalls.push(call); events.push(kind);
      return overrides.runProcess ? overrides.runProcess(call) : successfulProcess(call);
    },
  };
  return { deps, signals, signalCalls, stdout, stderr, events, runnerCalls, processCalls, starts, fetchCalls, containers,
    tmpRoot, repoRoot, fixture, manifest, successfulProcess, successfulFetch,
    out: () => stdout.join(''), err: () => stderr.join(''), calls: (kind: string) => processCalls.filter((c) => c.kind === kind),
    runnerCount: (method: string) => runnerCalls.filter((c) => c.method === method).length,
    passwordGenerated: () => randomBytesSizes.includes(16),
    roots: () => fs.readdirSync(tmpRoot).filter((name) => name.startsWith('ambercast-verify-memos-')) };
}
type Fake = ReturnType<typeof createFakeDeps>;
async function run(f: Fake, argv: string[] = [], platform = 'linux') { return main(argv, platform, f.deps, f.signals); }
function last(f: Fake) { return f.out().trimEnd().split('\n').at(-1)!; }
function fail(f: Fake, stage: string, aiCalls = 'n/a') {
  expect(last(f)).toMatch(new RegExp(`^verify-memos: FAIL stage=${stage} reason=.+ aiCalls=${aiCalls}$`));
  expect(f.out().match(/verify-memos: (PASS|FAIL)/g)).toHaveLength(1);
}

const groupMessage = (pgid: number) => `process group ${pgid} not confirmed terminated`;
function uniqueGroups(f: Fake, ...pgids: number[]) {
  const reason = last(f).split(' reason=')[1]!.replace(/ aiCalls=.*$/, '');
  for (const pgid of new Set(pgids)) expect(reason.split(groupMessage(pgid))).toHaveLength(2);
}
function unconfirmed(pgid: number, stdout = ''): ProcessResult {
  return { ...result(0, stdout), termination: 'unconfirmed', pgid };
}
function noPublication(f: Fake, before: Record<string, string>) {
  expect(snapshot(f.fixture)).toEqual(before);
  expect(vi.mocked(fs.renameSync).mock.calls.filter(([, target]) =>
    publications.some(file => String(target) === join(f.fixture, file)))).toEqual([]);
}
function cleaned(f: Fake) {
  expect(f.containers.size).toBe(0);
  expect(f.roots()).toEqual([]);
  if (f.starts.length) expect(f.runnerCount('removeContainer')).toBeGreaterThanOrEqual(1);
}
function patches(f: Fake) {
  return f.fetchCalls.filter(c => new URL(c.url).pathname === settingsPath && c.opts.method === 'PATCH');
}
function restorePatches(f: Fake) {
  return patches(f).filter(c => JSON.parse(String(c.opts.body)).generalSetting.additionalScript === '');
}
function expectRestored(f: Fake) {
  expect(restorePatches(f)).toHaveLength(1);
  expect(restorePatches(f)[0]!.opts.signal).toBeInstanceOf(AbortSignal);
  expect(restorePatches(f)[0]!.opts.signal!.aborted).toBe(false);
}
function expectCommand(call: ProcessCall, args: string[], timeoutMs: number) {
  expect(call.argv.slice(1)).toEqual(args);
  expect(call.opts.timeoutMs).toBe(timeoutMs);
}
function fullJudges(f: Fake) {
  return f.calls('judge').filter(c => c.opts.env.AMBERCAST_VERIFY_MEMOS_MODE === 'full');
}

describe('TEST-77 unconfirmed termination evidence', () => {
  it('does not replay raw fragments after cross-stream redaction of an unconfirmed child', async () => {
    const f: Fake = createFakeDeps({ runProcess: async call => {
      if (call.kind !== 'resolve') return f.successfulProcess(call);
      vi.spyOn(process, 'kill').mockImplementation(() => true);
      let now = 0;
      vi.spyOn(Date, 'now').mockImplementation(() => { now += 6000; return now; });
      vi.mocked(childProcess.spawn).mockImplementationOnce(() => {
        const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; pid: number };
        child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.pid = 41999;
        queueMicrotask(() => {
          child.stderr.emit('data', password.slice(0, 16));
          child.stdout.emit('data', password.slice(16));
          child.stderr.emit('data', '\n');
          child.stderr.emit('data', password.slice(0, 16));
          child.stdout.emit('data', password.slice(16));
          child.stderr.emit('data', '\n');
        });
        return child as never;
      });
      return runProcess(call.argv[0], call.argv.slice(1), { ...call.opts, timeoutMs: 0 });
    } });
    expect(await run(f, ['--regenerate'])).toBe(1);
    expect(f.err()).toContain('[redacted]');
    expect(f.err()).not.toContain(password.slice(0, 16));
    uniqueGroups(f, 41999);
    cleaned(f);
  });

  it.each(['replay', 'cleanup'])('reserves diagnostic space after a long %s reason', async point => {
    const f: Fake = createFakeDeps({
      runProcess: call => {
        if (point === 'replay' && call.kind === 'replay') return result(7, JSON.stringify({ ...report, errors: [{ message: 'replay failed ' + 'x'.repeat(500) }] }));
        if (call.kind === 'judge') return unconfirmed(41901);
        return f.successfulProcess(call);
      },
      runner: {
        removeContainer: async (name: string) => { f.containers.delete(name); throw new Error('cleanup failed ' + 'x'.repeat(500)); },
        listContainers: async () => { if (f.calls('judge').length) throw new TerminationUnconfirmedError(41902); return [...f.containers]; },
      },
    });
    expect(await run(f)).toBe(1);
    const reason = last(f).split(' reason=')[1]!.replace(/ aiCalls=.*$/, '');
    expect(reason.length).toBeLessThanOrEqual(400);
    expect(reason).toContain(point === 'replay' ? 'exit=7 replay failed' : groupMessage(41901));
    uniqueGroups(f, 41901, 41902);
    cleaned(f);
  });

  it('keeps both partial-publication lists beside a long cleanup failure', async () => {
    let removals = 0;
    const f: Fake = createFakeDeps({ runner: { removeContainer: async (name: string) => {
      f.containers.delete(name);
      if (++removals > 1) throw new Error('cleanup failed ' + 'x'.repeat(500));
    } } });
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
    vi.mocked(fs.renameSync).mockImplementation((source, destination) => {
      if (String(destination) === join(f.fixture, plan)) throw new Error('rename failed');
      return actual.renameSync(source, destination);
    });
    expect(await run(f, ['--regenerate'])).toBe(1);
    const reason = last(f).split(' reason=')[1]!.replace(/ aiCalls=.*$/, '');
    expect(reason.length).toBeLessThanOrEqual(400);
    expect(reason).toMatch(/^rename failed; teardown failed: cleanup failed/);
    expect(reason).toContain(`; published files: 1 of ${publications.length}`);
    expect(reason).toContain(`; fixture updated: 1 of ${publications.length}`);
    cleaned(f);
  });
  it.each(['SIGINT', 'SIGTERM'].flatMap(signal => ['container', 'residual'].map(point => ({ signal, point }))))
  ('records first evidence in $point cleanup during $signal and finishes cleanup', async ({ signal, point }) => {
    const f: Fake = createFakeDeps({ runner: {
      removeContainer: async (name: string) => {
        f.containers.delete(name);
        if (point === 'container') {
          f.signals.emit(signal);
          throw new TerminationUnconfirmedError(41010);
        }
      },
      listContainers: async () => {
        if (f.calls('judge').length) {
          // Neither group has appeared in a child or verification-stage error.
          f.signals.emit(point === 'residual' ? signal : signal === 'SIGINT' ? 'SIGTERM' : 'SIGINT');
          throw new TerminationUnconfirmedError(41011);
        }
        return [...f.containers];
      },
    } });
    const before = snapshot(f.fixture);
    expect(await run(f)).toBe(signal === 'SIGINT' ? 130 : 143);
    fail(f, 'teardown');
    expect(last(f)).toContain('reason=interrupted; teardown failed: ');
    uniqueGroups(f, ...(point === 'container' ? [41010, 41011] : [41011]));
    if (point === 'residual') expect(last(f)).toBe(`verify-memos: FAIL stage=teardown reason=interrupted; teardown failed: ${groupMessage(41011)} aiCalls=n/a`);
    expect(f.events.lastIndexOf('listContainers')).toBeGreaterThan(f.events.lastIndexOf('removeContainer'));
    expect(f.signalCalls.filter(call => call.method === 'off')).toHaveLength(2);
    noPublication(f, before); cleaned(f);
  });

  it.each(['same', 'distinct'].flatMap(groups => [false, true].map(earlier => ({ groups, earlier }))))
  ('renders $groups pgids once across cleanup aggregates (earlier=$earlier)', async ({ groups, earlier }) => {
    const second = groups === 'same' ? 41012 : 41013;
    const f: Fake = createFakeDeps({
      runProcess: call => earlier && call.kind === 'replay' ? result(9, reportText) : f.successfulProcess(call),
      runner: {
        removeContainer: async (name: string) => {
          f.containers.delete(name);
          throw new TerminationUnconfirmedError(41012);
        },
        listContainers: async () => {
          if (f.calls('judge').length) throw new TerminationUnconfirmedError(second);
          return [...f.containers];
        },
      },
    });
    const before = snapshot(f.fixture);
    expect(await run(f)).toBe(1);
    fail(f, earlier ? 'replay' : 'teardown', '0');
    if (earlier) expect(last(f)).toContain('reason=exit=9; teardown failed: ');
    uniqueGroups(f, 41012, second);
    noPublication(f, before); cleaned(f);
  });

  it.each(['SIGINT', 'SIGTERM'].flatMap(signal => ['hasImage', 'stale-list', 'disclosure-judge'].map(point => ({ signal, point }))))
  ('records $point evidence before $signal can mask it', async ({ signal, point }) => {
    const f: Fake = createFakeDeps({
      runner: {
        hasImage: async () => {
          if (point === 'hasImage') { f.signals.emit(signal); throw new TerminationUnconfirmedError(41009); }
          return true;
        },
        listContainers: async () => {
          if (point === 'stale-list' && !f.calls('install').length) {
            f.signals.emit(signal); throw new TerminationUnconfirmedError(41009);
          }
          return [...f.containers];
        },
      },
      runProcess: async call => {
        if (point === 'disclosure-judge' && call.kind === 'replay') return result(7, reportText);
        if (point === 'disclosure-judge' && call.kind === 'judge') {
          f.signals.emit(signal); return unconfirmed(41009);
        }
        return f.successfulProcess(call);
      },
    });
    const before = snapshot(f.fixture);
    expect(await run(f, ['--regenerate'])).toBe(signal === 'SIGINT' ? 130 : 143);
    expect(last(f)).toBe(`verify-memos: FAIL stage=${point === 'disclosure-judge' ? 'replay' : 'preflight'} reason=interrupted; teardown failed: ${groupMessage(41009)} aiCalls=n/a`);
    expect(f.calls('judge')).toHaveLength(point === 'disclosure-judge' ? 1 : 0);
    if (point === 'disclosure-judge') expect(f.calls('judge')[0]!.opts.env.AMBERCAST_VERIFY_MEMOS_MODE).toBe('disclosure-only');
    noPublication(f, before); cleaned(f);
  });

  it.each(['install', 'generate', 'resolve', 'replay', 'judge'])('stops after an unconfirmed %s child and continues cleanup', async kind => {
    const f: Fake = createFakeDeps({ runProcess: async call => {
      const success = await f.successfulProcess(call);
      if (call.kind === kind) call.opts.onStderrChunk?.('child diagnostic');
      return call.kind === kind ? { ...success, ...unconfirmed(41001, success.stdout), stderr: 'child diagnostic' } : success;
    } });
    const before = snapshot(f.fixture);
    expect(await run(f, ['--regenerate'])).toBe(1);
    fail(f, kind === 'generate' ? 'fixture' : kind === 'resolve' ? 'replay' : kind, kind === 'judge' ? '0' : 'n/a');
    expect(last(f)).toBe(`verify-memos: FAIL stage=${kind === 'generate' ? 'fixture' : kind === 'resolve' ? 'replay' : kind} reason=${groupMessage(41001)} aiCalls=${kind === 'judge' ? '0' : 'n/a'}`);
    uniqueGroups(f, 41001);
    expect(f.err()).toContain('child diagnostic');
    expect(f.processCalls.at(-1)!.kind).toBe(kind);
    noPublication(f, before); cleaned(f);
  });

  it.each(['hasImage', 'reset-remove'])('attributes a Docker %s failure to its caller stage', async point => {
    let removals = 0;
    const docker = createDockerRunner(async () => unconfirmed(41002));
    const f: Fake = createFakeDeps({ runner: {
      hasImage: async (...args: never[]) => point === 'hasImage' ? docker.hasImage(...args) : true,
      removeContainer: async (name: string) => {
        if (point === 'reset-remove' && ++removals === 1) return docker.removeContainer(name);
        f.containers.delete(name);
      },
    } });
    const before = snapshot(f.fixture);
    expect(await run(f, ['--regenerate'])).toBe(1);
    fail(f, point === 'hasImage' ? 'preflight' : 'replay');
    expect(last(f)).toBe(`verify-memos: FAIL stage=${point === 'hasImage' ? 'preflight' : 'replay'} reason=${groupMessage(41002)} aiCalls=n/a`);
    uniqueGroups(f, 41002);
    expect(f.calls('replay')).toEqual([]); expect(f.calls('judge')).toEqual([]);
    expect(f.starts).toHaveLength(point === 'hasImage' ? 0 : 1);
    noPublication(f, before); cleaned(f);
  });

  it.each(['removeContainer', 'listContainers'])('retains teardown %s evidence while finishing other cleanup', async method => {
    const docker = createDockerRunner(async () => unconfirmed(41003));
    let hit = false;
    const f: Fake = createFakeDeps({ runner: {
      removeContainer: async (name: string) => {
        f.containers.delete(name);
        if (method === 'removeContainer') { hit = true; await docker.removeContainer(name); }
      },
      listContainers: async () => {
        if (method === 'listContainers' && f.calls('judge').length) { hit = true; return docker.listContainers(); }
        return [...f.containers];
      },
    } });
    const before = snapshot(f.fixture);
    expect(await run(f)).toBe(1);
    fail(f, 'teardown', '0'); expect(hit).toBe(true);
    expect(last(f)).toContain(groupMessage(41003));
    uniqueGroups(f, 41003);
    expect(f.calls('judge')).toHaveLength(1);
    noPublication(f, before); cleaned(f);
  });

  it('preserves the nonzero replay reason when its disclosure-only judge is unconfirmed', async () => {
    const f: Fake = createFakeDeps({ runProcess: async call => {
      if (call.kind === 'replay') return result(7, reportText);
      if (call.kind === 'judge') return unconfirmed(41004);
      return f.successfulProcess(call);
    } });
    const before = snapshot(f.fixture);
    expect(await run(f, ['--regenerate'])).toBe(1);
    expect(last(f)).toBe(`verify-memos: FAIL stage=replay reason=exit=7; ${groupMessage(41004)} aiCalls=0`);
    uniqueGroups(f, 41004);
    expect(f.calls('judge')).toHaveLength(1);
    expect(f.calls('judge')[0]!.opts.env.AMBERCAST_VERIFY_MEMOS_MODE).toBe('disclosure-only');
    expect(f.processCalls.at(-1)!.kind).toBe('judge');
    noPublication(f, before); cleaned(f);
  });

  it('appends teardown evidence to an earlier stage failure', async () => {
    let removals = 0;
    const f: Fake = createFakeDeps({ runProcess: call => call.kind === 'replay' ? result(9, reportText) : f.successfulProcess(call),
      runner: { removeContainer: async (name: string) => {
        f.containers.delete(name);
        if (++removals > 1) throw new TerminationUnconfirmedError(41005);
      } } });
    const before = snapshot(f.fixture);
    expect(await run(f, ['--regenerate'])).toBe(1);
    fail(f, 'replay', '0');
    expect(last(f)).toBe(`verify-memos: FAIL stage=replay reason=exit=9; teardown failed: ${groupMessage(41005)} aiCalls=0`);
    uniqueGroups(f, 41005);
    expect(f.calls('judge')).toHaveLength(1);
    expect(f.calls('judge')[0]!.opts.env.AMBERCAST_VERIFY_MEMOS_MODE).toBe('disclosure-only');
    noPublication(f, before); cleaned(f);
  });

  it.each(['SIGINT', 'SIGTERM'].flatMap(signal => ['same', 'distinct', 'ordinary'].map(cleanup => ({ signal, cleanup }))))
  ('retains $signal stage and deduplicates $cleanup cleanup evidence', async ({ signal, cleanup }) => {
    let removals = 0;
    const f: Fake = createFakeDeps({ runProcess: async call => {
      if (call.kind === 'replay') { f.signals.emit(signal); return unconfirmed(41006, reportText); }
      return f.successfulProcess(call);
    }, runner: { removeContainer: async (name: string) => {
      f.containers.delete(name);
      if (++removals > 1) {
        if (cleanup === 'ordinary') throw new Error('ordinary cleanup failed');
        throw new TerminationUnconfirmedError(cleanup === 'same' ? 41006 : 41007);
      }
    } } });
    const before = snapshot(f.fixture);
    expect(await run(f, ['--regenerate', '--keep'])).toBe(signal === 'SIGINT' ? 130 : 143);
    fail(f, 'replay');
    expect(last(f)).toContain('reason=interrupted; teardown failed: ');
    expect(last(f).split(groupMessage(41006))).toHaveLength(2);
    if (cleanup === 'distinct') expect(last(f).split(groupMessage(41007))).toHaveLength(2);
    if (cleanup === 'ordinary') expect(last(f)).toContain('ordinary cleanup failed');
    if (cleanup === 'same') expect(last(f)).toBe(`verify-memos: FAIL stage=replay reason=interrupted; teardown failed: ${groupMessage(41006)} aiCalls=n/a`);
    expect(f.calls('judge')).toEqual([]); expect(f.processCalls.at(-1)!.kind).toBe('replay');
    noPublication(f, before); cleaned(f);
  });

  it('fails with --keep and prints the manual process-group cleanup command', async () => {
    const f: Fake = createFakeDeps({ runProcess: async call => call.kind === 'replay' ? unconfirmed(41008, reportText) : f.successfulProcess(call) });
    const before = snapshot(f.fixture);
    expect(await run(f, ['--regenerate', '--keep'])).toBe(1);
    fail(f, 'replay'); expect(last(f)).toContain(groupMessage(41008));
    expect(f.err()).toContain(`${groupMessage(41008)}; kill -9 -41008`);
    expect(f.calls('judge')).toEqual([]); noPublication(f, before);
    expect(f.roots()).toHaveLength(1); expect(f.containers.size).toBe(1);
  });
});

describe('publication diagnostic budget and event-loop boundary', () => {
  const publishedFiles = publications;
  const reason = (f: Fake) => last(f).split(' reason=')[1]!.replace(/ aiCalls=.*$/, '');

  it.each(['partial', 'full'].flatMap(publication => [-1, 0, 1].map(delta => ({ publication, delta }))))
  ('preserves $publication publication tails at body budget $delta', async ({ publication, delta }) => {
    const list = `${publication === 'partial' ? 1 : publishedFiles.length} of ${publishedFiles.length}`;
    const tail = `${publication === 'partial' ? `; published files: ${list}` : ''}; fixture updated: ${list}`;
    const budget = 400 - tail.length;
    const body = 'x'.repeat(budget + delta);
    let removals = 0;
    const f: Fake = createFakeDeps({ runner: { removeContainer: async (name: string) => {
      f.containers.delete(name);
      if (++removals > 1 && publication === 'full') throw new Error(body);
    } } });
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
    vi.mocked(fs.renameSync).mockImplementation((source, destination) => {
      if (publication === 'partial' && String(destination) === join(f.fixture, plan)) throw new Error(body);
      return actual.renameSync(source, destination);
    });
    expect(await run(f, ['--regenerate'])).toBe(1);
    expect(reason(f)).toBe(body.slice(0, budget) + tail);
    expect(reason(f).length).toBeLessThanOrEqual(400);
    fail(f, publication === 'partial' ? 'fixture' : 'teardown', '0');
    expect(JSON.parse(fs.readFileSync(join(f.fixture, files[0]), 'utf8')).secrets.allow).toEqual(['memos.password']);
    expect(fs.readFileSync(join(f.fixture, plan), 'utf8')).toBe(JSON.stringify(navigationPlan(caseTable[0]!, publication !== 'partial')));
    expect(JSON.parse(fs.readFileSync(join(f.fixture, grounding), 'utf8'))).toEqual(publication === 'partial' ? { seed: caseTable[0]!.id } : { generated: caseTable[0]!.id });
    cleaned(f);
  });

  it.each(['partial', 'full'])('redacts and escapes a long %s body while keeping complete tails', async publication => {
    const body = `${password}\n\r\t\0\u007f` + 's'.repeat(700);
    const list = `${publication === 'partial' ? 1 : publishedFiles.length} of ${publishedFiles.length}`;
    const tail = `${publication === 'partial' ? `; published files: ${list}` : ''}; fixture updated: ${list}`;
    let removals = 0;
    const f: Fake = createFakeDeps({ runner: { removeContainer: async (name: string) => {
      f.containers.delete(name);
      if (++removals > 1 && publication === 'full') throw new Error(body);
    } } });
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
    vi.mocked(fs.renameSync).mockImplementation((source, destination) => {
      if (publication === 'partial' && String(destination) === join(f.fixture, plan)) throw new Error(body);
      return actual.renameSync(source, destination);
    });
    expect(await run(f, ['--regenerate'])).toBe(1);
    const sanitizedBody = '[redacted]\\n\\r\\t\\u0000\\u007f' + 's'.repeat(700);
    expect(reason(f)).toBe(sanitizedBody.slice(0, 400 - tail.length) + tail);
    expect(reason(f)).not.toContain(password);
    expect(reason(f)).not.toMatch(/[\u0000-\u001f\u007f]/);
    expect(reason(f).length).toBeLessThanOrEqual(400); cleaned(f);
  });

  it.each(['success', 'failure', 'not-attempted', 'ordinary'])('yields two turns only after attempted publication: %s', async mode => {
    vi.useFakeTimers({ toFake: ['setImmediate'] });
    try {
      const f: Fake = createFakeDeps({ runProcess: async call => mode === 'not-attempted' && call.kind === 'judge'
        ? result(1, '', 'judge failed') : f.successfulProcess(call) });
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
      let attempted = false, settled = false;
      vi.mocked(fs.renameSync).mockImplementation((source, destination) => {
        if (String(destination) === join(f.fixture, files[0])) {
          attempted = true;
          if (mode === 'failure') throw new Error('publication failed');
        }
        return actual.renameSync(source, destination);
      });
      const outcome = run(f, mode === 'ordinary' ? [] : ['--regenerate']).then(code => { settled = true; return code; });
      // All fake operations settle on microtasks; no unrelated timer advances the boundary.
      for (let i = 0; i < 500 && !settled && vi.getTimerCount() === 0; i++) await Promise.resolve();
      if (mode === 'ordinary' || mode === 'not-attempted') {
        expect(await outcome).toBe(mode === 'ordinary' ? 0 : 1);
        expect(vi.getTimerCount()).toBe(0); expect(attempted).toBe(false);
      } else {
        expect(attempted).toBe(true);
        expect(fs.existsSync(join(f.fixture, '.lock'))).toBe(false);
        expect(f.runnerCount('removeContainer')).toBe(1);
        expect(f.signals.listenerCount('SIGINT')).toBe(1);
        expect(settled).toBe(false); expect(vi.getTimerCount()).toBe(1);
        await vi.advanceTimersToNextTimerAsync();
        expect(settled).toBe(false); expect(f.runnerCount('removeContainer')).toBe(1);
        expect(f.signals.listenerCount('SIGINT')).toBe(1); expect(vi.getTimerCount()).toBe(1);
        await vi.advanceTimersToNextTimerAsync();
        expect(await outcome).toBe(mode === 'success' ? 0 : 1);
        cleaned(f);
      }
    } finally { vi.useRealTimers(); }
  });
});
function stageFake(stage: string): Fake {
  const error = () => { throw new Error(`${stage} failure`); };
  if (stage === 'preflight') return createFakeDeps({ runner: { checkDaemon: error } });
  if (stage === 'port') return createFakeDeps({ assertPortFree: error });
  if (stage === 'container') return createFakeDeps({ runner: { startContainer: error } });
  if (stage === 'ready') return createFakeDeps({ runner: { isRunning: async () => false } });
  if (stage === 'bootstrap') return createFakeDeps({ fetch: async () => ({ status: 200, json: async () => ({ needsSetup: false }) }) });
  const f: Fake = createFakeDeps({ runProcess: (call) => call.kind === stage || (stage === 'fixture' && call.kind === 'check')
    ? result(1, call.kind === 'replay' ? reportText : '', `${stage} failure`) : f.successfulProcess(call) });
  return f;
}
afterEach(async () => {
  vi.unstubAllEnvs(); vi.restoreAllMocks();
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  vi.mocked(fs.renameSync).mockImplementation(actual.renameSync);
  vi.mocked(fs.writeFileSync).mockImplementation(actual.writeFileSync);
  vi.mocked(fs.mkdirSync).mockImplementation(actual.mkdirSync);
  vi.mocked(fs.copyFileSync).mockImplementation(actual.copyFileSync);
  vi.mocked(fs.rmSync).mockImplementation(actual.rmSync);
  vi.mocked(fs.existsSync).mockImplementation(actual.existsSync);
  vi.mocked(fs.readFileSync).mockImplementation(actual.readFileSync);
  const realChild = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  vi.mocked(childProcess.spawn).mockImplementation(realChild.spawn);
  vi.clearAllMocks();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('parseArgs', () => {
  it.each([
    { argv: ['--heal-check'], expected: { healCheck: true } },
    { argv: ['--heal-check', '--keep'], expected: { healCheck: true, keep: true } },
    { argv: ['--heal-check', '--manifest', 'm'], expected: { healCheck: true, manifest: 'm' } },
    { argv: ['--published', '0.10.0'], expected: { published: '0.10.0' } },
    { argv: ['--published', '0.10.0-rc.1', '--heal-check'], expected: { published: '0.10.0-rc.1', healCheck: true } },
    { argv: ['--published', '0.10.0-rc.0'], expected: { published: '0.10.0-rc.0' } },
    { argv: ['--published', '0.10.0-0a'], expected: { published: '0.10.0-0a' } },
    { argv: ['--published', '0.10.0', '--keep'], expected: { published: '0.10.0', keep: true } },
  ])('TEST-544-1 accepts exact versions and compatible heal options ($argv)', ({ argv, expected }) => {
    expect(parseArgs(argv)).toEqual({ manifest: undefined, ai: undefined, allowDirty: false, keep: false,
      regenerate: false, clean: false, healCheck: false, published: undefined, cases: caseIds, ...expected });
  });
  it.each([
    ['--heal-check', '--regenerate'], ['--published'], ['--published', ''], ['--published', 'latest'],
    ['--published', '^0.10.0'], ['--published', '0.10'], ['--published', '01.2.3'], ['--published', '1.2.3-01'],
    ['--published', '1.2.3+build'], ['--published', '0.10.0-'], ['--published', '0.10.0', '--manifest', 'm'],
    ['--published', '0.10.0', '--allow-dirty'], ['--published', '0.10.0', '--regenerate'],
    ['--published', '1.0.0', '--published', '1.0.1'], ['--heal-check', '--heal-check'],
    ['--clean', '--heal-check'], ['--clean', '--published', '1.0.0'],
  ])('TEST-544-1 rejects invalid combinations before any side effect (%s)', async (...argv) => {
    const f = createFakeDeps({});
    expect(await run(f, argv)).toBe(2);
    expect(f.err()).toContain('verify-memos.mjs [--manifest <path> | --published <version>] [--allow-dirty] [--keep] [--case <id>]... [--heal-check] [--regenerate [--ai claude|codex]] | --clean');
    expect(f.out()).toBe(''); expect(f.runnerCalls).toEqual([]); expect(f.processCalls).toEqual([]);
    expect(f.fetchCalls).toEqual([]); expect(f.roots()).toEqual([]);
  });
  // Omitted manifest/ai come back undefined rather than absent keys; missing
  // keys and explicit undefined have identical option behavior, and toEqual
  // accepts both representations.
  it.each([
    { argv: [], expected: {} },
    { argv: ['--keep'], expected: { keep: true } },
    { argv: ['--allow-dirty'], expected: { allowDirty: true } },
    { argv: ['--manifest', 'relative.json'], expected: { manifest: 'relative.json' } },
    { argv: ['--regenerate'], expected: { regenerate: true } },
    { argv: ['--regenerate', '--ai', 'codex'], expected: { regenerate: true, ai: 'codex' } },
    { argv: ['--regenerate', '--ai', 'claude'], expected: { regenerate: true, ai: 'claude' } },
    { argv: ['--clean'], expected: { clean: true } },
    { argv: ['--manifest', 'p', '--keep', '--regenerate', '--ai', 'codex'], expected: { manifest: 'p', keep: true, regenerate: true, ai: 'codex' } },
    { argv: ['--allow-dirty', '--keep', '--regenerate'], expected: { allowDirty: true, keep: true, regenerate: true } },
  ])('TEST-1 accepts every valid argument combination', ({ argv, expected }) => {
    expect(parseArgs(argv)).toEqual({ manifest: undefined, ai: undefined,
      allowDirty: false, keep: false, regenerate: false, clean: false, healCheck: false, published: undefined, cases: caseIds, ...expected });
  });
  it.each([
    ['--unknown'], ['--keep', '--keep'], ['--allow-dirty', '--allow-dirty'], ['--manifest'], ['--ai'], ['positional'],
    ['--clean', '--keep'], ['--clean', '--manifest', 'p'], ['--clean', '--regenerate'], ['--ai', 'claude'],
    ['--regenerate', '--ai', 'x'], ['--allow-dirty', '--manifest', 'p'], ['--manifest', 'p', '--manifest', 'q'],
    ['--regenerate', '--ai', 'claude', '--ai', 'codex'], ['--regenerate', '--regenerate'], ['--clean', '--clean'],
  ])('TEST-2 rejects every invalid argument combination with exit 2', async (...argv) => {
    const f: Fake = createFakeDeps(); expect(await run(f, argv)).toBe(2);
    expect(f.err()).toMatch(/verify-memos\.mjs \[--manifest <path> \| --published <version>\]/); expect(f.out()).toBe('');
    expect(f.runnerCalls).toEqual([]); expect(f.processCalls).toEqual([]); expect(f.roots()).toEqual([]);
  });
  it('TEST-3 rejects on win32 before argument parsing', async () => {
    const f: Fake = createFakeDeps(); expect(await run(f, ['--unknown'], 'win32')).toBe(2);
    expect(f.err()).toContain('verify-memos: Windows is not supported'); expect(f.err()).not.toContain('[--manifest');
    expect(f.out()).toBe(''); expect(f.runnerCalls).toEqual([]); expect(f.processCalls).toEqual([]); expect(f.roots()).toEqual([]);
  });
});

const selUsage = 'verify-memos.mjs [--manifest <path> | --published <version>] [--allow-dirty] [--keep] [--case <id>]... [--heal-check] [--regenerate [--ai claude|codex]] | --clean';
const [signInId, editId, , , tagId] = caseIds as [string, string, string, string, string];
const healId = caseIds[healIndex]!;
const passLine = (tail: string, head = 'PASS') => `verify-memos: ${head} aiCalls=0 sha=${sha.slice(0, 12)} memos=0.31.0${tail}`;
const without = (ids: readonly string[], drop: string) => ids.filter(id => id !== drop);
/** Marks cases as known failures on the shared table for one test, restoring it afterwards. */
async function withMarks(marks: Record<number, unknown>, body: () => Promise<void>) {
  const table = caseTable as unknown as Record<string, unknown>[];
  for (const [i, value] of Object.entries(marks)) table[Number(i)]!.knownIssue = value;
  try { await body(); } finally { for (const i of Object.keys(marks)) delete table[Number(i)]!.knownIssue; }
}
function untouched(f: Fake) {
  expect(f.out()).toBe(''); expect(f.runnerCalls).toEqual([]); expect(f.processCalls).toEqual([]);
  expect(f.fetchCalls).toEqual([]); expect(f.roots()).toEqual([]);
}

describe('parseArgs case selection', () => {
  it('TEST-SEL-1 orders the selection by the case table, not by argument order', () => {
    expect(parseArgs(['--case', tagId, '--case', signInId]).cases).toEqual([signInId, tagId]);
  });
  it('TEST-SEL-2 selects every case without --case', () => {
    expect(parseArgs([]).cases).toEqual(caseIds);
  });
  it.each([
    [['--case', 'memos-unknown']], [['--case', '']], [['--case', '--keep']], [['--case']], [[`--case=${signInId}`]],
    [['--case', signInId, '--case', signInId]], [['--clean', '--case', signInId]], [['--case', signInId, '--case', tagId, '--clean']],
    [['--regenerate', '--case', signInId]], [['--case', signInId, '--regenerate']],
    [['--heal-check', '--case', signInId]], [['--case', 'positional-extra', signInId]],
  ])('TEST-SEL-3 rejects invalid selections with the exact usage text and no side effect (%j)', async argv => {
    const f: Fake = createFakeDeps(); expect(await run(f, argv)).toBe(2);
    expect(f.err()).toBe(`${selUsage}\n`); untouched(f);
  });
  it('TEST-SEL-4 accepts --heal-check only when the selection contains the heal case', async () => {
    expect(parseArgs(['--heal-check', '--case', healId]).cases).toEqual([healId]);
    expect(() => parseArgs(['--heal-check', '--case', signInId])).toThrow();
    const f: Fake = createFakeDeps({ fixtureCases: [healId] });
    expect(await run(f, ['--heal-check', '--case', healId])).toBe(0);
  });
  it.each([['--keep'], ['--allow-dirty'], ['--manifest', 'm.json']])('TEST-SEL-1 combines with %s', (...extra) => {
    expect(parseArgs([...extra, '--case', signInId]).cases).toEqual([signInId]);
  });
  it('TEST-SEL-1 combines with --published', () => {
    expect(parseArgs(['--published', '0.10.0', '--case', signInId]).cases).toEqual([signInId]);
  });
});

describe('main case selection', () => {
  it('TEST-SEL-5 copies, checks, replays and judges only the selected case', async () => {
    const f = createFakeDeps({ fixtureCases: [signInId] });
    for (const other of prompts.slice(1)) fs.unlinkSync(join(f.fixture, other));
    expect(await run(f, ['--case', signInId])).toBe(0);
    const copied = vi.mocked(fs.copyFileSync).mock.calls.map(([from]) => relative(f.fixture, String(from))).filter(p => !p.startsWith('..'));
    expect(copied).toEqual([files[0], prompts[0], plans[0], groundings[0]]);
    expectCommand(f.calls('check')[0]!, ['check', '--json', prompt], 120_000);
    expectCommand(f.calls('replay')[0]!, ['run', '--json', '--no-color', prompt], 120_000);
    const judge = fullJudges(f); expect(judge).toHaveLength(1);
    expect(judge[0]!.opts.env.AMBERCAST_VERIFY_MEMOS_EXPECTED_CASES).toBe('1');
    const cwd = f.calls('replay')[0]!.opts.cwd;
    expect(JSON.parse(judge[0]!.opts.env.AMBERCAST_VERIFY_MEMOS_ARTIFACT_ROOTS!)).toEqual([join(cwd, 'tests/ambercast/.runs'), join(cwd, plan), join(cwd, grounding)]);
  });
  it('TEST-SEL-6 does not shrink the required set to the fixture files that exist', async () => {
    const f = createFakeDeps({ fixtureCases: [signInId] });
    expect(await run(f)).toBe(1); fail(f, 'preflight');
    expect(last(f)).toContain('missing fixture tests/ambercast/memos-edit-memo.ambercast.plan.json');
    expect(f.calls('pack')).toEqual([]); expect(f.starts).toEqual([]);
  });
  it('TEST-SEL-7 validates the whole case table even for a one-case selection', async () => {
    const f = createFakeDeps({ fixtureCases: [signInId] });
    const configPath = join(f.fixture, files[0]), config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    delete config.targets['memos-ja']; write(configPath, JSON.stringify(config));
    expect(await run(f, ['--case', signInId])).toBe(1); fail(f, 'fixture'); expect(f.starts).toEqual([]);
  });
  it('TEST-SEL-8 marks a subset pass as PASS-PARTIAL with the selected ids in table order', async () => {
    const f = createFakeDeps({ fixtureCases: [signInId, tagId] });
    expect(await run(f, ['--case', tagId, '--case', signInId])).toBe(0);
    expect(last(f)).toBe(passLine(` cases=${signInId},${tagId}`, 'PASS-PARTIAL'));
    expect(f.out()).not.toContain('PASS aiCalls');
  });
  it.each([[caseIds.flatMap(id => ['--case', id])], [[]]])('TEST-SEL-9 keeps the whole-set line unchanged (%j)', async argv => {
    const f = createFakeDeps({}); expect(await run(f, argv)).toBe(0);
    expect(last(f)).toBe(passLine(''));
  });
  it('TEST-SEL-10 combines a selection with --published without packing', async () => {
    const f = createFakeDeps({ fixtureCases: [signInId] });
    expect(await run(f, ['--published', '0.10.0', '--case', signInId])).toBe(0);
    expect(last(f)).toBe(`verify-memos: PASS-PARTIAL aiCalls=0 package=ambercast@0.10.0 memos=0.31.0 cases=${signInId}`);
    expect(f.calls('pack')).toEqual([]);
  });
  it('TEST-SEL-11 runs selection replay, full judge, then the heal protocol on the heal case only', async () => {
    const f = createFakeDeps({ fixtureCases: [signInId, healId] });
    expect(await run(f, ['--heal-check', '--case', healId, '--case', signInId])).toBe(0);
    expect(last(f)).toBe(passLine(` cases=${signInId},${healId} heal=healed healAiCalls=5`, 'PASS-PARTIAL'));
    const replays = f.calls('replay').map(c => c.argv.slice(4));
    expect(replays).toEqual([[prompts[0], healPrompt], [healPrompt], [healPrompt], [healPrompt]]);
    expect(fullJudges(f)[0]!.opts.env.AMBERCAST_VERIFY_MEMOS_EXPECTED_CASES).toBe('2');
    const order = f.events.filter(e => ['replay', 'judge', 'heal-dry-run', 'heal-apply'].includes(e));
    expect(order.slice(0, 3)).toEqual(['replay', 'judge', 'replay']);
    expect(order.indexOf('heal-dry-run')).toBeGreaterThan(2);
  });
});

describe('main known failures', () => {
  const others = without(caseIds, editId);
  it('TEST-SEL-13 leaves a marked case out of the default selection and names it on the pass line', async () => {
    await withMarks({ 1: 632 }, async () => {
      const f = createFakeDeps({ fixtureCases: others });
      expect(await run(f)).toBe(0);
      const rest = prompts.filter(p => p !== prompts[1]);
      expect(f.calls('check')[0]!.argv.slice(3)).toEqual(rest);
      expect(f.calls('replay')[0]!.argv.slice(4)).toEqual(rest);
      expect(last(f)).toBe(passLine(` known=${editId}#632`));
    });
  });
  it.each(['.ambercast.plan.json', '.ambercast.grounding.json'])('TEST-SEL-14 fails preflight when a marked case has a fixture (%s)', async suffix => {
    await withMarks({ 1: 632 }, async () => {
      const f = createFakeDeps({ fixtureCases: others });
      write(join(f.fixture, `tests/ambercast/${editId}${suffix}`), '{}');
      expect(await run(f)).toBe(1); fail(f, 'preflight');
      expect(last(f)).toContain(`known failure ${editId} (#632) has a fixture; remove knownIssue from CASES`);
      expect(f.starts).toEqual([]); expect(f.calls('pack')).toEqual([]);
    });
  });
  it('TEST-SEL-15 refuses to select a marked case explicitly', async () => {
    await withMarks({ 1: 632 }, async () => {
      const f: Fake = createFakeDeps(); expect(await run(f, ['--case', editId])).toBe(2); untouched(f);
    });
  });
  it.each([
    { name: 'heal case marked', marks: { 5: 632 } }, { name: 'zero', marks: { 1: 0 } }, { name: 'string', marks: { 1: '632' } },
    { name: 'fraction', marks: { 1: 1.5 } }, { name: 'every case marked', marks: Object.fromEntries(caseIds.map((_, i) => [i, 632])) },
  ])('TEST-SEL-16 rejects an invalid mark as a fixture failure before reporting files ($name)', async ({ marks }) => {
    await withMarks(marks, async () => {
      const f = createFakeDeps({});
      expect(await run(f)).toBe(1); fail(f, 'fixture'); expect(f.calls('pack')).toEqual([]); expect(f.starts).toEqual([]);
    });
  });
  it('TEST-SEL-17 shows the mark next to a subset pass', async () => {
    await withMarks({ 1: 632 }, async () => {
      const f = createFakeDeps({ fixtureCases: others });
      expect(await run(f, ['--case', signInId])).toBe(0);
      expect(last(f)).toBe(passLine(` cases=${signInId} known=${editId}#632`, 'PASS-PARTIAL'));
    });
  });
  it('TEST-SEL-18 regenerates, resolves, replays, judges and publishes only unmarked cases', async () => {
    await withMarks({ 1: 632 }, async () => {
      const f = createFakeDeps({ fixtureCases: others }), actual = await vi.importActual<typeof import('node:fs')>('node:fs');
      const renamed: string[] = [];
      vi.mocked(fs.renameSync).mockImplementation((source, destination) => {
        renamed.push(relative(f.fixture, String(destination))); return actual.renameSync(source, destination);
      });
      expect(await run(f, ['--regenerate'])).toBe(0);
      const rest = prompts.filter(p => p !== prompts[1]);
      expect(f.calls('generate').flatMap(c => c.argv)).not.toContain(prompts[1]);
      expect(f.calls('generate')).toHaveLength(3);
      expectCommand(f.calls('resolve')[0]!, ['run', '--resolve', '--update-cache', '--json', ...rest], 900_000 * 6);
      expectCommand(f.calls('replay')[0]!, ['run', '--json', '--no-color', ...rest], 120_000 * 6);
      const judge = fullJudges(f)[0]!;
      expect(judge.opts.env.AMBERCAST_VERIFY_MEMOS_EXPECTED_CASES).toBe('6');
      const cwd = f.calls('replay')[0]!.opts.cwd;
      const keep = (list: string[]) => list.filter((_, i) => i !== 1);
      expect(JSON.parse(judge.opts.env.AMBERCAST_VERIFY_MEMOS_ARTIFACT_ROOTS!)).toEqual([
        join(cwd, 'tests/ambercast/.runs'), ...keep(plans).map(p => join(cwd, p)), ...keep(groundings).map(p => join(cwd, p))]);
      const expected = [files[0], ...keep(plans), ...keep(groundings)];
      expect(renamed.filter(p => publications.includes(p))).toEqual(expected);
      expect(f.err()).toContain(`verify-memos: published files: ${expected.join(', ')}`);
    });
  });
  it('TEST-SEL-18 skips generate for a target left with no case', async () => {
    await withMarks({ 6: 637 }, async () => {
      const f = createFakeDeps({ fixtureCases: without(caseIds, caseIds[6]!) });
      expect(await run(f, ['--regenerate'])).toBe(0);
      expect(f.calls('generate').map(c => c.argv[3])).toEqual(['memos', 'memos-readonly']);
    });
  });
  it('TEST-SEL-18 counts the reduced publication set when the second rename fails', async () => {
    await withMarks({ 1: 632 }, async () => {
      const f = createFakeDeps({ fixtureCases: others }), actual = await vi.importActual<typeof import('node:fs')>('node:fs');
      let attempted = 0;
      vi.mocked(fs.renameSync).mockImplementation((source, destination) => {
        if (publications.some(p => String(destination) === join(f.fixture, p)) && ++attempted === 2) throw new Error('rename failed');
        return actual.renameSync(source, destination);
      });
      expect(await run(f, ['--regenerate'])).toBe(1); fail(f, 'fixture', '0');
      expect(last(f)).toContain('published files: 1 of 13');
    });
  });
});

describe('main', () => {
  describe('case set', () => {
    it.each(suiteFiles.flatMap(file => [false, true].map(regenerate => ({ file, regenerate }))))
    ('TEST-544-6 checks every required fixture before packing ($file, regenerate=$regenerate)', async ({ file, regenerate }) => {
      const f = createFakeDeps({});
      fs.unlinkSync(join(f.fixture, file));
      const optional = regenerate && /\.ambercast\.(plan|grounding)\.json$/.test(file);
      expect(await run(f, regenerate ? ['--regenerate'] : [])).toBe(optional ? 0 : 1);
      if (optional) {
        expect(f.calls('generate')).toHaveLength(3); expect(f.starts).toHaveLength(2);
      } else {
        fail(f, 'preflight'); expect(last(f)).toContain(file);
        if (file.endsWith('.test.md') || file === files[0]) {
          expect(last(f)).toContain('git checkout -- test/verification/memos/fixture');
          expect(last(f)).not.toContain('--regenerate');
        } else expect(last(f)).toContain('--regenerate');
        expect(f.starts).toEqual([]); expect(f.calls('pack')).toEqual([]); expect(f.roots()).toEqual([]);
      }
    });
    it.each(['missing-readonly', 'stateful-readonly', 'writable-idempotent', 'duplicate-id'])
    ('TEST-544-7 rejects unsafe case tables before starting a container (%s)', async mode => {
      const f = createFakeDeps({});
      const configPath = join(f.fixture, files[0]), config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (mode === 'missing-readonly') delete config.targets['memos-readonly'];
      if (mode === 'stateful-readonly') config.targets['memos-readonly'].healReplayIsolation = 'stateful';
      if (mode === 'writable-idempotent') config.targets.memos.healReplayIsolation = 'idempotent';
      write(configPath, JSON.stringify(config));
      const original = caseTable[1]!.id;
      try {
        if (mode === 'duplicate-id') caseTable[1]!.id = caseTable[0]!.id;
        expect(await run(f)).toBe(1); fail(f, 'fixture'); expect(f.starts).toEqual([]);
      } finally { caseTable[1]!.id = original; }
    });
    it('TEST-544-8 checks and replays all cases once with complete judge inputs', async () => {
      const f = createFakeDeps({}); expect(await run(f)).toBe(0);
      expect(f.calls('replay')).toHaveLength(1); expect(f.calls('check')).toHaveLength(1);
      expectCommand(f.calls('replay')[0]!, ['run', '--json', '--no-color', ...prompts], 840_000);
      expectCommand(f.calls('check')[0]!, ['check', '--json', ...prompts], 120_000);
      const judge = fullJudges(f); expect(judge).toHaveLength(1);
      expect(judge[0]!.opts.env.AMBERCAST_VERIFY_MEMOS_EXPECTED_CASES).toBe('7');
      const cwd = f.calls('replay')[0]!.opts.cwd;
      expect(JSON.parse(judge[0]!.opts.env.AMBERCAST_VERIFY_MEMOS_ARTIFACT_ROOTS!)).toEqual([
        join(cwd, 'tests/ambercast/.runs'), ...plans.map(p => join(cwd, p)), ...groundings.map(p => join(cwd, p)),
      ]);
    });
    it('TEST-544-9 reports the failing row identity and sums every replay row', async () => {
      const envelope = suiteReport();
      envelope.results.forEach((row, i) => { row.aiCalls = i; });
      envelope.results[2]!.status = 'failed'; envelope.summary.passed--; envelope.summary.failed++;
      const f: Fake = createFakeDeps({ runProcess: call => call.kind === 'replay'
        ? result(1, JSON.stringify(envelope)) : f.successfulProcess(call) });
      expect(await run(f)).toBe(1); fail(f, 'replay', '21');
      expect(last(f)).toContain('exit=1'); expect(last(f)).toContain('failed');
      expect(last(f)).toContain('tests/ambercast/memos-delete-memo.test.md');
    });
  });
  describe('published', () => {
    it.each([false, true])('TEST-544-2 installs the exact published version once (heal=%s)', async heal => {
      const f = createFakeDeps({});
      expect(await run(f, ['--published', '0.10.0', ...(heal ? ['--heal-check'] : [])])).toBe(0);
      expect(last(f)).toBe(`verify-memos: PASS aiCalls=0 package=ambercast@0.10.0 memos=0.31.0${heal ? ' heal=healed healAiCalls=5' : ''}`);
      expect(f.calls('pack')).toEqual([]); expect(f.calls('install')).toHaveLength(1);
      const install = f.calls('install')[0]!;
      expect(install.argv).toEqual(['npm', 'install', '--save-dev', '--no-audit', '--no-fund', 'ambercast@0.10.0']);
      expect(install.opts.cwd).toBe(f.calls('replay')[0]!.opts.cwd);
      if (!heal) {
        expect(f.calls('generate')).toEqual([]); expect(f.calls('heal-dry-run')).toEqual([]); expect(f.calls('heal-apply')).toEqual([]);
      }
    });
    it.each(['version-mismatch', 'install-fails'])('TEST-544-2 fails installation without retrying (%s)', async mode => {
      const f: Fake = createFakeDeps({ runProcess: async call => {
        if (call.kind !== 'install') return f.successfulProcess(call);
        if (mode === 'install-fails') return result(1, '', 'registry unavailable');
        await f.successfulProcess(call);
        write(join(call.opts.cwd, 'node_modules/ambercast/package.json'), JSON.stringify({ version: '0.10.1' }));
        return result();
      } });
      expect(await run(f, ['--published', '0.10.0'])).toBe(1); fail(f, 'install');
      if (mode === 'version-mismatch') { expect(last(f)).toContain('0.10.0'); expect(last(f)).toContain('0.10.1'); }
      else expect(last(f)).toContain('rerun later');
      expect(f.calls('install')).toHaveLength(1); expect(f.calls('pack')).toEqual([]); expect(f.calls('replay')).toEqual([]);
    });
    it('TEST-544-27 emits one install success and no pack success for a published package', async () => {
      const f = createFakeDeps({}); expect(await run(f, ['--published', '0.10.0'])).toBe(0);
      expect(f.out().match(/^verify-memos: pack ok.*$/gm) ?? []).toHaveLength(0);
      expect(f.out().match(/^verify-memos: install ok.*$/gm)).toHaveLength(1);
    });
  });
  describe('heal check', () => {
    it.each([
      { point: 'H1', aiCalls: '7' }, { point: 'H2', aiCalls: '7' },
      { point: 'H3-zero', aiCalls: '5' }, { point: 'H3-one', aiCalls: '5' },
      { point: 'H4', aiCalls: '0' }, { point: 'H5', aiCalls: '0' },
      { point: 'H6-before-run', aiCalls: '0' }, { point: 'H6-run', aiCalls: '11' },
      { point: 'H6-judge', aiCalls: '11' }, { point: 'H7', aiCalls: '11' },
      { point: 'H8-run', aiCalls: '13' }, { point: 'H8-judge', aiCalls: '13' },
    ])('TEST-544-3 attributes every heal failure to the last completed ordinary replay ($point)', async ({ point, aiCalls }) => {
      let gets = 0;
      const f: Fake = createFakeDeps({         fetch: async (url, opts) => {
          if (new URL(url).pathname === settingsPath) {
            if (opts.method !== 'PATCH' && ++gets === 1 && point === 'H1') return { status: 500, json: async () => ({}) };
            if (opts.method === 'PATCH') {
              const restoring = JSON.parse(String(opts.body)).generalSetting.additionalScript === '';
              if ((point === 'H2' && !restoring) || (point === 'H7' && restoring)) return { status: 500, json: async () => ({}) };
            }
          }
          return f.successfulFetch(url, opts);
        },
        runProcess: async call => {
          if (call.kind === 'replay') {
            const n = f.calls('replay').length;
            if (n === 3 && point === 'H6-before-run') throw new Error('H6 spawn failed');
            const envelope = n === 2 ? brokenReport() : suiteReport(n === 1 ? prompts : [healPrompt], n === 1 ? 1 : n === 3 ? 11 : 13);
            if (n === 2 && point.startsWith('H3')) {
              envelope.results[0]!.aiCalls = 5;
              return result(point === 'H3-zero' ? 0 : 1, JSON.stringify(envelope));
            }
            return result(n === 2 ? 4 : ((n === 3 && point === 'H6-run') || (n === 4 && point === 'H8-run')) ? 1 : 0, JSON.stringify(envelope));
          }
          if ((point === 'H4' && call.kind === 'heal-dry-run') || (point === 'H5' && call.kind === 'heal-apply')) return result(1, JSON.stringify(healReport(call.kind === 'heal-apply')));
          if (call.kind === 'judge' && call.opts.env.AMBERCAST_VERIFY_MEMOS_MODE === 'full') {
            const n = fullJudges(f).length;
            if ((n === 2 && point === 'H6-judge') || (n === 3 && point === 'H8-judge')) return result(1, '', 'judge rejected evidence');
          }
          return f.successfulProcess(call);
        },
      });
      expect(await run(f, ['--heal-check'])).toBe(1); fail(f, 'heal', aiCalls);
      if (point.endsWith('-judge')) expect(last(f)).toContain('reason=judge:');
      if (point === 'H1') expect(patches(f)).toEqual([]); else expectRestored(f);
      const expectedRuns = point.startsWith('H1') || point === 'H2' ? 1 : point.startsWith('H3') || point === 'H4' || point === 'H5' ? 2 : point.startsWith('H8') ? 4 : 3;
      expect(f.calls('replay')).toHaveLength(expectedRuns);
      expect(f.calls('heal-dry-run')).toHaveLength(point === 'H1' || point === 'H2' || point.startsWith('H3') ? 0 : 1);
      expect(f.calls('heal-apply')).toHaveLength(point === 'H1' || point === 'H2' || point.startsWith('H3') || point === 'H4' ? 0 : 1);
      cleaned(f);
    });
    it.each(['different-snapshot', 'different-other-setting', 'patch-500', 'prior-heal-failure', 'long-prior-failure', 'before-patch', 'ambiguous-patch', 'missing-script', 'signal-and-patch-500', 'keep-and-patch-500'])
    ('TEST-544-18 restores once with a fresh signal and preserves restoration failures (%s)', async mode => {
      let gets = 0;
      const f: Fake = createFakeDeps({         fetch: async (url, opts) => {
          if (new URL(url).pathname !== settingsPath) return f.successfulFetch(url, opts);
          if (opts.method === 'PATCH') {
            const restoring = JSON.parse(String(opts.body)).generalSetting.additionalScript === '';
            if (!restoring && mode === 'ambiguous-patch') throw new Error('connection reset after request started');
            if (restoring) {
              expect(opts.signal).toBeInstanceOf(AbortSignal); expect(opts.signal!.aborted).toBe(false);
              if (['patch-500', 'prior-heal-failure', 'long-prior-failure', 'signal-and-patch-500', 'keep-and-patch-500'].includes(mode)) return { status: 500, json: async () => ({}) };
            }
          } else {
            gets++;
            if (mode === 'before-patch' && gets === 1) return { status: 500, json: async () => ({}) };
            if (mode === 'different-snapshot' && gets === 2) return { status: 200, json: async () => ({ name: 'instance/settings/GENERAL', generalSetting: { additionalScript: 'not restored' } }) };
            if (mode === 'different-other-setting' && gets === 2) return { status: 200, json: async () => ({ name: 'instance/settings/GENERAL', generalSetting: { additionalScript: '', instanceUrl: 'https://changed.example' } }) };
            if (mode === 'missing-script' && gets === 1) return { status: 200, json: async () => ({ name: 'instance/settings/GENERAL', generalSetting: {} }) };
          }
          return f.successfulFetch(url, opts);
        },
        runProcess: async call => {
          if (call.kind === 'heal-dry-run' && mode === 'signal-and-patch-500') {
            f.signals.emit('SIGINT'); expect(call.opts.signal.aborted).toBe(true);
            return result(null, '', '', 'SIGINT');
          }
          if (call.kind === 'heal-apply' && (mode === 'prior-heal-failure' || mode === 'long-prior-failure')) {
            throw new Error(`H5 rejected${mode === 'long-prior-failure' ? 'x'.repeat(600) : ''}`);
          }
          return f.successfulProcess(call);
        },
      });
      expect(await run(f, ['--heal-check', ...(mode === 'keep-and-patch-500' ? ['--keep'] : [])])).toBe(mode === 'missing-script' ? 0 : mode === 'signal-and-patch-500' ? 130 : 1);
      if (mode === 'missing-script') expect(last(f)).toContain('PASS aiCalls=0');
      else fail(f, 'heal', mode === 'signal-and-patch-500' ? 'n/a' : '0');
      if (mode === 'before-patch') expect(patches(f)).toEqual([]); else expectRestored(f);
      if (['patch-500', 'prior-heal-failure', 'long-prior-failure', 'signal-and-patch-500', 'keep-and-patch-500'].includes(mode)) {
        expect(last(f)).toContain('; restore failed: PATCH /api/v1/instance/settings/GENERAL -> 500');
      }
      if (mode === 'prior-heal-failure' || mode === 'long-prior-failure') expect(last(f)).toContain('H5 rejected');
      if (mode === 'long-prior-failure') expect(last(f).split(' reason=')[1]!.replace(/ aiCalls=.*$/, '').length).toBeLessThanOrEqual(400);
      if (mode === 'signal-and-patch-500') expect(last(f)).toBe('verify-memos: FAIL stage=heal reason=interrupted; restore failed: PATCH /api/v1/instance/settings/GENERAL -> 500 aiCalls=n/a');
      if (mode === 'keep-and-patch-500') expect(last(f)).toContain('; --keep not honored: restore failed');
      if (mode !== 'missing-script') expect(f.calls('replay').length).toBeLessThan(4);
      cleaned(f);
    });
    it.each(['SIGINT', 'SIGTERM'].flatMap(signal =>
      ['signin', 'patch', 'get'].map(point => ({ signal, point }))))
    ('TEST-544-19 finishes H7 but skips H8 after $signal during restoration $point', async ({ signal, point }) => {
      let emitted = false;
      const order: string[] = [];
      const f: Fake = createFakeDeps({
        fetch: async (url, opts) => {
          const path = new URL(url).pathname;
          const inRestoration = f.calls('replay').length === 3;
          const matches = point === 'signin' ? path.endsWith('/auth/signin')
            : path === settingsPath && (point === 'patch' ? opts.method === 'PATCH' : opts.method !== 'PATCH');
          if (inRestoration && matches && !emitted) {
            emitted = true;
            f.signals.emit(signal);
            expect(opts.signal!.aborted).toBe(false);
          }
          const response = await f.successfulFetch(url, opts);
          if (inRestoration && path === settingsPath && opts.method !== 'PATCH') order.push('restored');
          return response;
        },
        runner: { removeContainer: async (name: string) => { order.push('teardown'); f.containers.delete(name); } },
      });
      expect(await run(f, ['--heal-check', '--keep'])).toBe(signal === 'SIGINT' ? 130 : 143);
      expect(emitted).toBe(true);
      expectRestored(f);
      expect(f.calls('replay')).toHaveLength(3);
      expect(fullJudges(f)).toHaveLength(2);
      const project = f.calls('replay')[0]!.opts.cwd;
      const projectWrites = vi.mocked(fs.writeFileSync).mock.calls.filter(([path]) =>
        [healPlan, healGrounding].some(file => String(path) === join(project, file)));
      expect(projectWrites).toHaveLength(1);
      expect(JSON.parse(String(projectWrites[0]![1]))).toEqual(readOnlyPlan('Open Control panel'));
      expect(order).toEqual(['restored', 'teardown']);
      expect(last(f)).toBe('verify-memos: FAIL stage=heal reason=interrupted aiCalls=n/a');
      cleaned(f);
    });
    it.each(['pass', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8', 'SIGINT-H4', 'SIGTERM-H5', 'keep'])
    ('TEST-544-19 preserves all fixture bytes on every heal exit and restores before cleanup (%s)', async point => {
      const order: string[] = []; let gets = 0;
      const f: Fake = createFakeDeps({         fetch: async (url, opts) => {
          if (new URL(url).pathname === settingsPath) {
            if (opts.method === 'PATCH') {
              const restoring = JSON.parse(String(opts.body)).generalSetting.additionalScript === '';
              if (restoring) { order.push('restore'); expect(opts.signal!.aborted).toBe(false); }
              if (point === 'H2' && !restoring) return { status: 500, json: async () => ({}) };
            } else {
              gets++;
              if ((point === 'H1' && gets === 1) || (point === 'H7' && gets === 2)) return { status: 500, json: async () => ({}) };
            }
          }
          return f.successfulFetch(url, opts);
        },
        runProcess: async call => {
          const n = f.calls('replay').length;
          if (call.kind === 'replay' && ((point === 'H3' && n === 2) || (point === 'H6' && n === 3) || (point === 'H8' && n === 4))) return result(1, JSON.stringify(suiteReport([healPrompt])));
          if ((point === 'H4' && call.kind === 'heal-dry-run') || (point === 'H5' && call.kind === 'heal-apply')) return result(1, JSON.stringify(healReport(call.kind === 'heal-apply')));
          if ((point === 'SIGINT-H4' && call.kind === 'heal-dry-run') || (point === 'SIGTERM-H5' && call.kind === 'heal-apply')) {
            const signal = point === 'SIGINT-H4' ? 'SIGINT' : 'SIGTERM';
            f.signals.emit(signal); expect(call.opts.signal.aborted).toBe(true);
            return result(null, '', '', signal);
          }
          return f.successfulProcess(call);
        },
        runner: { removeContainer: async (name: string) => { order.push('teardown'); f.containers.delete(name); } },
      });
      const before = snapshot(f.fixture); expect(Object.keys(before)).toHaveLength(22);
      expect(await run(f, ['--heal-check', ...(point === 'keep' ? ['--keep'] : [])])).toBe(point === 'pass' || point === 'keep' ? 0 : point === 'SIGINT-H4' ? 130 : point === 'SIGTERM-H5' ? 143 : 1);
      expect(snapshot(f.fixture)).toEqual(before);
      if (point === 'H1') expect(patches(f)).toEqual([]); else expectRestored(f);
      if (point.startsWith('SIG')) { fail(f, 'heal'); expect(last(f)).toContain('reason=interrupted'); }
      if (point === 'keep') {
        expect(order).toEqual(['restore']); expect(f.containers.size).toBe(1); expect(f.roots()).toHaveLength(1);
      } else {
        if (point !== 'H1') expect(order).toEqual(['restore', 'teardown']);
        cleaned(f);
      }
    });
    it.each(['counts', 'missing-dry-run-count', 'missing-apply-count'])
    ('TEST-544-2 reports heal dispatch totals without treating an absent count as zero (%s)', async mode => {
      const f: Fake = createFakeDeps({ runProcess: async call => {
        const success = await f.successfulProcess(call);
        if ((mode === 'missing-dry-run-count' && call.kind === 'heal-dry-run') || (mode === 'missing-apply-count' && call.kind === 'heal-apply')) {
          const envelope = JSON.parse(success.stdout); delete envelope.results[0].aiCalls;
          return result(0, JSON.stringify(envelope));
        }
        return success;
      } });
      expect(await run(f, ['--heal-check'])).toBe(0);
      expect(last(f)).toBe(`verify-memos: PASS aiCalls=0 sha=${sha.slice(0, 12)} memos=0.31.0 heal=healed healAiCalls=${mode === 'counts' ? '5' : 'unknown'}`);
    });
    it('TEST-544-15 executes the entire heal protocol and restores the captured project bytes', async () => {
      let initialPlan: Buffer | undefined, initialGrounding: Buffer | undefined;
      const protocol: string[] = [];
      const f: Fake = createFakeDeps({         fetch: async (url, opts) => {
          if (url.endsWith('/signin')) protocol.push('signin');
          if (new URL(url).pathname === settingsPath) protocol.push(opts.method === 'PATCH' ? `PATCH:${JSON.parse(String(opts.body)).generalSetting.additionalScript === '' ? 'restore' : 'script'}` : 'GET');
          return f.successfulFetch(url, opts);
        },
        runProcess: async call => {
          if (call.kind === 'replay') {
            const n = f.calls('replay').length; protocol.push(`run:${n}`);
            if (n === 1) {
              initialPlan = fs.readFileSync(join(call.opts.cwd, healPlan));
              initialGrounding = fs.readFileSync(join(call.opts.cwd, healGrounding));
            }
            if (n === 4) {
              expect(fs.readFileSync(join(call.opts.cwd, healPlan))).toEqual(initialPlan);
              expect(fs.readFileSync(join(call.opts.cwd, healGrounding))).toEqual(initialGrounding);
            }
          }
          if (call.kind === 'heal-dry-run' || call.kind === 'heal-apply') protocol.push(call.kind);
          if (call.kind === 'judge') {
            const mode = call.opts.env.AMBERCAST_VERIFY_MEMOS_MODE;
            protocol.push(mode === 'heal-report' ? 'judge:heal' : `judge:${call.opts.env.AMBERCAST_VERIFY_MEMOS_EXPECTED_CASES}`);
            if (fullJudges(f).length === 2 && mode === 'full') {
              write(join(f.fixture, healPlan), 'changed outside the copied project');
              write(join(f.fixture, healGrounding), 'changed outside the copied project');
            }
          }
          return f.successfulProcess(call);
        },
        runner: { removeContainer: async (name: string) => { protocol.push('teardown'); f.containers.delete(name); } },
      });
      expect(await run(f, ['--heal-check'])).toBe(0);
      // Bootstrap has its own sign-in before the verification protocol begins.
      expect(protocol.slice(protocol.indexOf('run:1'))).toEqual([
        'run:1', 'judge:7', 'signin', 'GET', 'PATCH:script', 'run:2', 'heal-dry-run', 'judge:heal',
        'heal-apply', 'judge:heal', 'run:3', 'judge:1', 'signin', 'PATCH:restore', 'GET', 'run:4', 'judge:1', 'teardown',
      ]);
      for (const [kind, flag] of [['heal-dry-run', '--dry-run'], ['heal-apply', '--yes']]) {
        expect(f.calls(kind!)).toHaveLength(1); const call = f.calls(kind!)[0]!;
        expectCommand(call, ['heal', flag!, '--json', '--no-color', '--ai', 'claude', healPrompt], 900_000);
        expect(call.opts.env).toEqual(f.calls('replay')[0]!.opts.env);
        expect(call.opts.env.AMBERCAST_SECRET_MEMOS_PASSWORD).toBe(password); expect(call.opts.env).not.toHaveProperty('CI');
      }
      for (const call of f.calls('replay').slice(1)) expectCommand(call, ['run', '--json', '--no-color', healPrompt], 120_000);
      expect(fullJudges(f).map(c => c.opts.env.AMBERCAST_VERIFY_MEMOS_EXPECTED_CASES)).toEqual(['7', '1', '1']);
      expectRestored(f); cleaned(f);
    });
    it('TEST-544-26 wires persisted heal reports and broken-run evidence into their judges', async () => {
      const saved = new Map<string, unknown>();
      const f: Fake = createFakeDeps({ runProcess: async call => {
        if (call.kind === 'judge') {
          const runRoot = dirname(f.calls('replay')[0]!.opts.cwd);
          if (call.opts.env.AMBERCAST_VERIFY_MEMOS_MODE === 'heal-report') {
            const filename = f.calls('heal-apply').length ? 'heal-apply.json' : 'heal-dry-run.json';
            const path = join(runRoot, filename);
            expect(call.opts.env.AMBERCAST_VERIFY_MEMOS_REPORT).toBe(path);
            expect(JSON.parse(fs.readFileSync(path, 'utf8'))).toEqual(saved.get(filename));
          }
          if (call.opts.env.AMBERCAST_VERIFY_MEMOS_MODE === 'full' && fullJudges(f).length > 1) {
            expect(JSON.parse(call.opts.env.AMBERCAST_VERIFY_MEMOS_ARTIFACT_ROOTS!)).toEqual(expect.arrayContaining(
              ['heal-dry-run.json', 'heal-apply.json', 'heal-broken-report.json'].map(file => join(runRoot, file))));
          }
        }
        const success = await f.successfulProcess(call);
        if (call.kind === 'heal-dry-run' || call.kind === 'heal-apply') saved.set(`${call.kind}.json`, JSON.parse(success.stdout));
        return success;
      } });
      expect(await run(f, ['--heal-check'])).toBe(0);
      expect(saved.size).toBe(2);
      expect(f.calls('judge').filter(call => call.opts.env.AMBERCAST_VERIFY_MEMOS_MODE === 'heal-report')).toHaveLength(2);
      expect(fullJudges(f)).toHaveLength(3); expectRestored(f);
    });
    it.each(['heal-dry-run', 'heal-apply'])('TEST-544-26 stops after the %s report judge rejects evidence', async phase => {
      const f: Fake = createFakeDeps({ runProcess: call => {
        if (call.kind === 'judge' && call.opts.env.AMBERCAST_VERIFY_MEMOS_MODE === 'heal-report'
          && (f.calls('heal-apply').length ? 'heal-apply' : 'heal-dry-run') === phase) return result(1, '', 'heal report rejected');
        return f.successfulProcess(call);
      } });
      expect(await run(f, ['--heal-check'])).toBe(1); fail(f, 'heal', '0');
      expect(last(f)).toMatch(/reason=judge:/);
      expect(f.calls('heal-dry-run')).toHaveLength(1);
      expect(f.calls('heal-apply')).toHaveLength(phase === 'heal-apply' ? 1 : 0);
      expect(f.calls('replay')).toHaveLength(2); expectRestored(f); cleaned(f);
    });
    it('TEST-544-18 restores a nonempty script and authenticates restoration with a fresh token', async () => {
      const originalScript = 'window.existingSetting = "preserve me";\n// existing script\n';
      const snapshot = { name: 'instance/settings/GENERAL', generalSetting: { additionalScript: originalScript, instanceUrl: 'https://memos.example', disallowUserRegistration: true } };
      let script = originalScript, signin = 0;
      const f: Fake = createFakeDeps({ fetch: async (url, opts) => {
        if (url.endsWith('/signin')) {
          const body = { accessToken: `token-${++signin}` };
          return { status: 200, ok: true, json: async () => body };
        }
        if (new URL(url).pathname === settingsPath) {
          if (opts.method === 'PATCH') script = JSON.parse(String(opts.body)).generalSetting.additionalScript;
          const body = { ...snapshot, generalSetting: { ...snapshot.generalSetting, additionalScript: script } };
          return { status: 200, ok: true, json: async () => body };
        }
        return f.successfulFetch(url, opts);
      } });
      expect(await run(f, ['--heal-check'])).toBe(0);
      const settings = f.fetchCalls.filter(call => new URL(call.url).pathname === settingsPath);
      expect(settings).toHaveLength(4); expect(patches(f)).toHaveLength(2);
      const restore = patches(f)[1]!;
      expect(JSON.parse(String(restore.opts.body)).generalSetting.additionalScript).toBe(originalScript);
      expect(script).toBe(originalScript); expect(signin).toBe(3);
      expect(new Headers(settings[0]!.opts.headers).get('Authorization')).toBe('Bearer token-2');
      for (const call of settings.slice(-2)) expect(new Headers(call.opts.headers).get('Authorization')).toBe('Bearer token-3');
    });
    it.each([
      { name: 'exit-zero', reason: 'label change did not break the heal case' },
      { name: 'exit-one', reason: 'unexpected exit=1' },
      { name: 'non-json', reason: 'non-json stdout' },
      { name: 'ai-call', reason: 'aiCalls' },
      { name: 'stale-plan', reason: 'unexpected failure: STALE_PLAN' },
      { name: 'wrong-step', reason: 'unexpected failure: GROUNDING_UNRESOLVED' },
      { name: 'wrong-scope', reason: 'unexpected failure: GROUNDING_UNRESOLVED' },
      { name: 'wrong-case-id', reason: 'unexpected failure: GROUNDING_UNRESOLVED' },
      { name: 'zero-rows', reason: 'results' },
      { name: 'two-rows', reason: 'results' },
    ])('TEST-544-16 rejects a broken-case replay that does not prove the intended miss ($name)', async ({ name, reason }) => {
      const envelope = brokenReport();
      if (name === 'ai-call') envelope.results[0]!.aiCalls = 1;
      if (name === 'stale-plan') { envelope.errors[0]!.code = 'STALE_PLAN'; delete envelope.errors[0]!.details; }
      if (name === 'wrong-step') envelope.errors[0]!.details = { stepId: 'another-step', reason: 'missing' };
      if (name === 'wrong-scope') envelope.errors[0]!.scope = 'run';
      if (name === 'wrong-case-id') envelope.errors[0]!.caseId = prompts[0];
      if (name === 'zero-rows') envelope.results = [];
      if (name === 'two-rows') envelope.results.push({ ...envelope.results[0]!, id: prompts[0]!, file: prompts[0]!, planFile: plans[0]! });
      const f: Fake = createFakeDeps({ runProcess: call => {
        if (call.kind === 'replay' && f.calls('replay').length === 2) return result(name === 'exit-zero' ? 0 : name === 'exit-one' ? 1 : 4,
          name === 'non-json' ? 'not JSON' : JSON.stringify(envelope));
        return f.successfulProcess(call);
      } });
      expect(await run(f, ['--heal-check'])).toBe(1); fail(f, 'heal', name === 'non-json' ? 'unknown' : name === 'ai-call' ? '1' : name === 'zero-rows' ? 'unknown' : '0');
      if (name !== 'zero-rows' && name !== 'two-rows') expect(last(f)).toContain(reason);
      expect(last(f)).not.toContain('--regenerate');
      expect(f.calls('heal-dry-run')).toEqual([]); expect(f.calls('heal-apply')).toEqual([]);
      expect(f.calls('replay')).toHaveLength(2); expect(fullJudges(f)).toHaveLength(1); expectRestored(f);
    });
    it.each([
      { phase: 'heal-dry-run', fault: 'unresolved' }, { phase: 'heal-dry-run', fault: 'applied' },
      { phase: 'heal-dry-run', fault: 'two-rows' }, { phase: 'heal-dry-run', fault: 'wrong-file' },
      { phase: 'heal-dry-run', fault: 'wrong-status' }, { phase: 'heal-dry-run', fault: 'exit-one' },
      { phase: 'heal-dry-run', fault: 'non-json' }, { phase: 'heal-dry-run', fault: 'plan-changed' },
      { phase: 'heal-dry-run', fault: 'grounding-only-changed' },
      { phase: 'heal-apply', fault: 'partially-healed' }, { phase: 'heal-apply', fault: 'preview-only' },
      { phase: 'heal-apply', fault: 'unchanged' }, { phase: 'heal-apply', fault: 'wrong-target' },
      { phase: 'heal-apply', fault: 'extra-fill' }, { phase: 'heal-apply', fault: 'wrong-file' },
      { phase: 'heal-apply', fault: 'two-rows' }, { phase: 'heal-apply', fault: 'wrong-status' },
      { phase: 'heal-apply', fault: 'exit-one' }, { phase: 'heal-apply', fault: 'non-json' },
    ])('TEST-544-17 rejects invalid heal evidence and never advances ($phase, $fault)', async ({ phase, fault }) => {
      const f: Fake = createFakeDeps({ runProcess: async call => {
        if (call.kind !== phase) return f.successfulProcess(call);
        const oldPlan = fs.readFileSync(join(call.opts.cwd, healPlan)), oldGrounding = fs.readFileSync(join(call.opts.cwd, healGrounding));
        const success = await f.successfulProcess(call), envelope = JSON.parse(success.stdout), row = envelope.results[0];
        if (fault === 'unresolved') { row.repairOutcome = 'unresolved'; row.application = 'no-artifact-change'; }
        if (fault === 'partially-healed') row.repairOutcome = 'partially-healed';
        if (fault === 'applied' || fault === 'preview-only') row.application = fault;
        if (fault === 'two-rows') envelope.results.push({ ...row });
        if (fault === 'wrong-file') {
          row.file = prompts[0];
          // A valid envelope isolates the harness's file-to-case check from schema rejection.
          expect(ReportEnvelope.safeParse(envelope).success).toBe(true);
        }
        if (fault === 'wrong-status') {
          row.status = 'passed';
          // This mutation is intentionally schema-invalid: heal rows must be completed.
          expect(ReportEnvelope.safeParse(envelope).success).toBe(false);
        }
        if (fault === 'plan-changed') write(join(call.opts.cwd, healPlan), JSON.stringify({ ...readOnlyPlan(), changedByPreview: true }));
        if (fault === 'grounding-only-changed') {
          write(join(call.opts.cwd, healGrounding), '{"previewChangedGrounding":true}');
          expect(fs.readFileSync(join(call.opts.cwd, healPlan))).toEqual(oldPlan);
        }
        if (fault === 'unchanged') { write(join(call.opts.cwd, healPlan), oldPlan.toString()); write(join(call.opts.cwd, healGrounding), oldGrounding.toString()); }
        if (fault === 'wrong-target' || fault === 'extra-fill') {
          const repaired = readOnlyPlan();
          if (fault === 'wrong-target') {
            repaired.targets = { memos: repaired.targets['memos-readonly']! };
            repaired.steps.forEach(s => { s.target = 'memos'; });
          } else repaired.steps.push({ id: 'write-memo', kind: 'action', action: 'fill', target: 'memos-readonly', value: 'unsafe mutation', intent: { description: 'Memo input', roleHint: 'textbox', sourceSpan: fakeSourceSpan } });
          expect(PlanDocument.safeParse(repaired).success).toBe(true);
          write(join(call.opts.cwd, healPlan), JSON.stringify(repaired));
        }
        return result(fault === 'exit-one' ? 1 : 0, fault === 'non-json' ? 'not JSON' : JSON.stringify(envelope));
      } });
      const before = snapshot(f.fixture);
      expect(await run(f, ['--heal-check'])).toBe(1); fail(f, 'heal', '0');
      if (fault === 'wrong-target' || fault === 'extra-fill') expect(last(f)).toContain('repaired plan is not read-only');
      expect(f.calls('heal-dry-run')).toHaveLength(1); expect(f.calls('heal-apply')).toHaveLength(phase === 'heal-apply' ? 1 : 0);
      expect(f.calls('replay')).toHaveLength(2); expectRestored(f); expect(snapshot(f.fixture)).toEqual(before);
    });
    it('TEST-544-27 emits one success for the complete heal protocol', async () => {
      const f = createFakeDeps({}); expect(await run(f, ['--heal-check'])).toBe(0);
      expect(f.out().match(/^verify-memos: heal ok.*$/gm)).toHaveLength(1);
    });
  });
  describe('preflight', () => {
    it('TEST-8 fails closed when the docker daemon is unreachable', async () => {
      const f: Fake = stageFake('preflight'); expect(await run(f)).toBe(1); fail(f, 'preflight');
      expect(f.runnerCount('startContainer')).toBe(0); expect(f.processCalls).toEqual([]); expect(f.roots()).toEqual([]);
    });
    it.each(files.flatMap((file) => [false, true].map((regenerate) => ({ file, regenerate }))))
    ('TEST-9 fails when fixture files are missing', async ({ file, regenerate }) => {
      const f: Fake = createFakeDeps(); fs.rmSync(join(f.fixture, file));
      const optional = regenerate && (plans.includes(file) || groundings.includes(file));
      expect(await run(f, regenerate ? ['--regenerate'] : [])).toBe(optional ? 0 : 1);
      if (optional) return;
      fail(f, 'preflight'); expect(f.starts).toEqual([]); expect(f.calls('pack')).toEqual([]); expect(f.roots()).toEqual([]);
      if (file.endsWith('.test.md') || file === files[0]) {
        expect(last(f)).toContain('git checkout -- test/verification/memos/fixture'); expect(last(f)).not.toContain('--regenerate');
      } else expect(last(f)).toContain('--regenerate');
    });
    it.each(['default', 'dirty', 'manifest'])('TEST-10 packs when no --manifest is given, else validates the given manifest', async (mode) => {
      const f: Fake = createFakeDeps(), argv = mode === 'manifest' ? ['--manifest', f.manifest] : mode === 'dirty' ? ['--allow-dirty'] : [];
      expect(await run(f, argv)).toBe(0);
      if (mode === 'manifest') expect(f.calls('pack')).toEqual([]);
      else {
        expect(f.calls('pack')).toHaveLength(1);
        expect(f.calls('pack')[0]!.argv).toEqual(['node', join(f.repoRoot, 'scripts/pack-install.mjs'), 'pack', ...argv]);
      }
      expect(f.calls('install')).toHaveLength(1);
      const install = f.calls('install')[0]!;
      expect(install.argv).toEqual(['node', join(f.repoRoot, 'scripts/pack-install.mjs'), 'install', install.opts.cwd, '--manifest', f.manifest, '--pm', 'npm']);
    });
    it.each(['exit', 'none', 'two', 'indented', 'no-space', 'unreadable', 'json', 'sha'])('TEST-11 fails on a malformed pack manifest line', async (mode) => {
      const f: Fake = createFakeDeps({ runProcess: () => result(mode === 'exit' ? 1 : 0,
        mode === 'none' ? 'build only\n' : mode === 'two' ? `manifest: ${f.manifest}\nmanifest: ${f.manifest}\n`
          : mode === 'indented' ? ` manifest: ${f.manifest}\n` : mode === 'no-space' ? `manifest:${f.manifest}\n` : `manifest: ${f.manifest}\n`) });
      if (mode === 'unreadable') fs.rmSync(f.manifest);
      if (mode === 'json') write(f.manifest, 'not json'); if (mode === 'sha') write(f.manifest, '{}');
      expect(await run(f)).toBe(1); fail(f, 'pack'); expect(f.starts).toEqual([]); expect(f.roots()).toEqual([]);
    });
    it.each(['present', 'missing', 'pull-failure'])('TEST-12 pulls the image only when missing', async (mode) => {
      const f: Fake = createFakeDeps({ runner: { hasImage: async () => mode === 'present',
        pullImage: async () => { if (mode === 'pull-failure') throw new Error('pull failed'); } } });
      expect(await run(f)).toBe(mode === 'pull-failure' ? 1 : 0);
      const pulls = f.runnerCalls.filter((c) => c.method === 'pullImage'); expect(pulls).toHaveLength(mode === 'present' ? 0 : 1);
      if (pulls.length) expect(pulls[0]!.args[0]).toBe('neosmemo/memos:0.31.0');
      expect(f.runnerCalls.find((c) => c.method === 'hasImage')!.args[0]).toBe('neosmemo/memos:0.31.0');
      if (mode === 'pull-failure') { fail(f, 'preflight'); expect(f.starts).toEqual([]); expect(f.roots()).toEqual([]); }
    });
    it.each(['throws', 'empty'])('TEST-13 fails when the playwright-core version cannot be read', async (mode) => {
      const f: Fake = createFakeDeps({ readPlaywrightVersion: () => { if (mode === 'throws') throw new Error('unreadable'); return ''; } });
      expect(await run(f)).toBe(1); fail(f, 'preflight'); expect(f.starts).toEqual([]); expect(f.roots()).toEqual([]);
    });
    it('TEST-14 runs preflight checks in the documented order', async () => {
      const f: Fake = createFakeDeps(), actual = await vi.importActual<typeof import('node:fs')>('node:fs');
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        if (files.some((file) => String(path) === join(f.fixture, file))) f.events.push('fixture'); return actual.existsSync(path);
      });
      vi.mocked(fs.readFileSync).mockImplementation(((path: fs.PathOrFileDescriptor, options?: Parameters<typeof fs.readFileSync>[1]) => {
        if (files.some((file) => String(path) === join(f.fixture, file))) f.events.push('fixture');
        return options === undefined ? actual.readFileSync(path) : actual.readFileSync(path, options);
      }) as typeof fs.readFileSync);
      expect(await run(f)).toBe(0);
      const indices = ['checkDaemon', 'fixture', 'listContainers', 'port', 'pack', 'hasImage', 'version'].map((event) => f.events.indexOf(event));
      expect(indices.every((i) => i >= 0)).toBe(true); expect(indices).toEqual([...indices].sort((a, b) => a - b));
      expect(new Set(indices).size).toBe(indices.length);
    });
    it.each(['valid', 'unreadable', 'json', 'sha'])('TEST-73 resolves a relative --manifest against process.cwd()', async (mode) => {
      const f: Fake = createFakeDeps();
      if (mode === 'unreadable') fs.rmSync(f.manifest); if (mode === 'json') write(f.manifest, '{'); if (mode === 'sha') write(f.manifest, '{}');
      expect(await run(f, ['--manifest', relative(process.cwd(), f.manifest)])).toBe(mode === 'valid' ? 0 : 1);
      expect(f.calls('pack')).toEqual([]);
      if (mode === 'valid') expect(f.calls('install')[0]!.argv).toContain(f.manifest);
      else { fail(f, 'pack'); expect(f.starts).toEqual([]); expect(f.roots()).toEqual([]); }
    });
  });

  describe('lifecycle', () => {
    it.each([false, true])('TEST-4 prints a PASS line when every stage succeeds', async (dirty) => {
      const f: Fake = createFakeDeps(); write(f.manifest, JSON.stringify({ sha, dirty }));
      expect(await run(f)).toBe(0);
      expect(last(f)).toBe(`verify-memos: PASS aiCalls=0 sha=${sha.slice(0, 12)}${dirty ? '-dirty' : ''} memos=0.31.0`);
      const lines = f.out().trimEnd().split('\n').slice(0, -1);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) expect(line).toMatch(/^verify-memos: (preflight|port|pack|install|chromium|fixture|container|ready|bootstrap|replay|judge|teardown) ok \(\d+ ms\)$/);
      const stages = lines.map((line) => line.split(' ')[1]); expect(new Set(stages).size).toBe(stages.length);
      expect(f.calls('generate')).toEqual([]); expect(f.calls('resolve')).toEqual([]);
    });
    it.each(['preflight', 'port', 'pack', 'install', 'chromium', 'fixture', 'container', 'ready', 'bootstrap', 'replay', 'judge'])
    ('TEST-5 prints a FAIL line for each failing stage (table-driven)', async (stage) => {
      const f: Fake = stageFake(stage); expect(await run(f)).toBe(1);
      fail(f, stage, stage === 'replay' || stage === 'judge' ? '0' : 'n/a'); expect(f.out()).not.toContain('PASS');
    });
    it.each([
      { operation: 'stale reap', stage: 'preflight' },
      { operation: 'run root creation', stage: 'install' },
      { operation: 'project package.json', stage: 'install' },
      { operation: 'fixture copy', stage: 'fixture' },
      { operation: 'report save', stage: 'replay' },
    ])('TEST-71 attributes $operation failure to $stage', async ({ operation, stage }) => {
      const f: Fake = createFakeDeps({ runner: { listContainers: async () => {
        if (operation === 'stale reap') throw new Error('stale reap failed');
        return [...f.containers];
      } } });
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
      if (operation === 'run root creation') vi.mocked(fs.mkdirSync).mockImplementation(((path: fs.PathLike, options?: Parameters<typeof fs.mkdirSync>[1]) => {
        if (String(path).startsWith(join(f.tmpRoot, 'ambercast-verify-memos-')) && String(path).endsWith('.tmp')) throw new Error('run root failed');
        return actual.mkdirSync(path, options as never);
      }) as typeof fs.mkdirSync);
      if (['project package.json', 'fixture copy', 'report save'].includes(operation)) {
        vi.mocked(fs.writeFileSync).mockImplementation(((path: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView, options?: Parameters<typeof fs.writeFileSync>[2]) => {
          const name = String(path);
          const selected = operation === 'project package.json' ? name.endsWith('/project/package.json')
            : operation === 'fixture copy' ? name.endsWith(`/project/${prompt}`)
              : /^ambercast-verify-memos-[0-9a-f]{8}$/.test(relative(f.tmpRoot, dirname(name))) && name.endsWith('/report.json');
          if (selected) throw new Error(`${operation} failed`);
          return actual.writeFileSync(path, data, options);
        }) as typeof fs.writeFileSync);
      }
      if (operation === 'fixture copy') vi.mocked(fs.copyFileSync).mockImplementation((source, destination, mode) => {
        if (String(destination).endsWith(`/project/${prompt}`)) throw new Error('fixture copy failed');
        return actual.copyFileSync(source, destination, mode);
      });
      expect(await run(f)).toBe(1); fail(f, stage, operation === 'report save' ? '0' : 'n/a');
      expect(last(f)).toContain(`${operation === 'run root creation' ? 'run root' : operation} failed`);
    });
    it.each([
      { reason: 'first\nsecond\rthird\tend', escaped: 'first\\nsecond\\rthird\\tend' },
      { reason: 'x'.repeat(500), escaped: 'x'.repeat(500) },
    ])('TEST-71 escapes control characters and truncates reasons to 400 characters', async ({ reason, escaped }) => {
      const f: Fake = createFakeDeps({ assertPortFree: () => { throw new Error(reason); } });
      expect(await run(f)).toBe(1); fail(f, 'port');
      const formatted = last(f).split(' reason=')[1]!.split(' aiCalls=')[0]!;
      expect(formatted.length).toBeLessThanOrEqual(400);
      expect(formatted).toBe(escaped.slice(0, 400));
      expect(f.out().match(/verify-memos: FAIL/g)).toHaveLength(1);
    });
    it('TEST-32 writes the pinned project package before install starts', async () => {
      const f: Fake = createFakeDeps({ runProcess: (call) => {
        if (call.kind === 'install') {
          expect(JSON.parse(fs.readFileSync(join(call.opts.cwd, 'package.json'), 'utf8'))).toEqual({
            name: 'memos-verify-project', private: true, type: 'module', overrides: { 'playwright-core': '1.62.1' },
          });
        }
        return f.successfulProcess(call);
      } });
      expect(await run(f)).toBe(0); expect(f.calls('install')).toHaveLength(1);
    });
    it('TEST-7 fails on teardown even when every other stage passed', async () => {
      const f: Fake = createFakeDeps({ runner: { removeContainer: async () => { throw new Error('remove failed'); } } });
      expect(await run(f)).toBe(1); fail(f, 'teardown', '0'); expect(f.out()).not.toContain('PASS');
    });
    it('TEST-16 fails when the port is already in use', async () => {
      const f: Fake = createFakeDeps({ assertPortFree: async (port, host) => { throw new Error(`port ${port} on ${host} is in use`); } });
      expect(await run(f)).toBe(1); fail(f, 'port'); expect(last(f)).toContain('port 5230 on 127.0.0.1 is in use');
      expect(f.calls('pack')).toEqual([]); expect(f.starts).toEqual([]); expect(f.roots()).toEqual([]);
    });
    it.each(['port allocation conflict', 'daemon disconnected', 'permission denied', 'timeout'])('TEST-17 fails when docker run fails for any reason', async (reason) => {
      const f: Fake = createFakeDeps({ runner: { startContainer: async () => { throw new Error(reason); } } });
      expect(await run(f)).toBe(1); fail(f, 'container'); expect(last(f)).toContain(reason);
      expect(f.runnerCount('removeContainer')).toBe(1); expect(f.roots()).toEqual([]);
    });
    it('TEST-21 never reuses a run root or container name across runs', async () => {
      const f: Fake = createFakeDeps({ runner: { startContainer: async (spec: ContainerSpec) => {
        expect(fs.readdirSync(spec.data)).toEqual([]); write(join(spec.data, 'previous-run'), 'data'); f.containers.add(spec.name);
      } } });
      expect(await run(f)).toBe(0); expect(await run(f)).toBe(0); expect(f.starts).toHaveLength(2);
      const a = f.starts[0]!, b = f.starts[1]!; expect(a.runId).not.toBe(b.runId); expect(a.name).not.toBe(b.name); expect(a.data).not.toBe(b.data);
      for (const spec of f.starts) {
        expect(spec.runId).toMatch(/^[0-9a-f]{8}$/); expect(spec.name).toBe(`ambercast-verify-memos-${spec.runId}`);
        expect(spec.data).toBe(join(f.tmpRoot, spec.name, 'data')); expect(spec.uid).toBe(501); expect(spec.gid).toBe(20);
      }
      expect(f.roots()).toEqual([]);
    });
    it.each(['success', 'container', 'replay', 'judge', 'secret-in-error'])('TEST-31 never prints the generated password anywhere', async (stage) => {
      const f: Fake = stage === 'success' ? createFakeDeps() : stage === 'secret-in-error'
        ? createFakeDeps({ runner: { startContainer: async () => { throw new Error(`producer leaked ${password}`); } } }) : stageFake(stage);
      expect(await run(f)).toBe(stage === 'success' ? 0 : 1);
      expect(f.out() + f.err() + JSON.stringify(f.processCalls.map((c) => c.argv)) + JSON.stringify(f.starts)).not.toContain(password);
      expect(f.roots()).toEqual([]);
      expect(vi.mocked(fs.writeFileSync).mock.calls.some((args) => String(args[0]).endsWith('/credentials.json'))).toBe(false);
      if (stage === 'secret-in-error') expect(last(f)).toContain('[redacted]');
      for (const call of f.processCalls) {
        expect(call.argv).not.toContain(password);
        if (call.kind === 'replay') expect(call.opts.env.AMBERCAST_SECRET_MEMOS_PASSWORD).toBe(password);
        if (['pack', 'install', 'chromium'].includes(call.kind)) expect(Object.values(call.opts.env ?? {})).not.toContain(password);
      }
    });
    it('TEST-33 fails when pack-install install exits non-zero', async () => {
      const f: Fake = stageFake('install'); expect(await run(f)).toBe(1); fail(f, 'install'); expect(f.starts).toEqual([]);
      const call = f.calls('install')[0]!;
      expect(call.argv).toEqual(['node', join(f.repoRoot, 'scripts/pack-install.mjs'), 'install', call.opts.cwd, '--manifest', f.manifest, '--pm', 'npm']);
      expect(f.calls('chromium')).toEqual([]); expect(f.roots()).toEqual([]);
    });
    it.each(['nonzero', 'timeout'])('TEST-34 fails when the chromium launch probe fails or times out', async (mode) => {
      const f: Fake = createFakeDeps({ runProcess: (call) => call.kind === 'chromium' ? result(mode === 'timeout' ? null : 1, '', 'launch failed', mode === 'timeout' ? 'SIGTERM' : null) : f.successfulProcess(call) });
      expect(await run(f)).toBe(1); fail(f, 'chromium'); expect(last(f)).toContain('npx playwright-core install chromium');
      const call = f.calls('chromium')[0]!; expect(call.argv.slice(0, 3)).toEqual(['node', '--input-type=module', '-e']);
      expect(call.argv[3]!).toContain('playwright-core'); expect(call.argv[3]!).toMatch(/chromium\.launch\(/); expect(call.argv[3]!).toMatch(/headless\s*:\s*true/);
      expect(call.argv[3]!).toContain('.close()'); expect(call.opts.cwd).toBe(f.calls('install')[0]!.opts.cwd); expect(call.opts.timeoutMs).toBe(30000);
      expect(f.starts).toEqual([]); expect(f.roots()).toEqual([]);
    });
    it('TEST-47 removes the container and run root on a normal pass', async () => {
      const f: Fake = createFakeDeps({ runner: { removeContainer: async (name: string) => {
        expect(fs.existsSync(join(f.tmpRoot, name))).toBe(true); f.containers.delete(name);
      } } });
      expect(await run(f)).toBe(0); expect(f.runnerCount('removeContainer')).toBe(1);
      expect(f.runnerCalls.find((c) => c.method === 'removeContainer')!.args[0]).toBe(f.starts[0]!.name);
      expect(f.containers.size).toBe(0); expect(f.events.lastIndexOf('listContainers')).toBeGreaterThan(f.events.indexOf('removeContainer'));
      expect(f.roots()).toEqual([]);
    });
    it.each(['install', 'chromium', 'container', 'ready', 'bootstrap', 'replay', 'judge'])('TEST-48 removes the container after any post-container-start failure', async (stage) => {
      const f: Fake = stageFake(stage); expect(await run(f)).toBe(1); expect(f.roots()).toEqual([]);
      expect(f.runnerCount('removeContainer')).toBe(['install', 'chromium'].includes(stage) ? 0 : 1);
      if (f.starts.length) expect(f.runnerCalls.find((c) => c.method === 'removeContainer')!.args[0]).toBe(f.starts[0]!.name);
    });
    it('TEST-49 removes the container even when startContainer itself rejects', async () => {
      const f: Fake = createFakeDeps({ runner: { startContainer: async (spec: ContainerSpec) => { f.containers.add(spec.name); throw new Error('ambiguous client failure'); } } });
      expect(await run(f)).toBe(1); fail(f, 'container'); expect(f.runnerCount('removeContainer')).toBe(1);
      expect(f.containers.size).toBe(0); expect(f.roots()).toEqual([]);
    });
    it.each(['SIGINT', 'SIGTERM'])('TEST-50 tears down and exits 130/143 on SIGINT/SIGTERM at every stage', async (signal) => {
      const f: Fake = createFakeDeps({ runProcess: async (call) => {
        if (call.kind !== 'replay') return f.successfulProcess(call);
        f.signals.emit(signal); expect(call.opts.signal.aborted).toBe(true); f.events.push('child-stopped');
        return result(null, '', '', signal);
      }, runner: { removeContainer: async (name: string, opts: { signal: AbortSignal; timeoutMs: number }) => {
        expect(f.events).toContain('child-stopped'); expect(opts.signal.aborted).toBe(false); expect(opts.timeoutMs).toBe(60000);
        f.signals.emit(signal === 'SIGINT' ? 'SIGTERM' : 'SIGINT'); f.containers.delete(name);
      } } });
      expect(await run(f)).toBe(signal === 'SIGINT' ? 130 : 143);
      expect(last(f)).toBe('verify-memos: FAIL stage=replay reason=interrupted aiCalls=n/a');
      expect(f.runnerCount('removeContainer')).toBe(1); expect(f.roots()).toEqual([]);
      for (const name of ['SIGINT', 'SIGTERM']) {
        const on = f.signalCalls.find((c) => c.method === 'on' && c.name === name)!;
        expect(on).toBeDefined(); expect(f.signalCalls).toContainEqual({ ...on, method: 'off' }); expect(f.signals.listenerCount(name)).toBe(0);
      }
    });
    it.each(['preflight', 'success', 'replay', 'signal'])('TEST-51 --keep skips teardown on a normal pass but not on preflight failure', async (mode) => {
      const f: Fake = mode === 'preflight' ? stageFake('preflight') : createFakeDeps({ runProcess: (call) => {
        if (mode === 'signal' && call.kind === 'replay') { f.signals.emit('SIGINT'); return result(null, '', '', 'SIGINT'); }
        if (mode === 'replay' && call.kind === 'replay') return result(1, reportText);
        return f.successfulProcess(call);
      } });
      expect(await run(f, ['--keep'])).toBe(mode === 'signal' ? 130 : mode === 'success' ? 0 : 1);
      if (mode === 'preflight') { expect(f.err()).not.toContain('docker rm'); expect(f.err()).not.toContain('rm -rf'); expect(f.roots()).toEqual([]); }
      else if (mode === 'signal') { expect(f.runnerCount('removeContainer')).toBe(1); expect(f.roots()).toEqual([]); }
      else {
        expect(f.runnerCount('removeContainer')).toBe(0); const root = join(f.tmpRoot, f.starts[0]!.name);
        expect(fs.existsSync(root)).toBe(true); expect(f.err()).toContain(f.starts[0]!.name); expect(f.err()).toContain(root);
        expect(f.err()).toContain(`docker rm -f ${f.starts[0]!.name}`); expect(f.err()).toContain('rm -rf');
        expect(JSON.parse(fs.readFileSync(join(root, 'credentials.json'), 'utf8'))).toEqual({ username: 'verifier', password });
        expect(fs.statSync(join(root, 'credentials.json')).mode & 0o777).toBe(0o600);
      }
      expect(f.out()).not.toContain(password); expect(f.err()).not.toContain(password);
    });
    it('TEST-52 FAIL stage=teardown when removeContainer rejects', async () => {
      const f: Fake = createFakeDeps({ runner: { removeContainer: async () => { throw new Error('remove failed'); } } });
      expect(await run(f)).toBe(1); fail(f, 'teardown', '0'); expect(last(f)).toContain('remove failed');
      expect(f.roots()).toEqual([]); expect(f.runnerCount('removeContainer')).toBe(1);
    });
    it('TEST-52 keeps the replay reason when teardown also fails', async () => {
      const f: Fake = createFakeDeps({ runProcess: (call) => call.kind === 'replay' ? result(1, reportText, 'replay failed') : f.successfulProcess(call),
        runner: { removeContainer: async () => { throw new Error('cleanup failed'); } } });
      expect(await run(f)).toBe(1); fail(f, 'replay', '0');
      expect(last(f)).toContain('exit=1');
      expect(last(f)).toContain('; teardown failed: cleanup failed');
      expect(f.runnerCount('removeContainer')).toBe(1); expect(f.roots()).toEqual([]);
    });
    it('TEST-52 keeps exit 130 when SIGINT is followed by teardown failure', async () => {
      const f: Fake = createFakeDeps({ runProcess: (call) => {
        if (call.kind !== 'replay') return f.successfulProcess(call);
        f.signals.emit('SIGINT'); expect(call.opts.signal.aborted).toBe(true);
        return result(null, '', '', 'SIGINT');
      }, runner: { removeContainer: async () => { throw new Error('cleanup failed'); } } });
      expect(await run(f)).toBe(130);
      expect(last(f)).toContain('FAIL stage=replay reason=interrupted; teardown failed: cleanup failed aiCalls=n/a');
      expect(f.runnerCount('removeContainer')).toBe(1); expect(f.roots()).toEqual([]);
    });
    it('TEST-53 FAIL stage=teardown when the container is still listed after removal', async () => {
      const f: Fake = createFakeDeps({ runner: { removeContainer: async () => undefined } });
      expect(await run(f)).toBe(1); fail(f, 'teardown', '0'); expect(last(f)).toContain(f.starts[0]!.name);
      expect(f.runnerCount('removeContainer')).toBe(1); expect(f.roots()).toEqual([]);
    });
  });

  describe('replay and judge', () => {
    it('TEST-35 copies the fixture byte-identically and leaves it unchanged', async () => {
      const f: Fake = createFakeDeps({ runProcess: (call) => {
        if (call.kind === 'check') for (const file of files) expect(fs.readFileSync(join(call.opts.cwd, file))).toEqual(fs.readFileSync(join(f.fixture, file)));
        return f.successfulProcess(call);
      } });
      const before = snapshot(f.fixture); expect(await run(f)).toBe(0); expect(f.calls('check')).toHaveLength(1);
      expect(snapshot(f.fixture)).toEqual(before);
    });
    it.each([[], ['memos.password', 'api.key'], ['*']])('TEST-36 fails when secrets.allow is not exactly one entry', async (...allow) => {
      const f: Fake = createFakeDeps(), path = join(f.fixture, files[0]), config = JSON.parse(fs.readFileSync(path, 'utf8'));
      config.secrets.allow = allow; write(path, JSON.stringify(config));
      expect(await run(f)).toBe(1); fail(f, 'fixture'); expect(f.starts).toEqual([]); expect(f.calls('replay')).toEqual([]);
    });
    it.each([
      [4, JSON.stringify({ results: [{ status: 'stale', reason: 'digest changed' }] }), 'stale'],
      [4, JSON.stringify({ results: [{ status: 'stale-grounding' }] }), 'stale-grounding'],
      [4, JSON.stringify({ results: [{ status: 'missing-grounding' }] }), 'missing-grounding'],
      [4, 'not JSON', 'exit=4'], [4, '{"results":[]}', 'exit=4'],
      [0, JSON.stringify({ results: prompts.map((file, i) => ({ file, status: ['fresh', 'fresh-without-grounding', 'listed', 'skipped'][i % 4] })) }), null],
    ] as const)('TEST-37 fails when check reports a non-fresh status', async (status, text, reason) => {
      vi.stubEnv('CI', '1'); vi.stubEnv('AMBERCAST_CONFIG', '/parent/config');
      const f: Fake = createFakeDeps({ runProcess: (call) => call.kind === 'check' ? result(status, text) : f.successfulProcess(call) });
      expect(await run(f)).toBe(status === 0 ? 0 : 1);
      const env = f.calls('check')[0]!.opts.env; expect(env).not.toHaveProperty('CI'); expect(env).not.toHaveProperty('AMBERCAST_CONFIG');
      if (reason) { fail(f, 'fixture'); expect(last(f)).toContain(reason); expect(last(f)).toContain('--regenerate'); expect(f.starts).toEqual([]); }
      if (text.includes('digest changed')) expect(last(f)).toContain('digest changed');
    });
    it('TEST-38 invokes ambercast run with the exact argv, cwd, timeout, and env', async () => {
      vi.stubEnv('CI', '1'); vi.stubEnv('GITHUB_ACTIONS', 'true'); vi.stubEnv('AMBERCAST_CONFIG', 'parent');
      vi.stubEnv('AMBERCAST_AI_PROVIDER', 'claude'); vi.stubEnv('AMBERCAST_SECRET_OLD', 'old'); vi.stubEnv('MEMOS_TEST_PRESERVED', 'kept');
      const f: Fake = createFakeDeps(); expect(await run(f)).toBe(0); expect(f.calls('replay')).toHaveLength(1);
      const call = f.calls('replay')[0]!, project = f.calls('install')[0]!.opts.cwd;
      expect(call.argv).toEqual([join(project, 'node_modules/.bin/ambercast'), 'run', '--json', '--no-color', ...prompts]);
      expect(call.opts.cwd).toBe(project); expect(call.opts.timeoutMs).toBe(120000 * caseTable.length); expect(call.opts.signal).toBeInstanceOf(AbortSignal);
      for (const key of ['CI', 'GITHUB_ACTIONS', 'AMBERCAST_CONFIG', 'AMBERCAST_AI_PROVIDER', 'AMBERCAST_SECRET_OLD']) expect(call.opts.env).not.toHaveProperty(key);
      expect(call.opts.env.AMBERCAST_SECRET_MEMOS_PASSWORD).toBe(password); expect(call.opts.env.MEMOS_TEST_PRESERVED).toBe('kept');
      expect(process.env.CI).toBe('1'); expect(process.env.AMBERCAST_CONFIG).toBe('parent');
    });
    it.each([4, 3, 1, 'non-json', 'timeout'] as const)('TEST-39 maps a non-zero replay exit to the documented FAIL reason', async (mode) => {
      const text = JSON.stringify({ ...report, results: report.results.map((row, i) => i === 1 ? { ...row, status: 'failed', aiCalls: 2 } : row),
        errors: [{ code: 'FIRST_ERROR', message: 'first diagnostic\nnext line' }, { code: 'SECOND_ERROR' }] });
      const f: Fake = createFakeDeps({ runProcess: (call) => call.kind === 'replay'
        ? result(mode === 'timeout' ? null : typeof mode === 'number' ? mode : 1, mode === 'non-json' ? 'not JSON' : mode === 'timeout' ? '' : text, '', mode === 'timeout' ? 'SIGTERM' : null)
        : f.successfulProcess(call) });
      expect(await run(f)).toBe(1); fail(f, 'replay', mode === 'non-json' ? 'unknown' : mode === 'timeout' ? 'n/a' : '2');
      if (mode === 'non-json') expect(last(f)).toContain('non-json stdout');
      else if (mode === 'timeout') expect(last(f)).toContain('exit=null signal=SIGTERM');
      else {
        expect(last(f)).toContain(`exit=${mode}`); expect(last(f)).toContain('FIRST_ERROR'); expect(last(f)).toContain('first diagnostic');
        expect(last(f)).toContain('failed'); expect(last(f)).not.toContain('SECOND_ERROR');
        if (mode === 4) expect(last(f)).toContain('--regenerate'); else expect(last(f)).not.toContain('--regenerate');
        expect(f.calls('judge')[0]!.opts.env.AMBERCAST_VERIFY_MEMOS_MODE).toBe('disclosure-only');
      }
    });
    it.each([0, 1])('TEST-40 saves the replay stdout verbatim to runRoot/report.json', async (status) => {
      const f: Fake = createFakeDeps({ runProcess: (call) => {
        if (call.kind === 'replay' && status) return result(status, reportText);
        if (call.kind === 'judge') expect(fs.readFileSync(join(dirname(call.opts.env.AMBERCAST_VERIFY_MEMOS_REPORT!), 'report.json'), 'utf8')).toBe(reportText);
        return f.successfulProcess(call);
      } });
      expect(await run(f)).toBe(status === 0 ? 0 : 1); expect(f.calls('judge')).toHaveLength(1);
      expect(f.calls('judge')[0]!.opts.env.AMBERCAST_VERIFY_MEMOS_REPORT).toBe(join(f.tmpRoot, f.starts[0]!.name, 'report.json'));
    });
    it.each([0, 1])('TEST-42 invokes the judge vitest child with the exact argv and env', async (status) => {
      vi.stubEnv('AMBERCAST_VERIFY_MEMOS_MODE', 'disclosure-only'); vi.stubEnv('CI', '1');
      const f: Fake = createFakeDeps({ runProcess: (call) => call.kind === 'judge' ? result(status, '', status ? 'judge failed' : '') : f.successfulProcess(call) });
      expect(await run(f)).toBe(status === 0 ? 0 : 1); expect(f.calls('judge')).toHaveLength(1);
      const call = f.calls('judge')[0]!, project = f.calls('replay')[0]!.opts.cwd;
      expect(call.argv).toEqual([join(f.repoRoot, 'node_modules/.bin/vitest'), 'run', '--config', 'vitest.config.verification.ts', 'test/verification/memos/smoke-judge.verification.test.ts']);
      expect(call.opts.cwd).toBe(f.repoRoot); expect(call.opts.timeoutMs).toBe(120000); expect(call.opts.signal).toBeInstanceOf(AbortSignal);
      expect(call.opts.env.AMBERCAST_VERIFY_MEMOS_MODE).toBe('full'); expect(call.opts.env).not.toHaveProperty('CI');
      expect(call.opts.env.AMBERCAST_VERIFY_MEMOS_REPORT).toBe(join(dirname(project), 'report.json'));
      expect(JSON.parse(call.opts.env.AMBERCAST_VERIFY_MEMOS_ARTIFACT_ROOTS!)).toEqual([join(project, 'tests/ambercast/.runs'), ...plans.map(file => join(project, file)), ...groundings.map(file => join(project, file))]);
      expect(JSON.parse(call.opts.env.AMBERCAST_VERIFY_MEMOS_SECRETS!)).toEqual({ 'memos.password': password });
      if (status) fail(f, 'judge', '0');
    });
  });

  describe('signals', () => {
    it.each(['SIGINT', 'SIGTERM'].flatMap((signal) =>
      ['pack', 'install', 'chromium', 'check', 'container', 'ready', 'generate', 'resolve', 'replay', 'judge', 'teardown']
        .map((stage) => ({ signal, stage }))))
    ('TEST-50 signal handling across every stage (see lifecycle above)', async ({ signal, stage }) => {
      let emitted = false;
      const interrupt = (active: AbortSignal, abortExpected = true) => {
        f.signals.emit(signal); emitted = true; expect(active.aborted).toBe(abortExpected);
        f.events.push('operation-stopped');
      };
      const f: Fake = createFakeDeps({
        runner: {
          startContainer: async (spec: ContainerSpec, opts: { signal: AbortSignal }) => {
            f.containers.add(spec.name);
            if (stage === 'container') { interrupt(opts.signal); throw new DOMException('aborted', 'AbortError'); }
          },
          removeContainer: async (name: string, opts: { signal: AbortSignal; timeoutMs: number }) => {
            expect(opts.signal.aborted).toBe(false); expect(opts.timeoutMs).toBe(60000);
            if (stage === 'teardown' && !emitted) interrupt(opts.signal, false);
            else { expect(emitted).toBe(true); expect(f.events).toContain('operation-stopped'); }
            f.signals.emit(signal === 'SIGINT' ? 'SIGTERM' : 'SIGINT');
            expect(opts.signal.aborted).toBe(false); f.containers.delete(name); f.events.push('teardown-finished');
          },
        },
        fetch: async (url, opts) => {
          if (stage === 'ready' && url.endsWith('/healthz')) { interrupt(opts.signal!); throw new DOMException('aborted', 'AbortError'); }
          return { status: 200, json: async () => url.endsWith('/profile') ? { needsSetup: true } : { accessToken: 't' } };
        },
        runProcess: async (call) => {
          if (call.kind !== stage) return f.successfulProcess(call);
          interrupt(call.opts.signal);
          // Resolving represents confirmation that the child group has stopped.
          await Promise.resolve(); f.events.push('child-stopped'); return result(null, '', '', signal);
        },
      });
      expect(await run(f, ['generate', 'resolve'].includes(stage) ? ['--regenerate'] : [])).toBe(signal === 'SIGINT' ? 130 : 143);
      expect(emitted).toBe(true);
      const expectedStage = stage === 'check' || stage === 'generate' ? 'fixture' : stage === 'resolve' ? 'replay' : stage;
      expect(last(f)).toBe(`verify-memos: FAIL stage=${expectedStage} reason=interrupted aiCalls=n/a`);
      // Consent failures need no container cleanup because generation precedes startup.
      const hasContainer = !['pack', 'install', 'chromium', 'check', 'generate'].includes(stage);
      expect(f.runnerCount('removeContainer')).toBe(hasContainer ? 1 : 0);
      expect(f.containers.size).toBe(0); expect(f.roots()).toEqual([]);
      if (hasContainer) expect(f.events).toContain('teardown-finished');
      if (stage !== 'teardown' && !['ready', 'container'].includes(stage)) {
        expect(f.events).toContain('child-stopped');
        if (hasContainer) expect(f.events.indexOf('child-stopped')).toBeLessThan(f.events.indexOf('removeContainer'));
      }
      if (stage === 'ready' || stage === 'container') expect(f.calls('replay')).toEqual([]);
      expect(f.signals.listenerCount('SIGINT')).toBe(0); expect(f.signals.listenerCount('SIGTERM')).toBe(0);
    });
  });

  describe('clean', () => {
    it.each(['empty', 'stale', 'daemon-failure'])('TEST-55 --clean only reaps and prints the cleaned summary line', async (mode) => {
      const f: Fake = mode === 'daemon-failure' ? stageFake('preflight') : createFakeDeps();
      if (mode === 'stale') {
        const name = 'ambercast-verify-memos-deadbeef'; f.containers.add(name);
        write(join(f.tmpRoot, name, 'owner.pid'), '2147483647');
        vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('dead'), { code: 'ESRCH' }); });
      }
      expect(await run(f, ['--clean'])).toBe(mode === 'daemon-failure' ? 1 : 0);
      if (mode !== 'daemon-failure') expect(f.out()).toBe(`verify-memos: cleaned containers=${mode === 'stale' ? 1 : 0} dirs=${mode === 'stale' ? 1 : 0}\n`);
      else { expect(f.out()).toBe(''); expect(f.err()).toContain('preflight'); }
      expect(f.processCalls).toEqual([]); expect(f.starts).toEqual([]); expect(f.runnerCount('pullImage')).toBe(0);
      expect(f.events).not.toContain('port'); expect(f.roots()).toEqual([]);
    });
    it('TEST-56 reaps stale port holders before the port check', async () => {
      const stale = 'ambercast-verify-memos-deadbeef';
      const f: Fake = createFakeDeps({ assertPortFree: async () => { expect(f.containers.has(stale)).toBe(false); expect(fs.existsSync(join(f.tmpRoot, stale))).toBe(false); } });
      f.containers.add(stale); write(join(f.tmpRoot, stale, 'owner.pid'), '2147483647');
      vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('dead'), { code: 'ESRCH' }); });
      expect(await run(f)).toBe(0);
      expect(f.events.indexOf('removeContainer')).toBeLessThan(f.events.indexOf('port'));
      expect(f.runnerCalls.find((c) => c.method === 'removeContainer')!.args[0]).toBe(stale);
    });
  });

  describe('regenerate', () => {
    it.each([undefined, 'codex', 'claude'])('TEST-544-12 generates each target in order before credentials or containers (ai=%s)', async ai => {
      const f = createFakeDeps({});
      expect(await run(f, ['--regenerate', ...(ai ? ['--ai', ai] : [])])).toBe(0);
      const generated = f.calls('generate'); expect(generated).toHaveLength(3);
      for (const [i, target] of ['memos', 'memos-readonly', 'memos-ja'].entries()) {
        const selected = prompts.filter((_, j) => caseTable[j]!.target === target);
        expectCommand(generated[i]!, ['generate', '--target', target, ...selected, ...(ai ? ['--ai', ai] : [])], 900_000 * selected.length);
      }
      const passwordAt = f.events.indexOf('password-generated'), containerAt = f.events.indexOf('startContainer');
      expect(f.events.lastIndexOf('generate')).toBeLessThan(passwordAt); expect(passwordAt).toBeLessThan(containerAt);
    });
    it('TEST-544-12 stops after the second generate fails without publishing or starting Memos', async () => {
      const f: Fake = createFakeDeps({ runProcess: call => call.kind === 'generate' && f.calls('generate').length === 2
        ? result(1, '', 'second target rejected') : f.successfulProcess(call) });
      const before = snapshot(f.fixture);
      expect(await run(f, ['--regenerate'])).toBe(1); fail(f, 'fixture');
      expect(f.calls('generate')).toHaveLength(2); expect(f.starts).toEqual([]); expect(f.passwordGenerated()).toBe(false);
      expect(snapshot(f.fixture)).toEqual(before);
    });
    it.each([[], ['password', 'memos_password'], ['*']])('rejects invalid consent before regeneration (%j)', async (...allow) => {
      const f = createFakeDeps(), path = join(f.fixture, files[0]), config = JSON.parse(fs.readFileSync(path, 'utf8'));
      config.secrets.allow = allow; write(path, JSON.stringify(config));
      const before = snapshot(f.fixture);
      expect(await run(f, ['--regenerate'])).toBe(1); fail(f, 'fixture');
      expect(f.calls('generate')).toEqual([]); expect(f.starts).toEqual([]);
      expect(snapshot(f.fixture)).toEqual(before);
    });
    it.each([['password', 'memos_password'], ['memos_password']])('rejects changed consent after regeneration (%j)', async (...allow) => {
      const f: Fake = createFakeDeps({ runProcess: async call => {
        if (call.kind === 'generate') expect(JSON.parse(fs.readFileSync(join(call.opts.cwd, files[0]), 'utf8')).secrets.allow).toEqual(['password']);
        const success = await f.successfulProcess(call);
        if (call.kind === 'generate') {
          const path = join(call.opts.cwd, files[0]), config = JSON.parse(fs.readFileSync(path, 'utf8'));
          config.secrets.allow = f.calls('generate').length === targets.length ? allow : ['password'];
          write(path, JSON.stringify(config));
        }
        return success;
      } });
      const path = join(f.fixture, files[0]), config = JSON.parse(fs.readFileSync(path, 'utf8'));
      config.secrets.allow = ['password']; write(path, JSON.stringify(config));
      const before = snapshot(f.fixture);
      expect(await run(f, ['--regenerate'])).toBe(1); fail(f, 'fixture');
      expect(f.calls('generate')).toHaveLength(targets.length);
      expect(f.starts).toEqual([]); expect(f.calls('resolve')).toEqual([]);
      expect(snapshot(f.fixture)).toEqual(before);
      expect(vi.mocked(fs.renameSync).mock.calls.filter(([, dest]) => publications.some(p => String(dest) === join(f.fixture, p)))).toEqual([]);
    });
    it('TEST-544-13 resolves all cases once after all targets have generated and consent has settled', async () => {
      const f: Fake = createFakeDeps({ runProcess: async call => {
        const success = await f.successfulProcess(call);
        if (call.kind === 'generate') {
          const path = join(call.opts.cwd, files[0]), config = JSON.parse(fs.readFileSync(path, 'utf8'));
          config.secrets.allow = f.calls('generate').length < 3 ? ['temporary.one', 'temporary.two'] : ['memos.password'];
          write(path, JSON.stringify(config));
        }
        return success;
      } });
      expect(await run(f, ['--regenerate'])).toBe(0); expect(f.calls('generate')).toHaveLength(3);
      expect(f.calls('resolve')).toHaveLength(1);
      expectCommand(f.calls('resolve')[0]!, ['run', '--resolve', '--update-cache', '--json', ...prompts], 6_300_000);
      expect(f.events.lastIndexOf('generate')).toBeLessThan(f.events.indexOf('resolve'));
    });
    it.each(['extra-consent', 'extra-fill'])('TEST-544-13 refuses unsafe generated consent or a writable heal plan (%s)', async mode => {
      const f: Fake = createFakeDeps({ runProcess: async call => {
        const success = await f.successfulProcess(call);
        if (call.kind === 'generate' && f.calls('generate').length === 3) {
          if (mode === 'extra-consent') {
            const path = join(call.opts.cwd, files[0]), config = JSON.parse(fs.readFileSync(path, 'utf8'));
            config.secrets.allow = ['memos.password', 'other.password']; write(path, JSON.stringify(config));
          } else {
            const generated = readOnlyPlan();
            generated.steps.push({ id: 'write-memo', kind: 'action', action: 'fill', target: 'memos-readonly', value: 'unsafe mutation', intent: { description: 'Memo input', roleHint: 'textbox', sourceSpan: fakeSourceSpan } });
            expect(PlanDocument.safeParse(generated).success).toBe(true);
            write(join(call.opts.cwd, healPlan), JSON.stringify(generated));
          }
        }
        return success;
      } });
      const before = snapshot(f.fixture);
      expect(await run(f, ['--regenerate'])).toBe(1); fail(f, 'fixture', mode === 'extra-fill' ? '0' : 'n/a'); expect(f.calls('generate')).toHaveLength(3);
      expect(fullJudges(f)).toHaveLength(mode === 'extra-fill' ? 1 : 0);
      if (mode === 'extra-consent') { expect(f.calls('resolve')).toEqual([]); expect(f.starts).toEqual([]); }
      expect(snapshot(f.fixture)).toEqual(before);
      expect(vi.mocked(fs.renameSync).mock.calls.filter(([, dest]) => publications.some(p => String(dest) === join(f.fixture, p)))).toEqual([]);
    });
    it.each([0, 1, 8, 15])('TEST-544-14 publishes all artifacts in order and diagnoses partial publication (failure=%s)', async failedAt => {
      const f = createFakeDeps({}), before = snapshot(f.fixture);
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
      const renamed: string[] = []; let attempted = 0;
      vi.mocked(fs.renameSync).mockImplementation((source, destination) => {
        const file = publications.find(p => String(destination) === join(f.fixture, p));
        if (!file) return actual.renameSync(source, destination);
        expect(fullJudges(f)).toHaveLength(1); expect(fs.existsSync(join(f.fixture, '.lock'))).toBe(true);
        expect(String(source)).toBe(`${String(destination)}.tmp-${f.starts[0]!.runId}`);
        expect(fs.readFileSync(source)).toEqual(fs.readFileSync(join(f.calls('replay')[0]!.opts.cwd, file)));
        expect(vi.mocked(fs.writeFileSync).mock.calls.find(args => String(args[0]) === String(source))?.[2]).toEqual(expect.objectContaining({ flag: 'wx' }));
        if (++attempted === failedAt) throw new Error('rename failed ' + 'x'.repeat(600));
        actual.renameSync(source, destination); renamed.push(file);
      });
      expect(await run(f, ['--regenerate'])).toBe(failedAt ? 1 : 0);
      expect(renamed).toEqual(publications.slice(0, failedAt ? failedAt - 1 : undefined));
      for (const p of prompts) expect(snapshot(f.fixture)[p]).toBe(before[p]);
      if (failedAt) {
        fail(f, 'fixture', '0');
        const reason = last(f).split(' reason=')[1]!.replace(/ aiCalls=.*$/, '');
        expect(reason.length).toBeLessThanOrEqual(400);
        expect(reason.endsWith(`; published files: ${failedAt - 1} of 15${failedAt > 1 ? `; fixture updated: ${failedAt - 1} of 15` : ''}`)).toBe(true);
        expect(f.err().trimEnd().split('\n').at(-1)).toBe(`verify-memos: published files: ${renamed.join(', ') || 'none'}`);
      }
      expect(fs.existsSync(join(f.fixture, '.lock'))).toBe(false); cleaned(f);
    });
    it('TEST-544-27 emits one fixture success per copy, target generation and publication', async () => {
      const f = createFakeDeps({}); expect(await run(f, ['--regenerate'])).toBe(0);
      expect(f.out().match(/^verify-memos: fixture ok.*$/gm)).toHaveLength(5);
    });
    it('TEST-70 redacts split secrets from resolve streams while preserving judge evidence', async () => {
      // Generation precedes password creation, so only resolve's chunk-split redaction is
      // exercised here; generate's stdio wiring is covered by TEST-57/58/74.
      const raw = `before ${password} after`;
      const resolveReport = JSON.stringify({ ...report, runId: 'resolve-run', errors: [{ code: 'STREAM_SECRET', message: raw }],
        results: suiteReport(prompts, 9).results });
      let captured: ProcessResult | undefined;
      const f: Fake = createFakeDeps({ runProcess: async (call) => {
        if (call.kind === 'resolve') {
          await f.successfulProcess(call);
          write(join(call.opts.cwd, 'tests/ambercast/.runs/resolve-run/report.json'), resolveReport);
          vi.mocked(childProcess.spawn).mockImplementationOnce(() => {
            const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; pid: number };
            child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.pid = 12345;
            queueMicrotask(() => {
              const at = resolveReport.indexOf(password) + 8;
              child.stdout.emit('data', Buffer.from(resolveReport.slice(0, at)));
              child.stdout.emit('data', Buffer.from(resolveReport.slice(at)));
              child.stderr.emit('data', Buffer.from(raw.slice(0, 8 + 8)));
              child.stderr.emit('data', Buffer.from(raw.slice(8 + 8)));
              child.emit('exit', 0, null); child.emit('close', 0, null);
            });
            return child as never;
          });
          captured = await runProcess(call.argv[0], call.argv.slice(1), call.opts) as ProcessResult;
          expect(captured.stdout).toContain(password);
          expect(captured.stderr).toContain(password);
          return captured;
        }
        if (call.kind === 'judge') {
          const roots = JSON.parse(call.opts.env.AMBERCAST_VERIFY_MEMOS_ARTIFACT_ROOTS!) as string[];
          expect(roots).toEqual(expect.arrayContaining([join(dirname(f.calls('install')[0]!.opts.cwd), 'project/tests/ambercast/.runs')]));
          const savedReport = join(dirname(f.calls('install')[0]!.opts.cwd), 'resolve-report.json');
          expect(fs.readFileSync(savedReport, 'utf8')).toBe(captured!.stdout);
        }
        return f.successfulProcess(call);
      } });
      expect(await run(f, ['--regenerate', '--keep'])).toBe(0);
      const savedReport = join(dirname(f.calls('install')[0]!.opts.cwd), 'resolve-report.json');
      expect(fs.readFileSync(savedReport, 'utf8')).toBe(captured!.stdout);
      expect(captured).toBeDefined(); expect(f.err()).toContain('before ');
      expect(f.err()).toContain('[redacted]');
      expect(f.err()).not.toContain(password); expect(f.out()).not.toContain(password);
      expect(f.calls('judge')).toHaveLength(1);
    });
    it('TEST-70 adds secret disclosed to a failed replay when disclosure-only judging finds a real leak', async () => {
      const leaked = JSON.stringify({ ...report, errors: [{ code: 'SECRET', message: password }] });
      const f: Fake = createFakeDeps({ runProcess: (call) => {
        if (call.kind === 'replay') return result(1, leaked);
        if (call.kind === 'judge') {
          expect(call.opts.env.AMBERCAST_VERIFY_MEMOS_MODE).toBe('disclosure-only');
          expect(fs.readFileSync(call.opts.env.AMBERCAST_VERIFY_MEMOS_REPORT!, 'utf8')).toBe(leaked);
          return result(1, '', 'judgeSmokeReport: 1 violation(s)\n- assertNoSecretDisclosure: secret "memos.password" found in report');
        }
        return f.successfulProcess(call);
      } });
      expect(await run(f)).toBe(1); fail(f, 'replay', '0');
      expect(last(f)).toContain('exit=1');
      expect(last(f)).toContain('secret disclosed: exit=1 judgeSmokeReport: 1 violation(s)');
      expect(f.calls('judge')).toHaveLength(1);
    });
    it('TEST-70 reports a disclosure-only judge inspection failure distinctly from a real secret disclosure', async () => {
      const leaked = JSON.stringify({ ...report, errors: [{ code: 'SECRET', message: password }] });
      const f: Fake = createFakeDeps({ runProcess: (call) => {
        if (call.kind === 'replay') return result(1, leaked);
        if (call.kind === 'judge') {
          expect(call.opts.env.AMBERCAST_VERIFY_MEMOS_MODE).toBe('disclosure-only');
          return result(1, '', 'judgeSmokeReport: cannot read <path>: ENOENT');
        }
        return f.successfulProcess(call);
      } });
      expect(await run(f)).toBe(1); fail(f, 'replay', '0');
      expect(last(f)).toContain('judge inspection failed: exit=1 judgeSmokeReport: cannot read');
      expect(last(f)).not.toContain('secret disclosed');
      expect(f.calls('judge')).toHaveLength(1);
    });
    it('TEST-57 runs generate before any password or container, then resolve, a full reset, then a normal replay, in order', async () => {
      vi.stubEnv('CI', '1'); vi.stubEnv('GITHUB_ACTIONS', 'true'); vi.stubEnv('AMBERCAST_AI_PROVIDER', 'claude');
      vi.stubEnv('AMBERCAST_SECRET_OLD', 'stale');
      const f: Fake = createFakeDeps({ runProcess: async (call) => {
        if (call.kind === 'generate') {
          // Generation runs before any password exists and
          // before the instance is ever started (SPEC-13), so consent's TTY
          // check never collides with piped redaction.
          expect(f.events).not.toContain('startContainer');
          expect(f.events).not.toContain('/api/v1/auth/signin');
          expect(f.passwordGenerated()).toBe(false);
          expect(JSON.parse(fs.readFileSync(join(call.opts.cwd, files[0]), 'utf8')).secrets.allow).toEqual(['memos.password']);
          expect(fs.existsSync(join(call.opts.cwd, prompt))).toBe(true);
          const targetPrompts = prompts.filter((_, i) => caseTable[i]!.target === targets[f.calls('generate').length - 1]);
          for (const file of targetPrompts.flatMap(p => [p.replace('.test.md', '.ambercast.plan.json'), p.replace('.test.md', '.ambercast.grounding.json')])) expect(fs.existsSync(join(call.opts.cwd, file))).toBe(false);
          const target = targets[f.calls('generate').length - 1]!;
          const selected = prompts.filter((_, i) => caseTable[i]!.target === target);
          expect(call.argv).toEqual([join(call.opts.cwd, 'node_modules/.bin/ambercast'), 'generate', '--target', target, ...selected, '--ai', 'codex']);
          expect(call.opts.stdio).toBe('generate'); expect(call.opts.password).toBeUndefined();
          expect(call.opts.onStderrChunk).toBeTypeOf('function');
          expect(Object.keys(call.opts.env ?? {}).some((key) => key.startsWith('AMBERCAST_SECRET_'))).toBe(false);
        }
        if (call.kind === 'resolve') {
          expect(f.passwordGenerated()).toBe(true);
          expect(JSON.parse(fs.readFileSync(join(call.opts.cwd, files[0]), 'utf8')).secrets.allow).toEqual(['memos.password']);
          expect(call.argv).toEqual(expect.arrayContaining(['run', '--resolve', '--update-cache', '--json', ...prompts, '--ai', 'codex']));
          expect(call.opts.env.AMBERCAST_SECRET_MEMOS_PASSWORD).toBe(password);
          expect(call.opts.stdio).toBe('resolve'); expect(call.opts.password).toBe(password);
          write(join(dirname(call.opts.cwd), 'data/old-instance'), 'must be discarded');
        }
        if (['generate', 'resolve', 'replay'].includes(call.kind)) {
          for (const key of ['CI', 'GITHUB_ACTIONS', 'AMBERCAST_AI_PROVIDER']) expect(call.opts.env).not.toHaveProperty(key);
        }
        if (call.kind === 'replay') {
          const runRoot = dirname(call.opts.cwd);
          expect(fs.existsSync(join(runRoot, 'data'))).toBe(false);
          expect(f.starts[1]!.data).toBe(join(runRoot, 'data-reset'));
          expect(f.starts[1]!.data).not.toBe(f.starts[0]!.data);
          expect(fs.readdirSync(f.starts[1]!.data)).toEqual([]);
          expect(call.argv).not.toContain('--resolve'); expect(call.argv).not.toContain('--update-cache');
        }
        if (call.kind === 'generate' || call.kind === 'resolve') {
          const text = call.kind === 'resolve' ? JSON.stringify({ ...suiteReport(prompts, 9), runId: 'resolve-run' }) : '';
          let capturedStdio: unknown, detached: unknown;
          vi.mocked(childProcess.spawn).mockImplementationOnce((_cmd, _args, options) => {
            capturedStdio = options?.stdio; detached = options?.detached;
            const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; pid: number };
            child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.pid = 12345;
            queueMicrotask(() => {
              if (text) child.stdout.emit('data', Buffer.from(text));
              child.emit('exit', 0, null); child.emit('close', 0, null);
            });
            return child as never;
          });
          const processed = await runProcess(call.argv[0], call.argv.slice(1), call.opts);
          expect(capturedStdio).toEqual(call.kind === 'generate' ? ['inherit', 'pipe', 'inherit'] : ['inherit', 'pipe', 'pipe']);
          expect(detached).toBe(true);
          if (call.kind === 'generate') {
            const path = join(call.opts.cwd, files[0]), config = JSON.parse(fs.readFileSync(path, 'utf8'));
            config.secrets.allow = ['memos.password']; write(path, JSON.stringify(config));
            await f.successfulProcess(call);
          } else write(join(call.opts.cwd, 'tests/ambercast/.runs/resolve-run/report.json'), text);
          return processed;
        }
        return f.successfulProcess(call);
      } });
      expect(await run(f, ['--regenerate', '--ai', 'codex'])).toBe(0);
      expect(f.calls('check')).toEqual([]); expect(f.calls('generate')).toHaveLength(targets.length); expect(f.calls('resolve')).toHaveLength(1);
      expect(f.starts).toHaveLength(2);
      const generate = f.events.indexOf('generate'), firstStart = f.events.indexOf('startContainer');
      const passwordGenerated = f.events.indexOf('password-generated');
      const firstReady = f.events.indexOf('/healthz', firstStart), firstSignin = f.events.indexOf('/api/v1/auth/signin', firstStart);
      const resolve = f.events.indexOf('resolve');
      const stop = f.events.indexOf('removeContainer'), secondStart = f.events.indexOf('startContainer', firstStart + 1);
      const secondReady = f.events.indexOf('/healthz', secondStart), secondSignin = f.events.indexOf('/api/v1/auth/signin', secondStart);
      const replay = f.events.indexOf('replay'), judge = f.events.indexOf('judge');
      const indices = [generate, passwordGenerated, firstStart, firstReady, firstSignin, resolve, stop, secondStart, secondReady, secondSignin, replay, judge];
      expect(indices.every((i) => i >= 0)).toBe(true); expect(indices).toEqual([...indices].sort((a, b) => a - b)); expect(new Set(indices).size).toBe(indices.length);
      const signins = f.fetchCalls.filter((c) => c.url.endsWith('/signin'));
      expect(signins).toHaveLength(2);
      for (const call of signins) expect(JSON.parse(String(call.opts.body)).passwordCredentials).toEqual({ username: 'verifier', password });
      expect(f.err()).toContain('generated safely');
      expect(f.err().match(/generated safely/g)).toHaveLength(targets.length);
      expect(f.err() + f.out()).not.toContain(password);
      expect(last(f)).toContain('PASS aiCalls=0');
      const stages = f.out().trimEnd().split('\n').slice(0, -1).map((line) => line.split(' ')[1]);
      expect(stages).toEqual([
        'port', 'pack', 'preflight', 'install', 'chromium', 'fixture', ...targets.map(() => 'fixture'),
        'container', 'ready', 'bootstrap', 'container', 'ready', 'bootstrap',
        'replay', 'judge', 'fixture', 'teardown',
      ]);
      expect(f.calls('judge')[0]!.opts.env.AMBERCAST_VERIFY_MEMOS_MODE).toBe('full');
    });
    it.each(['generate-exit1', 'generate-consent-refused', 'generate-eof', 'generate-not-interactive', 'resolve', 'replay', 'judge', 'zero-consent', 'two-consents', 'wildcard-consent'])
    ('TEST-58 leaves the fixture unchanged when any regenerate stage fails', async (stage) => {
      const f: Fake = createFakeDeps({ runProcess: async (call) => {
        if (call.kind === 'generate' && stage.startsWith('generate-')) return result(stage === 'generate-exit1' ? 1 : 2, '', `${stage} failed`);
        if (call.kind === stage) return result(1, ['resolve', 'replay'].includes(stage) ? reportText : '', `${stage} failed`);
        const successful = await f.successfulProcess(call);
        if (call.kind === 'generate' && stage.includes('consent') && f.calls('generate').length === targets.length) {
          const path = join(call.opts.cwd, files[0]), config = JSON.parse(fs.readFileSync(path, 'utf8'));
          config.secrets.allow = stage === 'zero-consent' ? [] : stage === 'two-consents' ? ['memos.password', 'api.key'] : ['*'];
          write(path, JSON.stringify(config));
        }
        return successful;
      } });
      const before = snapshot(f.fixture); expect(await run(f, ['--regenerate'])).toBe(1);
      const blockedBeforeInstance = stage.startsWith('generate-') || stage.includes('consent');
      fail(f, blockedBeforeInstance ? 'fixture' : stage === 'resolve' ? 'replay' : stage, stage === 'replay' || stage === 'judge' ? '0' : 'n/a');
      expect(snapshot(f.fixture)).toEqual(before); expect(f.roots()).toEqual([]);
      // Generate/consent failures happen before any
      // password or container exists; resolve failures happen after exactly
      // one (pre-resolve) instance start, replay/judge failures after two.
      expect(f.passwordGenerated()).toBe(!blockedBeforeInstance);
      expect(f.starts).toHaveLength(blockedBeforeInstance ? 0 : stage === 'resolve' ? 1 : 2);
      if (blockedBeforeInstance) {
        expect(f.calls('resolve')).toEqual([]); expect(f.calls('replay')).toEqual([]);
        expect(f.fetchCalls.some((call) => call.url.endsWith('/auth/signin'))).toBe(false);
        expect(f.fetchCalls).toHaveLength(0);
      }
    });
    it.each(['pass', 'second-rename-fails', 'judge-fails', 'judge-throws', 'disclosure-only', 'teardown-fails', 'signal-during-publish', 'signal-during-publish-term', 'signal-after-publish'])
    ('TEST-59 writes back config, plan, grounding atomically and in order after judge passes (%s)', async (mode) => {
      const f: Fake = createFakeDeps({ runProcess: async (call) => {
        if (mode === 'disclosure-only' && call.kind === 'replay') return result(1, reportText);
        if (call.kind === 'judge') {
          expect(fs.readFileSync(call.opts.env.AMBERCAST_VERIFY_MEMOS_REPORT!, 'utf8')).toBe(reportText);
          if (mode === 'judge-fails') return result(1, '', 'judge failed');
          if (mode === 'judge-throws') throw new Error('judge rejected');
          const successful = await f.successfulProcess(call); f.events.push('judge-resolved'); return successful;
        }
        return f.successfulProcess(call);
      }, runner: { removeContainer: async (name: string) => {
        // Regeneration resets once before replay; fault only the final cleanup.
        if (f.events.includes('judge-resolved')) {
          if (mode === 'teardown-fails') throw new Error('cleanup failed');
          if (mode === 'signal-after-publish') f.signals.emit('SIGTERM');
        }
        f.containers.delete(name);
      } } });
      const foreignTemp = join(f.fixture, `${plan}.tmp-foreign`);
      write(foreignTemp, 'another writer owns this file');
      const before = snapshot(f.fixture), actual = await vi.importActual<typeof import('node:fs')>('node:fs');
      const published: string[] = [];
      vi.mocked(fs.renameSync).mockImplementation((source, destination) => {
        const file = publications.find((name) => String(destination) === join(f.fixture, name));
        if (!file) return actual.renameSync(source, destination);
        expect(f.events).toContain('judge-resolved'); expect(f.calls('judge').at(-1)!.opts.env.AMBERCAST_VERIFY_MEMOS_MODE).toBe('full');
        expect(fs.existsSync(join(f.fixture, '.lock'))).toBe(true);
        const runId = f.starts[0]!.runId; expect(String(source)).toBe(`${String(destination)}.tmp-${runId}`);
        expect(fs.readFileSync(source)).toEqual(fs.readFileSync(join(f.calls('replay')[0]!.opts.cwd, file)));
        const tempWrite = vi.mocked(fs.writeFileSync).mock.calls.find((args) => String(args[0]) === String(source));
        expect(tempWrite).toBeDefined(); expect(tempWrite![2]).toEqual(expect.objectContaining({ flag: 'wx' }));
        if (mode === 'second-rename-fails' && file === plan) throw Object.assign(new Error('rename failed'), { code: 'EIO' });
        if (mode.startsWith('signal-during-publish') && file === files[0]) {
          f.signals.emit(mode.endsWith('-term') ? 'SIGTERM' : 'SIGINT');
        }
        expect(f.calls('judge')[0]!.opts.signal.aborted).toBe(false);
        actual.renameSync(source, destination); published.push(file); f.events.push(`published:${file}`);
      });
      const code = await run(f, ['--regenerate']);
      expect(code).toBe(mode === 'pass' ? 0 : mode === 'signal-during-publish' ? 130 : ['signal-during-publish-term', 'signal-after-publish'].includes(mode) ? 143 : 1);
      if (['judge-fails', 'judge-throws', 'disclosure-only'].includes(mode)) {
        expect(published).toEqual([]); expect(snapshot(f.fixture)).toEqual(before);
        expect(f.calls('judge')[0]!.opts.env.AMBERCAST_VERIFY_MEMOS_MODE).toBe(mode === 'disclosure-only' ? 'disclosure-only' : 'full');
      } else {
        const partial = mode === 'second-rename-fails';
        expect(published).toEqual(partial ? [files[0]] : publications);
        expect(fs.readFileSync(join(f.fixture, prompt), 'utf8')).toBe('Sign in and create a memo.\n');
        if (partial) { expect(snapshot(f.fixture)[plan]).toBe(before[plan]); expect(snapshot(f.fixture)[grounding]).toBe(before[grounding]); }
        else {
          expect(fs.readFileSync(join(f.fixture, plan), 'utf8')).toBe(JSON.stringify(navigationPlan(caseTable[0]!, true)));
          expect(JSON.parse(fs.readFileSync(join(f.fixture, grounding), 'utf8'))).toEqual({ generated: caseTable[0]!.id });
        }
        if (mode === 'second-rename-fails') { fail(f, 'fixture', '0'); expect(last(f)).toContain(`published files: 1 of ${1 + plans.length + groundings.length}`); }
        if (mode === 'teardown-fails' || mode.startsWith('signal-')) expect(last(f)).toContain('fixture updated');
        if (mode.startsWith('signal-')) {
          expect(last(f)).toContain(`reason=interrupted; fixture updated: ${1 + plans.length + groundings.length} of ${1 + plans.length + groundings.length}`);
          expect(last(f)).toContain('aiCalls=n/a');
          expect(f.calls('judge')[0]!.opts.signal.aborted).toBe(true);
        }
      }
      expect(fs.existsSync(join(f.fixture, '.lock'))).toBe(false);
      expect(fs.readFileSync(foreignTemp, 'utf8')).toBe('another writer owns this file');
      expect(Object.keys(snapshot(f.fixture)).some((path) => path.endsWith(`.tmp-${f.starts[0]!.runId}`))).toBe(false);
      expect(f.roots()).toEqual([]);
    });
    it('TEST-76 fails and never starts a second container when the mid-reset container removal fails', async () => {
      let removeAttempts = 0;
      const f: Fake = createFakeDeps({ runner: { removeContainer: async (name: string) => {
        removeAttempts++;
        if (removeAttempts === 1) throw new Error('removal failed');
        f.containers.delete(name);
      } } });
      const before = snapshot(f.fixture);
      expect(await run(f, ['--regenerate'])).toBe(1);
      fail(f, 'replay'); expect(last(f)).toContain('removal failed');
      expect(f.starts).toHaveLength(1); expect(f.calls('replay')).toEqual([]); expect(f.calls('judge')).toEqual([]);
      expect(snapshot(f.fixture)).toEqual(before);
      expect(f.runnerCount('removeContainer')).toBeGreaterThanOrEqual(2); expect(f.containers.size).toBe(0); expect(f.roots()).toEqual([]);
    });
    it('TEST-76 fails without reusing a pre-existing data-reset directory', async () => {
      const f: Fake = createFakeDeps({ runProcess: async (call) => {
        if (call.kind === 'resolve') {
          const resetDataDir = join(dirname(call.opts.cwd), 'data-reset');
          fs.mkdirSync(resetDataDir); fs.writeFileSync(join(resetDataDir, 'stale'), 'leftover from an earlier aborted reset');
        }
        return f.successfulProcess(call);
      } });
      const before = snapshot(f.fixture);
      expect(await run(f, ['--regenerate'])).toBe(1);
      fail(f, 'replay'); expect(last(f)).toContain('EEXIST');
      expect(f.starts).toHaveLength(1); expect(f.calls('replay')).toEqual([]); expect(f.calls('judge')).toEqual([]);
      expect(snapshot(f.fixture)).toEqual(before); expect(f.roots()).toEqual([]);
    });
    it.each(['container', 'ready', 'bootstrap'])('TEST-76 fails when the second %s after reset fails', async (stage) => {
      const f: Fake = createFakeDeps({
        runner: {
          startContainer: async (spec: ContainerSpec) => {
            f.containers.add(spec.name);
            if (stage === 'container' && f.starts.length === 2) throw new Error('second container failed');
          },
          isRunning: async (name: string) => (stage === 'ready' && f.starts.length === 2) ? false : f.containers.has(name),
        },
        fetch: async (url: string) => {
          if (stage === 'bootstrap' && url.endsWith('/profile') && f.starts.length === 2) {
            return { status: 200, json: async () => ({ needsSetup: false }) };
          }
          const body = url.endsWith('/profile') ? { needsSetup: true } : url.endsWith('/signin') ? { accessToken: 'token' } : {};
          return { status: 200, ok: true, json: async () => body, text: async () => JSON.stringify(body) };
        },
      });
      const before = snapshot(f.fixture);
      expect(await run(f, ['--regenerate'])).toBe(1);
      fail(f, stage); expect(f.starts).toHaveLength(2);
      expect(f.calls('replay')).toEqual([]); expect(f.calls('judge')).toEqual([]);
      expect(snapshot(f.fixture)).toEqual(before); expect(f.roots()).toEqual([]);
    });
    it.each(['SIGINT', 'SIGTERM'].flatMap((signal) =>
      ['removal-wait', 'before-switch', 'after-switch', 'second-container', 'second-ready', 'second-bootstrap'].map((point) => ({ signal, point }))))
    ('TEST-76 interrupts the reset step at each new checkpoint (table-driven)', async ({ signal, point }) => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
      let emitted = false;
      const f: Fake = createFakeDeps({
        runner: {
          removeContainer: async (name: string) => {
            if (point === 'removal-wait' && f.starts.length === 1 && !emitted) { f.signals.emit(signal); emitted = true; }
            f.containers.delete(name);
          },
          startContainer: async (spec: ContainerSpec) => {
            f.containers.add(spec.name);
            if (point === 'second-container' && f.starts.length === 2 && !emitted) { f.signals.emit(signal); emitted = true; }
          },
          isRunning: async (name: string) => {
            if (point === 'second-ready' && f.starts.length === 2 && !emitted) { f.signals.emit(signal); emitted = true; }
            return f.containers.has(name);
          },
        },
        fetch: async (url: string, opts: RequestInit = {}) => {
          if (point === 'second-bootstrap' && url.endsWith('/profile') && f.starts.length === 2 && !emitted) { f.signals.emit(signal); emitted = true; }
          if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError');
          const body = url.endsWith('/profile') ? { needsSetup: true } : url.endsWith('/signin') ? { accessToken: 'token' } : {};
          return { status: 200, ok: true, json: async () => body, text: async () => JSON.stringify(body) };
        },
        runProcess: async (call) => {
          const outcome = await f.successfulProcess(call);
          if (call.kind === 'resolve' && point === 'before-switch') {
            vi.mocked(fs.mkdirSync).mockImplementationOnce((path, opts) => {
              f.signals.emit(signal); emitted = true;
              return actual.mkdirSync(path, opts);
            });
          }
          if (call.kind === 'resolve' && point === 'after-switch') {
            vi.mocked(fs.rmSync).mockImplementationOnce((path, opts) => {
              f.signals.emit(signal); emitted = true;
              return actual.rmSync(path, opts);
            });
          }
          return outcome;
        },
      });
      const before = snapshot(f.fixture);
      expect(await run(f, ['--regenerate'])).toBe(signal === 'SIGINT' ? 130 : 143);
      expect(emitted).toBe(true);
      const expectedStage = point === 'removal-wait' || point === 'before-switch' || point === 'after-switch' ? 'replay'
        : point === 'second-container' ? 'container' : point === 'second-ready' ? 'ready' : 'bootstrap';
      expect(last(f)).toBe(`verify-memos: FAIL stage=${expectedStage} reason=interrupted aiCalls=n/a`);
      expect(f.starts).toHaveLength(['second-container', 'second-ready', 'second-bootstrap'].includes(point) ? 2 : 1);
      expect(f.calls('replay')).toEqual([]); expect(f.calls('judge')).toEqual([]);
      expect(f.fetchCalls.filter((c) => c.url.endsWith('/auth/signin')).length).toBe(1);
      expect(snapshot(f.fixture)).toEqual(before);
      expect(f.containers.size).toBe(0); expect(f.roots()).toEqual([]);
    });
    it.each(['SIGINT', 'SIGTERM'])('TEST-76 tears down even with --keep when %s arrives during the reset directory switch', async (signal) => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
      const f: Fake = createFakeDeps({ runProcess: async (call) => {
        const outcome = await f.successfulProcess(call);
        if (call.kind === 'resolve') {
          vi.mocked(fs.mkdirSync).mockImplementationOnce((path, opts) => {
            f.signals.emit(signal); return actual.mkdirSync(path, opts);
          });
        }
        return outcome;
      } });
      const before = snapshot(f.fixture);
      expect(await run(f, ['--regenerate', '--keep'])).toBe(signal === 'SIGINT' ? 130 : 143);
      expect(last(f)).toBe('verify-memos: FAIL stage=replay reason=interrupted aiCalls=n/a');
      expect(f.starts).toHaveLength(1); expect(f.containers.size).toBe(0); expect(f.roots()).toEqual([]);
      expect(snapshot(f.fixture)).toEqual(before);
    });
  });
});
