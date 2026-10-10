import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error The production ESM script is deliberately untyped JavaScript.
import { assertPortFree, bootstrapAdmin, BootstrapError, buildChildEnv, buildProjectPackageJson, createDockerRunner, createExec, createRunRoot, createTeardown, defaultIsPidAlive, generateAdminPassword, HarnessError, reapStale, ReadyError, RunnerError, runProcess, secretEnvName, summarizeAiCalls, waitReady } from '../../../scripts/lib/memos-harness.mjs';

const roots: string[] = [];
const prefix = 'ambercast-verify-memos-';
const name = prefix + '12345678';
const baseUrl = 'http://127.0.0.1:5230';
function temporaryRoot() {
  const dir = fs.mkdtempSync(join(tmpdir(), 'memos-harness-test-'));
  roots.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
function fakeClock(onSleep?: () => void) {
  let elapsed = 0;
  return {
    now: () => elapsed,
    advance: (ms: number) => { elapsed += ms; },
    sleep: vi.fn(async (ms: number, signal?: AbortSignal) => {
      signal?.throwIfAborted();
      elapsed += ms;
      onSleep?.();
      signal?.throwIfAborted();
    }),
  };
}
function readyOptions(fetch = vi.fn(async () => ({ status: 503 })), clock = fakeClock()) {
  const logs = Array.from({ length: 40 }, (_, i) => `log-${i}`).join('\n');
  return { fetch, clock, name, timeoutMs: 30_000, intervalMs: 200,
    runner: { isRunning: vi.fn<(name: string, options: { signal: AbortSignal; timeoutMs: number }) => Promise<boolean>>(async () => true), tailLogs: vi.fn(async () => logs) }, logs };
}
function response(status: number, body: unknown = {}) {
  return { status, json: vi.fn(async () => body) };
}
function bootstrapFetch(statuses = [200, 200, 200], token: unknown = 't') {
  return vi.fn().mockResolvedValueOnce(response(statuses[0]!, { needsSetup: true }))
    .mockResolvedValueOnce(response(statuses[1]!)).mockResolvedValueOnce(response(statuses[2]!, { accessToken: token }));
}

describe('createDockerRunner', () => {
  it('TEST-68 delegates Docker command, argv and options through createExec to runProcess', async () => {
    const runProcessImpl = vi.fn(async () => ({ status: 0, stdout: '', stderr: '', signal: null }));
    const signal = new AbortController().signal;
    await createDockerRunner(createExec(runProcessImpl)).checkDaemon({ signal, timeoutMs: 1234 });
    expect(runProcessImpl).toHaveBeenCalledWith('docker', ['info'], expect.objectContaining({ signal, timeoutMs: 1234 }));
  });
  it('TEST-18 builds the exact docker run argv', async () => {
    const exec = vi.fn(async (..._args: unknown[]) => ({ status: 0, stdout: 'id\n', stderr: '' }));
    await createDockerRunner(exec).startContainer({ runId: '12345678', name, data: '/data', uid: 501, gid: 20 });
    expect(exec.mock.calls).toHaveLength(1);
    expect(exec.mock.calls[0]![0]).toEqual(['run', '-d', '--pull', 'never', '--name', name,
      '--label', 'ambercast-verify=memos', '--label', 'ambercast-verify-run=12345678',
      '-p', '127.0.0.1:5230:5230', '-v', '/data:/var/opt/memos', '-e', 'MEMOS_UID=501',
      '-e', 'MEMOS_GID=20', '-e', 'MEMOS_RATE_LIMIT=false', 'neosmemo/memos:0.31.0']);
  });
  it.each([
    { method: 'checkDaemon', args: [], argv: ['info'], stdout: '', expected: undefined },
    { method: 'hasImage', args: ['image'], argv: ['image', 'inspect', 'image'], stdout: '', expected: true },
    { method: 'pullImage', args: ['image'], argv: ['pull', 'image'], stdout: '', expected: undefined },
    { method: 'isRunning', args: [name], argv: ['inspect', '-f', '{{.State.Running}}', name], stdout: 'true\n', expected: true },
    { method: 'inspectEnv', args: [name], argv: ['inspect', '-f', '{{.Config.Env}}', name], stdout: '[A=1 MEMOS_RATE_LIMIT=false]\n', expected: ['A=1', 'MEMOS_RATE_LIMIT=false'] },
    { method: 'tailLogs', args: [name, 40], argv: ['logs', '--tail', '40', name], stdout: 'out\n', expected: 'out\nerr\n' },
    { method: 'removeContainer', args: [name], argv: ['rm', '-f', name], stdout: '', expected: undefined },
    { method: 'listContainers', args: [], argv: ['ps', '-a', '--filter', 'label=ambercast-verify=memos', '--format', '{{.Names}}'], stdout: `${name}\nother\n`, expected: [name, 'other'] },
  ])('TEST-19 maps $method to its docker argv and result', async ({ method, args, argv, stdout, expected }) => {
    const exec = vi.fn(async (..._args: unknown[]) => ({ status: 0, stdout, stderr: method === 'tailLogs' ? 'err\n' : '' }));
    expect(await createDockerRunner(exec)[method](...args)).toEqual(expected);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec.mock.calls[0]![0]).toEqual(argv);
  });
  it.each([
    { method: 'hasImage', args: ['image'], status: 1, stdout: '', expected: false },
    { method: 'isRunning', args: [name], status: 0, stdout: 'false\n', expected: false },
    { method: 'isRunning', args: [name], status: 1, stdout: '', expected: false },
    { method: 'removeContainer', args: [name], status: 1, stdout: '', expected: undefined },
  ])('TEST-19 tolerates absence for $method ($stdout)', async ({ method, args, status, stdout, expected }) => {
    expect(await createDockerRunner(async () => ({ status, stdout, stderr: 'No such container: missing' }))[method](...args)).toEqual(expected);
  });
  it.each([
    { method: 'checkDaemon', args: [] }, { method: 'pullImage', args: ['image'] },
    { method: 'inspectEnv', args: [name] }, { method: 'tailLogs', args: [name, 40] },
    { method: 'removeContainer', args: [name] }, { method: 'listContainers', args: [] },
    { method: 'startContainer', args: [{ runId: '12345678', name, data: '/data', uid: 1, gid: 1 }] },
  ])('TEST-19 reports unsuccessful $method', async ({ method, args }) => {
    const runner = createDockerRunner(async () => ({ status: 1, stdout: '', stderr: 'denied\nsecond line' }));
    const error = await runner[method](...args).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(RunnerError);
    expect(error.message).toBe(`${method}: denied`);
  });
});

