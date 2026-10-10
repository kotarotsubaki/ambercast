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
import { main, parseArgs } from '../../../scripts/verify-memos.mjs';
// @ts-expect-error The production ESM script is deliberately untyped JavaScript.
import { runProcess } from '../../../scripts/lib/memos-harness.mjs';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

// Preserve real files, observing only the public copy/publication boundary.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, renameSync: vi.fn(actual.renameSync), writeFileSync: vi.fn(actual.writeFileSync), mkdirSync: vi.fn(actual.mkdirSync),
    copyFileSync: vi.fn(actual.copyFileSync),
    existsSync: vi.fn(actual.existsSync), readFileSync: vi.fn(actual.readFileSync) };
});
const prompt = 'tests/ambercast/memos-sign-in-create-memo.test.md';
const plan = prompt.replace('.test.md', '.ambercast.plan.json');
const grounding = prompt.replace('.test.md', '.ambercast.grounding.json');
const files = ['ambercast.config.json', prompt, plan, grounding] as const;
const sha = '0123456789abcdef'.repeat(4);
const password = 'ab'.repeat(16);
const report = { runId: 'replay-run', summary: { total: 1, passed: 1 }, results: [{ status: 'passed', aiCalls: 0 }], errors: [] };
const reportText = `  ${JSON.stringify(report)}\n`;
const dirs: string[] = [];
type ProcessOptions = { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; signal: AbortSignal;
  stdio?: string; password?: string; onStderrChunk?: (chunk: string) => void };