describe('assertPortFree', () => {
  it('TEST-15 rejects an occupied port and releases a free one', async () => {
    const host = '127.0.0.1';
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, host, resolve); });
    const port = (server.address() as net.AddressInfo).port;
    try {
      await expect(assertPortFree(port, host)).rejects.toMatchObject({ name: 'HarnessError', stage: 'port',
        message: expect.stringContaining(`port ${port} on ${host} is in use`) });
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
    await assertPortFree(port, host);
    const probe = net.createServer();
    try {
      await new Promise<void>((resolve, reject) => { probe.once('error', reject); probe.listen(port, host, resolve); });
    } finally {
      if (probe.listening) await new Promise<void>(resolve => probe.close(() => resolve()));
    }
  });
  it('TEST-15 propagates other listen errors unchanged', async () => {
    const error = Object.assign(new Error('denied'), { code: 'EACCES' });
    await expect(assertPortFree(0, '127.0.0.1', async () => { throw error; })).rejects.toBe(error);
  });
});

describe('createRunRoot', () => {
  it('TEST-20 creates an isolated run root atomically, with bounded collision retry', () => {
    const tmpRoot = temporaryRoot();
    const random = vi.fn().mockReturnValueOnce(Buffer.from('12345678', 'hex')).mockReturnValueOnce(Buffer.from('abcdef01', 'hex'));
    const renameSync = vi.fn((source: string, destination: string) => {
      expect(fs.existsSync(destination)).toBe(false);
      expect(fs.readFileSync(join(source, 'owner.pid'), 'utf8')).toBe(String(process.pid));
      expect(fs.readdirSync(join(source, 'data'))).toEqual([]);
      expect(fs.readdirSync(join(source, 'project'))).toEqual([]);
      fs.renameSync(source, destination);
    });
    const first = createRunRoot(tmpRoot, random, { ...fs, renameSync });
    const second = createRunRoot(tmpRoot, random, { ...fs, renameSync });
    expect([first.runId, second.runId]).toEqual(['12345678', 'abcdef01']);
    for (const result of [first, second]) {
      expect(result).toEqual({ runId: result.runId, runRoot: join(tmpRoot, prefix + result.runId),
        dataDir: join(tmpRoot, prefix + result.runId, 'data'), projectDir: join(tmpRoot, prefix + result.runId, 'project'), containerName: prefix + result.runId });
      expect(fs.statSync(result.runRoot).mode & 0o777).toBe(0o700);
      expect(fs.existsSync(result.runRoot + '.tmp')).toBe(false);
    }
    expect(renameSync).toHaveBeenCalledTimes(2);
    expect(random.mock.calls).toEqual([[4], [4]]);
  });
  it.each(['', '.tmp'])('TEST-20 preserves existing %s names and retries collisions', suffix => {
    const tmpRoot = temporaryRoot();
    const existing = join(tmpRoot, name + suffix);
    fs.mkdirSync(existing);
    fs.writeFileSync(join(existing, 'marker'), 'preserve');
    const random = vi.fn().mockReturnValueOnce(Buffer.from('12345678', 'hex')).mockReturnValueOnce(Buffer.from('12345678', 'hex'))
      .mockReturnValueOnce(Buffer.from('abcdef01', 'hex'));
    expect(createRunRoot(tmpRoot, random).runId).toBe('abcdef01');
    expect(random).toHaveBeenCalledTimes(3);
    expect(fs.readFileSync(join(existing, 'marker'), 'utf8')).toBe('preserve');
  });
  it('TEST-20 fails at preflight after six collisions', () => {
    const tmpRoot = temporaryRoot();
    fs.mkdirSync(join(tmpRoot, name));
    const random = vi.fn(() => Buffer.from('12345678', 'hex'));
    let error: unknown;
    try { createRunRoot(tmpRoot, random); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(HarnessError);
    expect(error).toMatchObject({ stage: 'preflight' });
    expect(random).toHaveBeenCalledTimes(6);
  });
  it('TEST-20 rechecks the destination immediately before rename', () => {
    const tmpRoot = temporaryRoot();
    const destination = join(tmpRoot, name);
    const random = vi.fn().mockReturnValueOnce(Buffer.from('12345678', 'hex')).mockReturnValueOnce(Buffer.from('abcdef01', 'hex'));
    const writeFileSync = (path: string, value: string) => {
      fs.writeFileSync(path, value);
      if (path.startsWith(destination + '.tmp/')) fs.mkdirSync(destination);
    };
    const renameSync = vi.fn(fs.renameSync);
    expect(createRunRoot(tmpRoot, random, { ...fs, writeFileSync, renameSync }).runId).toBe('abcdef01');
    expect(fs.existsSync(destination)).toBe(true);
    expect(fs.existsSync(destination + '.tmp')).toBe(false);
    expect(renameSync).toHaveBeenCalledTimes(1);
    expect(renameSync.mock.calls[0]![1]).toBe(join(tmpRoot, prefix + 'abcdef01'));
  });
  it('TEST-20 cleans its own tmp on partial failure without touching unrelated directories', () => {
    const tmpRoot = temporaryRoot();
    fs.mkdirSync(join(tmpRoot, 'unrelated'));
    const error = new Error('write failed');
    expect(() => createRunRoot(tmpRoot, () => Buffer.from('12345678', 'hex'), {
      ...fs, writeFileSync: () => { throw error; },
    })).toThrow(error);
    expect(fs.readdirSync(tmpRoot)).toEqual(['unrelated']);
  });
});

describe('waitReady', () => {
  it('TEST-22 resolves once healthz returns 200, polling on the fake clock', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ status: 503 }).mockResolvedValueOnce({ status: 503 }).mockResolvedValueOnce({ status: 200 });
    const opts = readyOptions(fetch);
    expect(await waitReady(opts)).toBe(400);
    expect(opts.clock.sleep.mock.calls.map(call => call[0])).toEqual([200, 200]);
    expect(fetch).toHaveBeenCalledTimes(3);
    for (const [url, init] of fetch.mock.calls) {
      expect(url).toBe(baseUrl + '/healthz');
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });
  it('TEST-22 accepts a 200 exactly at 30000ms', async () => {
    const clock = fakeClock();
    const fetch = vi.fn(async () => ({ status: clock.now() === 30_000 ? 200 : 503 }));
    expect(await waitReady(readyOptions(fetch, clock))).toBe(30_000);
    expect(clock.sleep).toHaveBeenCalledTimes(150);
  });
  it('TEST-22 bounds slow running checks by the remaining deadline', async () => {
    const opts = readyOptions();
    opts.runner.isRunning = vi.fn(async (_name: string, options: { signal: AbortSignal; timeoutMs: number }) => {
      expect(options.timeoutMs).toBe(Math.min(30_000 - opts.clock.now(), 5000));
      opts.clock.advance(Math.min(4000, options.timeoutMs));
      return true;
    });
    await expect(waitReady(opts)).rejects.toBeInstanceOf(ReadyError);
    expect(opts.clock.now()).toBe(30_000);
  });
  it.each(['503', 'network'])('TEST-23 fails after the deadline with container logs (%s)', async mode => {
    const opts = readyOptions(vi.fn(async () => {
      if (mode === 'network') throw new TypeError('disconnected');
      return { status: 503 };
    }));
    const error = await waitReady(opts).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(ReadyError);
    expect(error.stage).toBe('ready');
    expect(error.message).toContain('not ready after 30000ms');
    expect(error.message).toContain(opts.logs);
    expect(opts.clock.now()).toBe(30_000);
    expect(opts.runner.tailLogs.mock.calls[0]!.slice(0, 2)).toEqual([name, 40]);
  });
  it('TEST-23 rejects a late 200 response', async () => {
    const clock = fakeClock();
    await expect(waitReady(readyOptions(vi.fn(async () => { clock.advance(30_001); return { status: 200 }; }), clock)))
      .rejects.toBeInstanceOf(ReadyError);
  });
  it('TEST-24 fails fast when the container stops running', async () => {
    const opts = readyOptions();
    opts.runner.isRunning.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const error = await waitReady(opts).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(ReadyError);
    expect(error.message).toContain('container exited');
    expect(error.message).toContain(opts.logs);
    expect(opts.clock.now()).toBe(200);
    expect(opts.fetch).toHaveBeenCalledTimes(1);
  });
  it('TEST-25 aborts within one iteration', async () => {
    const controller = new AbortController();
    const clock = fakeClock(() => controller.abort());
    const opts = { ...readyOptions(undefined, clock), signal: controller.signal };
    await expect(waitReady(opts)).rejects.toMatchObject({ name: 'AbortError' });
    expect(clock.now()).toBeLessThanOrEqual(200);
    expect(opts.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('bootstrapAdmin', () => {
  const password = 'private-test-password';
  it('TEST-26 calls profile, users, signin in order with the right bodies', async () => {
    const fetch = bootstrapFetch();
    await bootstrapAdmin({ fetch, password });
    expect(fetch.mock.calls.map(call => call[0])).toEqual([
      baseUrl + '/api/v1/instance/profile', baseUrl + '/api/v1/users', baseUrl + '/api/v1/auth/signin']);
    expect(fetch.mock.calls.map(call => call[1]?.method ?? 'GET')).toEqual(['GET', 'POST', 'POST']);
    expect(JSON.parse(fetch.mock.calls[1]![1].body)).toEqual({ username: 'verifier', role: 'ADMIN', password });
    expect(JSON.parse(fetch.mock.calls[2]![1].body)).toEqual({ passwordCredentials: { username: 'verifier', password } });
    for (const [, init] of fetch.mock.calls) {
      expect(new Headers(init?.headers).has('authorization')).toBe(false);
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });
  it('TEST-27 fails when the instance is not fresh', async () => {
    const fetch = vi.fn(async () => response(200, { needsSetup: false }));
    await expect(bootstrapAdmin({ fetch, password })).rejects.toMatchObject({ name: 'BootstrapError', message: 'instance is not fresh' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([409, 500])('TEST-28 fails without retry when users returns %i', async status => {
    const fetch = vi.fn().mockResolvedValueOnce(response(200, { needsSetup: true }))
      .mockResolvedValueOnce(response(status, { privateBody: password }));
    const error = await bootstrapAdmin({ fetch, password }).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(BootstrapError);
    expect(error.message).toBe(`POST /api/v1/users -> ${status}`);
    expect(error.message).not.toContain(password);
    expect(error.message).not.toContain('privateBody');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each([{}, { accessToken: '' }])('TEST-29 fails when signin has no accessToken (%j)', async body => {
    const fetch = vi.fn().mockResolvedValueOnce(response(200, { needsSetup: true }))
      .mockResolvedValueOnce(response(200)).mockResolvedValueOnce(response(200, body));
    await expect(bootstrapAdmin({ fetch, password })).rejects.toBeInstanceOf(BootstrapError);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it.each([200, 201, 202, 409, 500].flatMap(users => [200, 201, 500].flatMap(profile =>
    [200, 201, 500].map(signin => ({ profile, users, signin })),
  )))('TEST-69 enumerates profile=$profile users=$users signin=$signin', async ({ profile, users, signin }) => {
    const fetch = bootstrapFetch([profile, users, signin]);
    if (profile === 200 && [200, 201].includes(users) && signin === 200) {
      await bootstrapAdmin({ fetch, password });
      expect(fetch).toHaveBeenCalledTimes(3);
    } else {
      await expect(bootstrapAdmin({ fetch, password })).rejects.toBeInstanceOf(BootstrapError);
      expect(fetch).toHaveBeenCalledTimes(profile !== 200 ? 1 : ![200, 201].includes(users) ? 2 : 3);
    }
  });
  it.each([0, 1, 2].flatMap(endpoint => ['json', 'network', 'timeout'].map(failure => ({ endpoint, failure }))))(
    'TEST-69 endpoint=$endpoint failure=$failure is never retried', async ({ endpoint, failure }) => {
      const paths = ['/api/v1/instance/profile', '/api/v1/users', '/api/v1/auth/signin'];
      let index = 0;
      const fetch = vi.fn(async (_url, init) => {
        const current = index++;
        if (current !== endpoint) return response(200, current === 0 ? { needsSetup: true } : {});
        if (failure === 'network') throw new TypeError('private-body');
        if (failure === 'json') return { status: 200, json: async () => { throw new SyntaxError('private-body'); } };
        return new Promise((_, reject) => {
          init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
        });
      });
      const start = Date.now();
      const error = await bootstrapAdmin({ fetch, password }).catch((error: unknown) => error);
      expect(error).toBeInstanceOf(BootstrapError);
      expect(error.message).toBe(`${endpoint === 0 ? 'GET' : 'POST'} ${paths[endpoint]} -> network-error`);
      expect(error.message).not.toContain(password);
      expect(error.message).not.toContain('private-body');
      expect(fetch).toHaveBeenCalledTimes(endpoint + 1);
      if (failure === 'timeout') expect(Date.now() - start).toBeGreaterThanOrEqual(5000);
    }, 10_000,
  );
});

describe('generateAdminPassword', () => {
  it('TEST-30 generates a 32-char lowercase hex password from an injected random source', () => {
    const random = vi.fn().mockReturnValueOnce(Buffer.alloc(16, 0xab)).mockReturnValueOnce(Buffer.alloc(16, 0xcd));
    const first = generateAdminPassword(random);
    const second = generateAdminPassword(random);
    expect(first).toBe('ab'.repeat(16));
    expect(second).toBe('cd'.repeat(16));
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(second).not.toBe(first);
    expect(random.mock.calls).toEqual([[16], [16]]);
  });
});

describe('secretEnvName', () => {
  it.each([['memos.password', 'AMBERCAST_SECRET_MEMOS_PASSWORD'], ['api.key', 'AMBERCAST_SECRET_API_KEY']])(
    'TEST-36 maps %s to its secret env name', (logical, env) => { expect(secretEnvName(logical)).toBe(env); },
  );
});

describe('buildProjectPackageJson', () => {
  it('TEST-32 builds the isolated project package.json pinned to the given playwright-core version', () => {
    expect(buildProjectPackageJson('1.62.1')).toEqual({ name: 'memos-verify-project', private: true, type: 'module',
      overrides: { 'playwright-core': '1.62.1' } });
  });
});

describe('summarizeAiCalls', () => {
  it.each([
    { results: [{ aiCalls: 0 }], expected: 0 }, { results: [{ aiCalls: 2 }], expected: 2 },
    { results: [{ aiCalls: 0 }, {}], expected: 'unknown' }, { results: [], expected: 'unknown' },
  ])('TEST-6 sums $results as $expected', ({ results, expected }) => { expect(summarizeAiCalls({ results })).toBe(expected); });
});

describe('createTeardown', () => {
  it('TEST-46 runs deferred cleanups LIFO, aggregates failures, and is a no-op on a second run', async () => {
    const teardown = createTeardown();
    const order: string[] = [];
    teardown.defer('first', () => { order.push('first'); });
    teardown.defer('middle', () => { order.push('middle'); throw new Error('cleanup failed'); });
    teardown.defer('last', async () => { order.push('last'); });
    const error = await teardown.runAll();
    expect(order).toEqual(['last', 'middle', 'first']);
    expect(error).toBeInstanceOf(HarnessError);
    expect(error.message).toContain('middle');
    expect(error.message).toContain('cleanup failed');
    expect(await teardown.runAll()).toBeNull();
    expect(order).toEqual(['last', 'middle', 'first']);
  });
});

describe('reapStale', () => {
  it.each(['dead', 'missing'] as const)('TEST-54 removes %s dir-only published roots', async owner => {
    const tmpRoot = temporaryRoot();
    const dir = join(tmpRoot, name);
    fs.mkdirSync(dir);
    if (owner === 'dead') fs.writeFileSync(join(dir, 'owner.pid'), '101');
    const removeContainer = vi.fn();
    expect(await reapStale({ tmpRoot, runner: { listContainers: async () => [], removeContainer }, isPidAlive: () => 'dead' }))
      .toEqual({ containers: 0, dirs: 1 });
    expect(fs.existsSync(dir)).toBe(false);
    expect(removeContainer).not.toHaveBeenCalled();
  });
  it('TEST-54 keeps a 599-second unpaired container and removes a 601-second one', async () => {
    const tmpRoot = temporaryRoot();
    const now = Date.now();
    const young = prefix + '11111111';
    const old = prefix + '22222222';
    const removed: string[] = [];
    const runner = {
      listContainers: async () => [young, old],
      inspectCreated: async (container: string) => new Date(now - (container === young ? 599_000 : 601_000)).toISOString(),
      removeContainer: vi.fn(async (container: string) => { removed.push(container); }),
    };
    expect(await reapStale({ tmpRoot, runner, now: () => now })).toEqual({ containers: 1, dirs: 0 });
    expect(removed).toEqual([old]);
  });
  it('TEST-54 treats unexpected PID probe errors as unknown and preserves the resource', async () => {
    const tmpRoot = temporaryRoot();
    const dir = join(tmpRoot, name);
    fs.mkdirSync(dir);
    fs.writeFileSync(join(dir, 'owner.pid'), '101');
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('probe failure'), { code: 'EIO' }); });
    try {
      expect(defaultIsPidAlive(101)).toBe('unknown');
      expect(await reapStale({ tmpRoot, runner: { listContainers: async () => [], removeContainer: vi.fn() } }))
        .toEqual({ containers: 0, dirs: 0 });
      expect(fs.existsSync(dir)).toBe(true);
      expect(stderr).toHaveBeenCalledWith(expect.stringContaining('skip'));
    } finally { kill.mockRestore(); stderr.mockRestore(); }
  });
  it('TEST-54 preserves a resource whose PID probe returns EPERM', async () => {
    const tmpRoot = temporaryRoot();
    const dir = join(tmpRoot, name);
    fs.mkdirSync(dir);
    fs.writeFileSync(join(dir, 'owner.pid'), '101');
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('permission denied'), { code: 'EPERM' }); });
    try {
      expect(defaultIsPidAlive(101)).toBe('live');
      await reapStale({ tmpRoot, runner: { listContainers: async () => [], removeContainer: vi.fn() } });
      expect(fs.existsSync(dir)).toBe(true);
      expect(stderr).toHaveBeenCalledWith(expect.stringContaining('skip'));
    } finally { kill.mockRestore(); stderr.mockRestore(); }
  });
  it('TEST-54 reaps only a dead lock and rereads it before deletion', async () => {
    const tmpRoot = temporaryRoot();
    const lock = join(tmpRoot, '.lock');
    fs.writeFileSync(lock, '101');
    const runner = { listContainers: async () => [], removeContainer: vi.fn() };
    const rm = vi.fn((path: string, opts?: unknown) => fs.rmSync(path, opts as never));
    fs.writeFileSync(lock, '102');
    await reapStale({ tmpRoot, lockPath: lock, runner, isPidAlive: () => 'live', rm });
    expect(fs.readFileSync(lock, 'utf8')).toBe('102');
    fs.writeFileSync(lock, '101');
    await reapStale({ tmpRoot, lockPath: lock, runner, isPidAlive: (pid: number) => pid === 101 ? 'dead' : 'live', rm });
    expect(fs.existsSync(lock)).toBe(false);
    fs.writeFileSync(lock, '101');
    const reread = vi.fn((pid: number) => {
      if (pid === 101) fs.writeFileSync(lock, '102');
      return pid === 101 ? 'dead' : 'live';
    });
    await reapStale({ tmpRoot, lockPath: lock, runner, isPidAlive: reread, rm });
    expect(fs.readFileSync(lock, 'utf8')).toBe('102');
  });
  it('TEST-54 does not count a directory that disappears with ENOENT during deletion', async () => {
    const tmpRoot = temporaryRoot();
    const dir = join(tmpRoot, name);
    fs.mkdirSync(dir);
    fs.writeFileSync(join(dir, 'owner.pid'), '101');
    const rm = vi.fn((path: string, opts?: unknown) => {
      fs.rmSync(path, opts as never);
      throw Object.assign(new Error('already removed'), { code: 'ENOENT' });
    });
    expect(await reapStale({ tmpRoot, runner: { listContainers: async () => [], removeContainer: vi.fn() }, isPidAlive: () => 'dead', rm }))
      .toEqual({ containers: 0, dirs: 0 });
  });
  it('TEST-54 reaps only dead-owner or missing-owner stale resources', async () => {
    const tmpRoot = temporaryRoot();
    const make = (id: string, owner?: string) => {
      const dir = join(tmpRoot, prefix + id);
      fs.mkdirSync(dir);
      if (owner !== undefined) fs.writeFileSync(join(dir, 'owner.pid'), owner);
      return dir;
    };
    const dead = make('11111111', '101');
    const missing = join(tmpRoot, prefix + '22222222');
    const live = make('33333333', '102');
    const unknown = make('44444444', '103');
    const malformed = ['0', '-1', 'abc', '12345678901', ''].map((owner, i) => make(`5555555${i}`, owner));
    const oldTmp = make('66666666.tmp');
    const youngTmp = make('77777777.tmp');
    const unrelated = join(tmpRoot, 'unrelated');
    fs.mkdirSync(unrelated);
    const now = Date.now();
    fs.utimesSync(oldTmp, new Date(now - 61_000), new Date(now - 61_000));
    fs.utimesSync(youngTmp, new Date(now - 10_000), new Date(now - 10_000));
    const removed: string[] = [];
    const exec = vi.fn(async (argv: string[]) => {
      if (argv[0] === 'ps') return { status: 0, stdout: [prefix + '11111111', prefix + '22222222', prefix + '33333333', 'unrelated-container'].join('\n') + '\n', stderr: '' };
      if (argv[0] === 'inspect' && argv.includes('{{.Created}}')) {
        return { status: 0, stdout: new Date(now - 601_000).toISOString() + '\n', stderr: '' };
      }
      if (argv[0] === 'rm') {
        const container = argv.at(-1)!;
        if (container === prefix + '11111111') expect(fs.existsSync(dead)).toBe(true);
        removed.push(container);
        return { status: 0, stdout: '', stderr: '' };
      }
      throw new Error(`Unexpected Docker argv: ${JSON.stringify(argv)}`);
    });
    const runner = createDockerRunner(exec);
    expect(await reapStale({ runner, tmpRoot, isPidAlive: (pid: number) => pid === 101 ? 'dead' : pid === 102 ? 'live' : 'unknown' }))
      .toEqual({ containers: 2, dirs: 2 });
    expect(removed.sort()).toEqual([prefix + '11111111', prefix + '22222222']);
    for (const dir of [dead, missing, oldTmp]) expect(fs.existsSync(dir)).toBe(false);
    for (const dir of [live, unknown, youngTmp, unrelated, ...malformed]) expect(fs.existsSync(dir)).toBe(true);
  });
  it('TEST-66 reaps a tmp dir left behind by a crash before rename', async () => {
    const tmpRoot = temporaryRoot();
    const temporary = join(tmpRoot, name + '.tmp');
    const crash = new Error('simulated process loss');
    expect(() => createRunRoot(tmpRoot, () => Buffer.from('12345678', 'hex'), {
      ...fs, renameSync: () => {
        expect(fs.existsSync(temporary)).toBe(true);
        expect(fs.existsSync(join(tmpRoot, name))).toBe(false);
        throw crash;
      },
      // A crashed owner cannot execute its catch/finally cleanup.
      rmSync: () => {},
    })).toThrow(crash);
    const old = new Date(Date.now() - 61_000);
    fs.utimesSync(temporary, old, old);
    expect(await reapStale({ tmpRoot, runner: { listContainers: async () => [], removeContainer: vi.fn() }, isPidAlive: () => 'dead' }))
      .toEqual({ containers: 0, dirs: 1 });
    expect(fs.existsSync(temporary)).toBe(false);
  });
});

describe.skipIf(process.platform === 'win32')('runProcess', () => {
  it('TEST-64 applies the same group termination contract on timeout', async () => {
    const pidFile = join(temporaryRoot(), 'timeout-pid');
    let pid: number | undefined;
    const realKill = process.kill.bind(process);
    const signals: NodeJS.Signals[] = [];
    const kill = vi.spyOn(process, 'kill').mockImplementation((target, signal) => {
      if (target < 0 && (signal === 'SIGTERM' || signal === 'SIGKILL')) signals.push(signal);
      return realKill(target, signal);
    });
    try {
      const started = Date.now();
      const result = await runProcess('sh', ['-c', 'trap "" TERM; echo $$ > "$1"; sleep 30 & wait', 'memos-test', pidFile], { timeoutMs: 100 });
      pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
      expect(result.signal).toBe('SIGKILL');
      expect(Date.now() - started).toBeLessThan(12_000);
      expect(signals).toEqual(['SIGTERM', 'SIGKILL']);
      expect(() => process.kill(-pid!, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }));
    } finally {
      kill.mockRestore();
      if (!pid && fs.existsSync(pidFile)) pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
      if (pid) try { realKill(-pid, 'SIGKILL'); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
    }
  }, 12_000);
  it('TEST-64 warns and resolves when SIGKILL cannot confirm ESRCH within the bound', async () => {
    const pidFile = join(temporaryRoot(), 'unconfirmed-pid');
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const realKill = process.kill.bind(process);
    const signals: NodeJS.Signals[] = [];
    const kill = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (signal === 0 && pid < 0) return true;
      if (pid < 0 && (signal === 'SIGTERM' || signal === 'SIGKILL')) signals.push(signal);
      return realKill(pid, signal);
    });
    let pid: number | undefined;
    try {
      const started = Date.now();
      const result = await runProcess('sh', ['-c', 'trap "" TERM; echo $$ > "$1"; sleep 30 & wait', 'memos-test', pidFile], { timeoutMs: 100 });
      pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
      expect(result.signal).toBe('SIGKILL');
      expect(Date.now() - started).toBeLessThan(12_000);
      expect(signals).toEqual(['SIGTERM', 'SIGKILL']);
      const warnings = stderr.mock.calls.flatMap(([chunk]) => String(chunk).split('\n')).filter(line => /warn/i.test(line));
      expect(warnings).toHaveLength(1);
    } finally {
      kill.mockRestore(); stderr.mockRestore();
      if (!pid && fs.existsSync(pidFile)) pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
      if (pid) try { realKill(-pid, 'SIGKILL'); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
    }
  }, 13_000);
  it.each([false, true])('TEST-64 kills a whole process group on abort (ignore TERM=%s)', async ignoreTerm => {
    const pidFile = join(temporaryRoot(), 'pid');
    const controller = new AbortController();
    const script = ignoreTerm ? 'trap "" TERM; echo $$ > "$1"; sleep 30 & wait' : 'echo $$ > "$1"; sleep 30 & sleep 30';
    let pid: number | undefined;
    let rejected = false;
    let launchError: unknown;
    const observed = runProcess('sh', ['-c', script, 'memos-test', pidFile], { signal: controller.signal })
      .catch((error: unknown) => { rejected = true; launchError = error; return undefined; });
    try {
      const deadline = Date.now() + 2000;
      while (!fs.existsSync(pidFile) && !rejected && Date.now() < deadline) await delay(10);
      if (rejected) throw launchError;
      expect(fs.existsSync(pidFile)).toBe(true);
      pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
      expect(pid).toBeGreaterThan(0);
      expect(() => process.kill(-pid!, 0)).not.toThrow();
      // Allow the shell to launch descendants before cancellation.
      await delay(100);
      const started = Date.now();
      controller.abort();
      const result = await observed;
      expect(Date.now() - started).toBeLessThan(6000);
      expect(result?.signal).toBe(ignoreTerm ? 'SIGKILL' : 'SIGTERM');
      let gone: unknown;
      try { process.kill(-pid, 0); } catch (error) { gone = error; }
      expect(gone).toMatchObject({ code: 'ESRCH' });
    } finally {
      controller.abort();
      if (pid) {
        try { process.kill(-pid, 'SIGKILL'); } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
        }
      }
      await observed;
    }
  }, 10_000);

  it.each([false, true])('TEST-64 kills a generate-mode child blocked reading stdin, through a grandchild, on abort (ignore TERM=%s)', async ignoreTerm => {
    const dir = temporaryRoot();
    const fifo = join(dir, 'stdin.fifo');
    execFileSync('mkfifo', [fifo]);
    const writerFd = fs.openSync(fifo, 'r+');
    const pidFile = join(dir, 'pid');
    const grandchildPidFile = join(dir, 'grandchild-pid');
    const controller = new AbortController();
    // A backgrounded job gets its own stdin reassigned by the shell's job
    // control, even non-interactively; `<&0` re-attaches the fifo explicitly.
    const script = `${ignoreTerm ? 'trap "" TERM; ' : ''}exec < "$1"; echo $$ > "$2"; cat <&0 & echo $! > "$3"; wait`;
    let pid: number | undefined;
    let rejected = false;
    let launchError: unknown;
    const observed = runProcess('sh', ['-c', script, 'memos-test', fifo, pidFile, grandchildPidFile],
      { signal: controller.signal, stdio: 'generate', onStderrChunk: () => {} })
      .catch((error: unknown) => { rejected = true; launchError = error; return undefined; });
    try {
      const deadline = Date.now() + 2000;
      while (!fs.existsSync(pidFile) && !rejected && Date.now() < deadline) await delay(10);
      if (rejected) throw launchError;
      expect(fs.existsSync(pidFile)).toBe(true);
      pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
      expect(pid).toBeGreaterThan(0);
      expect(() => process.kill(-pid!, 0)).not.toThrow();
      while (!fs.existsSync(grandchildPidFile) && !rejected && Date.now() < deadline) await delay(10);
      if (rejected) throw launchError;
      expect(fs.existsSync(grandchildPidFile)).toBe(true);
      const grandchildPid = Number(fs.readFileSync(grandchildPidFile, 'utf8').trim());
      expect(grandchildPid).toBeGreaterThan(0);
      expect(() => process.kill(grandchildPid, 0)).not.toThrow();
      await delay(100);
      const started = Date.now();
      controller.abort();
      const result = await observed;
      expect(Date.now() - started).toBeLessThan(6000);
      expect(result?.signal).toBe(ignoreTerm ? 'SIGKILL' : 'SIGTERM');
      let gone: unknown;
      try { process.kill(-pid, 0); } catch (error) { gone = error; }
      expect(gone).toMatchObject({ code: 'ESRCH' });
    } finally {
      fs.closeSync(writerFd);
      controller.abort();
      if (pid) {
        try { process.kill(-pid, 'SIGKILL'); } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
        }
      }
      await observed;
    }
  }, 10_000);

  it('TEST-74 generate mode inherits stdin/stderr and forwards only captured stdout to the sink', async () => {
    const myStdin = fs.fstatSync(0), myStderr = fs.fstatSync(2), myStdout = fs.fstatSync(1);
    const script = "const fs=require('fs');const r={};for(const fd of [0,1,2]){try{const s=fs.fstatSync(fd);r[fd]=[s.dev,s.ino];}catch{r[fd]=null;}}process.stdout.write(JSON.stringify(r)+'\\n');process.stdout.write('generate output\\n');";
    const sink: string[] = [];
    const result = await runProcess(process.execPath, ['-e', script], {
      stdio: 'generate', onStderrChunk: (chunk: string) => sink.push(chunk),
    });
    expect(result.status).toBe(0);
    const [reportLine] = result.stdout.trim().split('\n');
    const report = JSON.parse(reportLine!);
    expect(report['0']).toEqual([myStdin.dev, myStdin.ino]);
    expect(report['2']).toEqual([myStderr.dev, myStderr.ino]);
    expect(report['1']).not.toEqual([myStdout.dev, myStdout.ino]);
    expect(sink.join('')).toBe(result.stdout);
  });

  it('TEST-74 resolve mode pipes both streams and redacts a password split across chunks', async () => {
    const myStdout = fs.fstatSync(1), myStderr = fs.fstatSync(2);
    const password = 'ab'.repeat(16);
    const script = "const fs=require('fs');const r={};for(const fd of [1,2]){try{const s=fs.fstatSync(fd);r[fd]=[s.dev,s.ino];}catch{r[fd]=null;}}process.stdout.write(JSON.stringify(r)+'\\n');"
      + `const secret=${JSON.stringify(password)};process.stdout.write('out-before '+secret.slice(0,8));process.stderr.write('err-before '+secret.slice(0,10));`
      + `setTimeout(()=>{process.stdout.write(secret.slice(8)+' out-after\\n');process.stderr.write(secret.slice(10)+' err-after\\n');},30);`;
    const sink: string[] = [];
    const result = await runProcess(process.execPath, ['-e', script], {
      stdio: 'resolve', password, onStderrChunk: (chunk: string) => sink.push(chunk),
    });
    expect(result.status).toBe(0);
    const [reportLine] = result.stdout.trim().split('\n');
    const report = JSON.parse(reportLine!);
    expect(report['1']).not.toEqual([myStdout.dev, myStdout.ino]);
    expect(report['2']).not.toEqual([myStderr.dev, myStderr.ino]);
    expect(result.stdout).toContain(password);
    expect(result.stderr).toContain(password);
    const forwarded = sink.join('');
    // stdout and stderr are independent streams forwarded through the same
    // sink; their chunks can interleave in real time, so this only checks
    // that each stream's own redaction succeeded, not cross-stream adjacency.
    expect(forwarded).not.toContain(password);
    expect(forwarded).toContain('out-before'); expect(forwarded).toContain('out-after');
    expect(forwarded).toContain('err-before'); expect(forwarded).toContain('err-after');
    expect(forwarded.match(/\[redacted\]/g)).toHaveLength(2);
  });
});

describe('buildChildEnv', () => {
  it('TEST-65 strips CI/GITHUB_ACTIONS/AMBERCAST_* and adds only the given secrets', () => {
    const parent = { CI: '1', GITHUB_ACTIONS: 'true', AMBERCAST_CONFIG: 'config', AMBERCAST_SECRET_X: 'old',
      AMBERCAST_AI_PROVIDER: 'claude', AMBERCAST_VERIFY_MEMOS_MODE: 'disclosure-only', PATH: '/bin', HOME: '/home/test' };
    const before = { ...parent };
    expect(buildChildEnv(parent, { AMBERCAST_SECRET_MEMOS_PASSWORD: 'new' })).toEqual({
      PATH: '/bin', HOME: '/home/test', AMBERCAST_SECRET_MEMOS_PASSWORD: 'new',
    });
    expect(parent).toEqual(before);
  });
});