type ProcessResult = { status: number | null; stdout: string; stderr: string; signal: string | null };
type ProcessCall = { argv: string[]; opts: ProcessOptions; kind: string };
type ContainerSpec = { runId: string; name: string; data: string; uid: number; gid: number };
type RunnerCall = { method: string; args: unknown[] };
// The untyped entry boundary accepts heterogeneous runner methods; narrow in each fake.
type RunnerMethod = (...args: never[]) => unknown;
type FetchResult = { status: number; ok?: boolean; json: () => Promise<unknown>; text?: () => Promise<string> };
type Overrides = { runner?: Record<string, RunnerMethod>; runProcess?: (call: ProcessCall) => Promise<ProcessResult> | ProcessResult;
  fetch?: (url: string, opts: RequestInit) => Promise<FetchResult>; assertPortFree?: RunnerMethod; readPlaywrightVersion?: RunnerMethod };
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
  write(join(fixture, files[0]), JSON.stringify({ $schema: './node_modules/ambercast/dist/schema/config.schema.json', testDir: 'tests/ambercast',
    targets: { memos: { baseUrl: 'http://127.0.0.1:5230', locale: 'en-US' } }, defaultTarget: 'memos', secrets: { allow: ['memos.password'] } }));
  write(join(fixture, prompt), 'Sign in and create a memo.\n');
  write(join(fixture, plan), '{"seed":"plan"}\n'); write(join(fixture, grounding), '{"seed":"grounding"}\n');
  const stdout: string[] = [], stderr: string[] = [], events: string[] = [];
  const runnerCalls: RunnerCall[] = [], processCalls: ProcessCall[] = [], starts: ContainerSpec[] = [];
  const fetchCalls: { url: string; opts: RequestInit }[] = [], signalCalls: { method: string; name: string; handler: () => void }[] = [];
  const containers = new Set<string>(), handlers = new Map<string, Set<() => void>>();
  const randomBytesSizes: number[] = [];
  let now = 0, sequence = 0;
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
    if (kind === 'check') return result(0, '{"results":[{"status":"fresh"}]}');
    if (kind === 'generate') {
      const path = join(opts.cwd, files[0]), config = JSON.parse(fs.readFileSync(path, 'utf8'));
      config.secrets.allow = ['memos.password']; write(path, JSON.stringify(config));
      write(join(opts.cwd, plan), '{"generated":"plan"}\n'); write(join(opts.cwd, grounding), '{"generated":"grounding"}\n');
      opts.onStderrChunk?.('generated safely\n');
    }
    if (kind === 'resolve' || kind === 'replay') {
      const text = kind === 'resolve' ? JSON.stringify({ ...report, runId: 'resolve-run', results: [{ status: 'passed', aiCalls: 9 }] }) : reportText;
      write(join(opts.cwd, 'tests/ambercast/.runs', JSON.parse(text).runId, 'report.json'), text); return result(0, text);
    }
    return result();
  }
  const deps = {
    runner, tmpRoot, repoRoot, uid: 501, gid: 20,
    stdout: { write(s: string) { stdout.push(String(s)); } }, stderr: { write(s: string) { stderr.push(String(s)); } },
    randomBytes(size: number) { randomBytesSizes.push(size); if (size === 16) { events.push('password-generated'); return Buffer.from(password, 'hex'); } const bytes = Buffer.alloc(size); bytes.writeUInt32BE(++sequence); return bytes; },
    clock: { now: () => now, async sleep(ms: number, signal?: AbortSignal) { signal?.throwIfAborted(); now += ms; } },
    async assertPortFree(...args: unknown[]) { events.push('port'); return overrides.assertPortFree?.(...args as never[]); },
    readPlaywrightVersion(...args: unknown[]) { events.push('version'); return overrides.readPlaywrightVersion ? overrides.readPlaywrightVersion(...args as never[]) : '1.62.1'; },
    resolveChromiumPath: () => '/fake/chromium',
    async fetch(input: string | URL, opts: RequestInit = {}) {
      const url = String(input); fetchCalls.push({ url, opts }); events.push(new URL(url).pathname);
      if (overrides.fetch) return overrides.fetch(url, opts);
      const body = url.endsWith('/profile') ? { needsSetup: true } : url.endsWith('/signin') ? { accessToken: 'token' } : {};
      return { status: 200, ok: true, json: async () => body, text: async () => JSON.stringify(body) };
    },
    async runProcess(command: string, args: string[], opts: ProcessOptions) {
      const kind = args.includes('pack') ? 'pack' : args.includes('install') ? 'install' : args.includes('--input-type=module') ? 'chromium'
        : command.endsWith('/vitest') ? 'judge' : args.includes('generate') ? 'generate' : args.includes('check') ? 'check'
          : args.includes('--resolve') ? 'resolve' : 'replay';
      const call = { argv: [command, ...args], opts, kind }; processCalls.push(call); events.push(kind);
      return overrides.runProcess ? overrides.runProcess(call) : successfulProcess(call);
    },
  };
  return { deps, signals, signalCalls, stdout, stderr, events, runnerCalls, processCalls, starts, fetchCalls, containers,
    tmpRoot, repoRoot, fixture, manifest, successfulProcess,
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
  vi.mocked(fs.existsSync).mockImplementation(actual.existsSync);
  vi.mocked(fs.readFileSync).mockImplementation(actual.readFileSync);
  const realChild = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  vi.mocked(childProcess.spawn).mockImplementation(realChild.spawn);
  vi.clearAllMocks();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('parseArgs', () => {
  // Decision (maintainer, 2026-10-10): omitted manifest/ai are undefined.
  // Missing keys and explicit undefined have identical option behavior; toEqual
  // accepts both representations, so this is not a behavioral GAP.
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
      allowDirty: false, keep: false, regenerate: false, clean: false, ...expected });
  });
  it.each([
    ['--unknown'], ['--keep', '--keep'], ['--allow-dirty', '--allow-dirty'], ['--manifest'], ['--ai'], ['positional'],
    ['--clean', '--keep'], ['--clean', '--manifest', 'p'], ['--clean', '--regenerate'], ['--ai', 'claude'],
    ['--regenerate', '--ai', 'x'], ['--allow-dirty', '--manifest', 'p'], ['--manifest', 'p', '--manifest', 'q'],
    ['--regenerate', '--ai', 'claude', '--ai', 'codex'], ['--regenerate', '--regenerate'], ['--clean', '--clean'],
  ])('TEST-2 rejects every invalid argument combination with exit 2', async (...argv) => {
    const f: Fake = createFakeDeps(); expect(await run(f, argv)).toBe(2);
    expect(f.err()).toMatch(/verify-memos\.mjs \[--manifest <path>\]/); expect(f.out()).toBe('');
    expect(f.runnerCalls).toEqual([]); expect(f.processCalls).toEqual([]); expect(f.roots()).toEqual([]);
  });
  it('TEST-3 rejects on win32 before argument parsing', async () => {
    const f: Fake = createFakeDeps(); expect(await run(f, ['--unknown'], 'win32')).toBe(2);
    expect(f.err()).toContain('verify-memos: Windows is not supported'); expect(f.err()).not.toContain('[--manifest');
    expect(f.out()).toBe(''); expect(f.runnerCalls).toEqual([]); expect(f.processCalls).toEqual([]); expect(f.roots()).toEqual([]);
  });
});

describe('main', () => {
  describe('preflight', () => {
    it('TEST-8 fails closed when the docker daemon is unreachable', async () => {
      const f: Fake = stageFake('preflight'); expect(await run(f)).toBe(1); fail(f, 'preflight');
      expect(f.runnerCount('startContainer')).toBe(0); expect(f.processCalls).toEqual([]); expect(f.roots()).toEqual([]);
    });
    // The revised plan fixes attribution to SPEC-2's table, overriding TEST-9's stage=fixture.
    it.each(files.flatMap((file) => [false, true].map((regenerate) => ({ file, regenerate }))))
    ('TEST-9 fails when fixture files are missing', async ({ file, regenerate }) => {
      const f: Fake = createFakeDeps(); fs.rmSync(join(f.fixture, file));
      const optional = regenerate && (file === plan || file === grounding);
      expect(await run(f, regenerate ? ['--regenerate'] : [])).toBe(optional ? 0 : 1);
      if (optional) return;
      fail(f, 'preflight'); expect(f.starts).toEqual([]); expect(f.calls('pack')).toEqual([]); expect(f.roots()).toEqual([]);
      if (file === prompt || file === files[0]) {
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
      [0, '{"results":[{"status":"fresh"},{"status":"fresh-without-grounding"},{"status":"listed"},{"status":"skipped"}]}', null],
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
      expect(call.argv).toEqual([join(project, 'node_modules/.bin/ambercast'), 'run', '--json', '--no-color', prompt]);
      expect(call.opts.cwd).toBe(project); expect(call.opts.timeoutMs).toBe(120000); expect(call.opts.signal).toBeInstanceOf(AbortSignal);
      for (const key of ['CI', 'GITHUB_ACTIONS', 'AMBERCAST_CONFIG', 'AMBERCAST_AI_PROVIDER', 'AMBERCAST_SECRET_OLD']) expect(call.opts.env).not.toHaveProperty(key);
      expect(call.opts.env.AMBERCAST_SECRET_MEMOS_PASSWORD).toBe(password); expect(call.opts.env.MEMOS_TEST_PRESERVED).toBe('kept');
      expect(process.env.CI).toBe('1'); expect(process.env.AMBERCAST_CONFIG).toBe('parent');
    });
    it.each([4, 3, 1, 'non-json', 'timeout'] as const)('TEST-39 maps a non-zero replay exit to the documented FAIL reason', async (mode) => {
      const text = JSON.stringify({ ...report, results: [{ status: 'passed', aiCalls: 0 }, { status: 'failed', aiCalls: 2 }],
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
      expect(JSON.parse(call.opts.env.AMBERCAST_VERIFY_MEMOS_ARTIFACT_ROOTS!)).toEqual([join(project, 'tests/ambercast/.runs'), join(project, plan), join(project, grounding)]);
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
      // 2026-10-11 revision: generate now runs before any container exists.
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
    it('TEST-70 redacts split secrets from resolve streams while preserving judge evidence', async () => {
      // 2026-10-11 revision: generate no longer carries a password (it runs
      // before one exists), so only resolve's chunk-split redaction is
      // exercised here; generate's stdio wiring is covered by TEST-57/58/74.
      const raw = `before ${password} after`;
      const resolveReport = JSON.stringify({ ...report, runId: 'resolve-run', errors: [{ code: 'STREAM_SECRET', message: raw }],
        results: [{ status: 'passed', aiCalls: 9 }] });
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
    it('TEST-70 adds secret disclosed to a failed replay when disclosure-only judging fails', async () => {
      const leaked = JSON.stringify({ ...report, errors: [{ code: 'SECRET', message: password }] });
      const f: Fake = createFakeDeps({ runProcess: (call) => {
        if (call.kind === 'replay') return result(1, leaked);
        if (call.kind === 'judge') {
          expect(call.opts.env.AMBERCAST_VERIFY_MEMOS_MODE).toBe('disclosure-only');
          expect(fs.readFileSync(call.opts.env.AMBERCAST_VERIFY_MEMOS_REPORT!, 'utf8')).toBe(leaked);
          return result(1, '', 'secret disclosed');
        }
        return f.successfulProcess(call);
      } });
      expect(await run(f)).toBe(1); fail(f, 'replay', '0');
      expect(last(f)).toContain('exit=1'); expect(last(f)).toContain('secret disclosed');
      expect(f.calls('judge')).toHaveLength(1);
    });
    it('TEST-57 runs generate before any password or container, then resolve, a full reset, then a normal replay, in order', async () => {
      vi.stubEnv('CI', '1'); vi.stubEnv('GITHUB_ACTIONS', 'true'); vi.stubEnv('AMBERCAST_AI_PROVIDER', 'claude');
      vi.stubEnv('AMBERCAST_SECRET_OLD', 'stale');
      const f: Fake = createFakeDeps({ runProcess: async (call) => {
        if (call.kind === 'generate') {
          // 2026-10-11 revision: generate runs before any password exists and
          // before the instance is ever started (SPEC-13), so consent's TTY
          // check never collides with piped redaction.
          expect(f.events).not.toContain('startContainer');
          expect(f.events).not.toContain('/api/v1/auth/signin');
          expect(f.passwordGenerated()).toBe(false);
          expect(JSON.parse(fs.readFileSync(join(call.opts.cwd, files[0]), 'utf8')).secrets.allow).toEqual([]);
          expect(fs.existsSync(join(call.opts.cwd, prompt))).toBe(true);
          expect(fs.existsSync(join(call.opts.cwd, plan))).toBe(false); expect(fs.existsSync(join(call.opts.cwd, grounding))).toBe(false);
          expect(call.argv).toEqual([join(call.opts.cwd, 'node_modules/.bin/ambercast'), 'generate', prompt, '--ai', 'codex']);
          expect(call.opts.stdio).toBe('generate'); expect(call.opts.password).toBeUndefined();
          expect(call.opts.onStderrChunk).toBeTypeOf('function');
          expect(Object.keys(call.opts.env ?? {}).some((key) => key.startsWith('AMBERCAST_SECRET_'))).toBe(false);
        }
        if (call.kind === 'resolve') {
          expect(f.passwordGenerated()).toBe(true);
          expect(JSON.parse(fs.readFileSync(join(call.opts.cwd, files[0]), 'utf8')).secrets.allow).toEqual(['memos.password']);
          expect(call.argv).toEqual(expect.arrayContaining(['run', '--resolve', '--update-cache', '--json', prompt, '--ai', 'codex']));
          expect(call.opts.env.AMBERCAST_SECRET_MEMOS_PASSWORD).toBe(password);
          expect(call.opts.stdio).toBe('resolve'); expect(call.opts.password).toBe(password);
          write(join(dirname(call.opts.cwd), 'data/old-instance'), 'must be discarded');
        }
        if (['generate', 'resolve', 'replay'].includes(call.kind)) {
          for (const key of ['CI', 'GITHUB_ACTIONS', 'AMBERCAST_AI_PROVIDER']) expect(call.opts.env).not.toHaveProperty(key);
        }
        if (call.kind === 'replay') {
          expect(fs.readdirSync(join(dirname(call.opts.cwd), 'data'))).toEqual([]);
          expect(call.argv).not.toContain('--resolve'); expect(call.argv).not.toContain('--update-cache');
        }
        if (call.kind === 'generate' || call.kind === 'resolve') {
          const text = call.kind === 'resolve' ? JSON.stringify({ ...report, runId: 'resolve-run', results: [{ status: 'passed', aiCalls: 9 }] }) : '';
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
            write(join(call.opts.cwd, plan), '{"generated":"plan"}\n'); write(join(call.opts.cwd, grounding), '{"generated":"grounding"}\n');
            call.opts.onStderrChunk?.('generated safely\n');
          } else write(join(call.opts.cwd, 'tests/ambercast/.runs/resolve-run/report.json'), text);
          return processed;
        }
        return f.successfulProcess(call);
      } });
      const configPath = join(f.fixture, files[0]), config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      config.secrets.allow = ['old.name']; write(configPath, JSON.stringify(config));
      expect(await run(f, ['--regenerate', '--ai', 'codex'])).toBe(0);
      expect(f.calls('check')).toEqual([]); expect(f.calls('generate')).toHaveLength(1); expect(f.calls('resolve')).toHaveLength(1);
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
      expect(f.err().match(/generated safely/g)).toHaveLength(1);
      expect(f.err() + f.out()).not.toContain(password);
      expect(last(f)).toContain('PASS aiCalls=0');
      const stages = f.out().trimEnd().split('\n').slice(0, -1).map((line) => line.split(' ')[1]);
      expect(stages).toEqual([
        'port', 'pack', 'preflight', 'install', 'chromium', 'fixture', 'fixture',
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
        if (call.kind === 'generate' && stage.includes('consent')) {
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
      // 2026-10-11 revision: generate/consent failures happen before any
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
    it.each(['pass', 'second-rename-fails', 'judge-fails', 'judge-throws', 'disclosure-only', 'teardown-fails', 'signal-during-publish', 'signal-after-publish'])
    ('TEST-59 writes back config, plan, grounding atomically and in order after judge passes', async (mode) => {
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
      const publications: string[] = [];
      vi.mocked(fs.renameSync).mockImplementation((source, destination) => {
        const file = files.find((name) => String(destination) === join(f.fixture, name));
        if (!file) return actual.renameSync(source, destination);
        expect(f.events).toContain('judge-resolved'); expect(f.calls('judge').at(-1)!.opts.env.AMBERCAST_VERIFY_MEMOS_MODE).toBe('full');
        expect(fs.existsSync(join(f.fixture, '.lock'))).toBe(true);
        const runId = f.starts[0]!.runId; expect(String(source)).toBe(`${String(destination)}.tmp-${runId}`);
        expect(fs.readFileSync(source)).toEqual(fs.readFileSync(join(f.calls('replay')[0]!.opts.cwd, file)));
        const tempWrite = vi.mocked(fs.writeFileSync).mock.calls.find((args) => String(args[0]) === String(source));
        expect(tempWrite).toBeDefined(); expect(tempWrite![2]).toEqual(expect.objectContaining({ flag: 'wx' }));
        if (mode === 'second-rename-fails' && file === plan) throw Object.assign(new Error('rename failed'), { code: 'EIO' });
        if (mode === 'signal-during-publish' && file === files[0]) {
          f.signals.emit('SIGINT'); expect(f.calls('judge')[0]!.opts.signal.aborted).toBe(false);
        }
        actual.renameSync(source, destination); publications.push(file); f.events.push(`published:${file}`);
      });
      const code = await run(f, ['--regenerate']);
      expect(code).toBe(mode === 'pass' ? 0 : mode === 'signal-during-publish' ? 130 : mode === 'signal-after-publish' ? 143 : 1);
      if (['judge-fails', 'judge-throws', 'disclosure-only'].includes(mode)) {
        expect(publications).toEqual([]); expect(snapshot(f.fixture)).toEqual(before);
        expect(f.calls('judge')[0]!.opts.env.AMBERCAST_VERIFY_MEMOS_MODE).toBe(mode === 'disclosure-only' ? 'disclosure-only' : 'full');
      } else {
        const partial = mode === 'second-rename-fails' || mode === 'signal-during-publish';
        expect(publications).toEqual(partial ? [files[0]] : [files[0], plan, grounding]);
        expect(fs.readFileSync(join(f.fixture, prompt), 'utf8')).toBe('Sign in and create a memo.\n');
        if (partial) { expect(snapshot(f.fixture)[plan]).toBe(before[plan]); expect(snapshot(f.fixture)[grounding]).toBe(before[grounding]); }
        else {
          expect(fs.readFileSync(join(f.fixture, plan), 'utf8')).toBe('{"generated":"plan"}\n');
          expect(fs.readFileSync(join(f.fixture, grounding), 'utf8')).toBe('{"generated":"grounding"}\n');
        }
        if (mode === 'second-rename-fails') { fail(f, 'fixture', '0'); expect(last(f)).toContain('ambercast.config.json'); }
        if (mode === 'teardown-fails' || mode.startsWith('signal-')) expect(last(f)).toContain('fixture updated');
        if (mode.startsWith('signal-')) expect(last(f)).toContain('reason=interrupted');
      }
      expect(fs.existsSync(join(f.fixture, '.lock'))).toBe(false);
      expect(fs.readFileSync(foreignTemp, 'utf8')).toBe('another writer owns this file');
      expect(Object.keys(snapshot(f.fixture)).some((path) => path.endsWith(`.tmp-${f.starts[0]!.runId}`))).toBe(false);
      expect(f.roots()).toEqual([]);
    });
  });
});
