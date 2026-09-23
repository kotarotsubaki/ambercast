import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { PassThrough } from 'node:stream';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { McpServerDeps } from '#adapters/mcp/types.js';
import { runMcpCommand } from '#runtime/mcp-command.js';
import { runRunCommand, type RunCommandOutput } from '#runtime/run-command.js';
import { runCheckCommand } from '#runtime/check-command.js';

const serverFake = vi.hoisted(() => ({ connected: vi.fn(), called: vi.fn(), connectFailure: null as unknown, useReal: false }));
vi.mock('#adapters/mcp/server.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#adapters/mcp/server.js')>();
  return { createMcpServer: (deps: McpServerDeps, options?: Parameters<typeof actual.createMcpServer>[1]) => {
    if (serverFake.useReal) return actual.createMcpServer(deps, options);
    const server = new Server({ name: 'shutdown-test', version: '1.0.0' }, { capabilities: { tools: {} } });
    server.setRequestHandler(CallToolRequestSchema, async () => {
      serverFake.called();
      const result = await deps.run({}, { progressToken: undefined, sendNotification: async () => {} });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.envelope) }] };
    });
    return {
      connect: async (transport: Parameters<typeof server.connect>[0]) => {
        if (serverFake.connectFailure !== null) throw serverFake.connectFailure;
        await server.connect(transport);
        serverFake.connected();
      },
      close: () => server.close(),
    };
  } };
});
vi.mock('#runtime/run-command.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#runtime/run-command.js')>();
  return { ...actual, runRunCommand: vi.fn(actual.runRunCommand) };
});
vi.mock('#runtime/check-command.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#runtime/check-command.js')>();
  return { ...actual, runCheckCommand: vi.fn(actual.runCheckCommand) };
});

const temporaryDirectories: string[] = [];

async function fixtureDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ambercast-mcp-unit-'));
  temporaryDirectories.push(directory);
  return directory;
}

function streams() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let output = '';
  let errors = '';
  stdout.setEncoding('utf8');
  stderr.setEncoding('utf8');
  stdout.on('data', (chunk: string) => { output += chunk; });
  stderr.on('data', (chunk: string) => { errors += chunk; });
  return { stdin, stdout, stderr, output: () => output, errors: () => errors };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  serverFake.connectFailure = null;
  vi.clearAllMocks();
  serverFake.useReal = false;
});

function sendRequest(io: ReturnType<typeof streams>, id: number, name: string, args: Record<string, unknown> = {}): void {
  io.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })}\n`);
}

async function initialize(io: ReturnType<typeof streams>): Promise<void> {
  io.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1000, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'job-test', version: '1' } } })}\n`);
  await response(io, 1000);
  io.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
}

async function response(io: ReturnType<typeof streams>, id: number): Promise<Record<string, unknown>> {
  let message: Record<string, unknown> | undefined;
  await vi.waitFor(() => {
    message = io.output().split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((entry) => entry.id === id);
    expect(message).toBeDefined();
  });
  return message!;
}

describe('runtime/mcp-command', () => {
  it.each([
    [new TypeError('connection refused'), 'TypeError'],
    ['connection refused', 'Error'],
  ])('reports a connect rejection as one startup error with exit 3 (%s) (TEST-B2)', async (failure, name) => {
    serverFake.connectFailure = failure;
    const io = streams();
    const directory = await fixtureDirectory();
    const stdinEndListeners = io.stdin.listenerCount('end');
    const sigtermListeners = process.listenerCount('SIGTERM');
    const sigintListeners = process.listenerCount('SIGINT');

    const exitCode = await runMcpCommand({ dir: directory, syncWaitMs: 45_000, ...io });

    expect(exitCode).toBe(3);
    expect(io.errors()).toBe(`ambercast mcp: failed to start (${name})\n`);
    expect(io.output()).toBe('');
    expect(io.stdin.listenerCount('end')).toBe(stdinEndListeners);
    expect(process.listenerCount('SIGTERM')).toBe(sigtermListeners);
    expect(process.listenerCount('SIGINT')).toBe(sigintListeners);
    expect(serverFake.connected).not.toHaveBeenCalled();
  });

  it('returns a non-terminal job handle, then the terminal run response with job metadata (TEST-C1, TEST-C2)', async () => {
    serverFake.useReal = true;
    let release!: (value: RunCommandOutput) => void;
    vi.mocked(runRunCommand).mockImplementationOnce(() => new Promise<RunCommandOutput>((resolve) => { release = resolve; }));
    const io = streams();
    const directory = await fixtureDirectory();
    const running = runMcpCommand({ dir: directory, syncWaitMs: 1, ...io });
    await initialize(io);
    sendRequest(io, 1, 'ambercast_run');
    const handle = (await response(io, 1)).result as Record<string, unknown>;
    const job = handle.structuredContent as Record<string, unknown>;
    expect(handle).toMatchObject({ isError: false, _meta: { jobId: expect.any(String) } });
    expect(job).toMatchObject({ status: 'working', tool: 'run', statusMessage: 'running' });
    sendRequest(io, 2, 'ambercast_job_status', { jobId: job.jobId, waitMs: 0 });
    expect((await response(io, 2)).result).toMatchObject({ structuredContent: { status: 'working', jobId: job.jobId } });
    const envelope = { summary: 'completed', errors: [] };
    release({ exitCode: 0, envelope } as unknown as RunCommandOutput);
    sendRequest(io, 3, 'ambercast_job_status', { jobId: job.jobId, waitMs: 1000 });
    expect((await response(io, 3)).result).toMatchObject({
      isError: false, structuredContent: envelope, _meta: { exitCode: 0, job: { jobId: job.jobId, status: 'completed' } },
    });
    io.stdin.end();
    expect(await running).toBe(0);
  });

  it('reports missing job IDs for status and cancel (TEST-C2, TEST-C3)', async () => {
    serverFake.useReal = true;
    const io = streams();
    const directory = await fixtureDirectory();
    const running = runMcpCommand({ dir: directory, syncWaitMs: 1, ...io });
    await initialize(io);
    for (const [id, name] of [[1, 'ambercast_job_status'], [2, 'ambercast_job_cancel']] as const) {
      sendRequest(io, id, name, { jobId: 'missing-job' });
      const result = (await response(io, id)).result as Record<string, unknown>;
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([{ type: 'text', text: expect.stringMatching(/^JOB_NOT_FOUND: missing-job/) }]);
    }
    io.stdin.end();
    expect(await running).toBe(0);
  });

  it('runs check synchronously while a write job is working (TEST-C6)', async () => {
    serverFake.useReal = true;
    let release!: (value: RunCommandOutput) => void;
    vi.mocked(runRunCommand).mockImplementationOnce(() => new Promise<RunCommandOutput>((resolve) => { release = resolve; }));
    vi.mocked(runCheckCommand).mockResolvedValueOnce({ exitCode: 0, envelope: { summary: 'checked' } } as unknown as Awaited<ReturnType<typeof runCheckCommand>>);
    const io = streams();
    const directory = await fixtureDirectory();
    const running = runMcpCommand({ dir: directory, syncWaitMs: 1, ...io });
    await initialize(io);
    sendRequest(io, 1, 'ambercast_run');
    sendRequest(io, 2, 'ambercast_check');
    try {
      expect((await response(io, 2)).result).toMatchObject({ isError: false, structuredContent: { summary: 'checked' }, _meta: { exitCode: 0 } });
      expect(runCheckCommand).toHaveBeenCalledTimes(1);
    } finally {
      release({ exitCode: 0, envelope: { errors: [] } } as unknown as RunCommandOutput);
      io.stdin.end();
      await running;
    }
  });

  it('cancels a running job by aborting its runtime signal (TEST-C3)', async () => {
    serverFake.useReal = true;
    let aborted = false;
    vi.mocked(runRunCommand).mockImplementationOnce(({ signal }) => new Promise<RunCommandOutput>((resolve) => {
      signal?.addEventListener('abort', () => {
        aborted = true;
        resolve({ exitCode: 4, envelope: { errors: [{ scope: 'run', code: 'INTERRUPTED' }] } } as unknown as RunCommandOutput);
      }, { once: true });
    }));
    const io = streams();
    const directory = await fixtureDirectory();
    const running = runMcpCommand({ dir: directory, syncWaitMs: 1, ...io });
    await initialize(io);
    sendRequest(io, 1, 'ambercast_run');
    const handle = (await response(io, 1)).result as Record<string, unknown>;
    const jobId = (handle.structuredContent as Record<string, unknown>).jobId;
    sendRequest(io, 2, 'ambercast_job_cancel', { jobId });
    expect((await response(io, 2)).result).toMatchObject({ isError: false, structuredContent: { jobId, status: 'cancelled' } });
    expect(aborted).toBe(true);
    io.stdin.end();
    expect(await running).toBe(0);
  });

  it('aborts the running job and skips queued work during shutdown (TEST-C4)', async () => {
    serverFake.useReal = true;
    let aborted = false;
    vi.mocked(runRunCommand).mockImplementationOnce(({ signal }) => new Promise<RunCommandOutput>((resolve) => {
      signal?.addEventListener('abort', () => {
        aborted = true;
        resolve({ exitCode: 4, envelope: { errors: [{ scope: 'run', code: 'INTERRUPTED' }] } } as unknown as RunCommandOutput);
      }, { once: true });
    }));
    const io = streams();
    const directory = await fixtureDirectory();
    const running = runMcpCommand({ dir: directory, syncWaitMs: 1, ...io });
    await initialize(io);
    sendRequest(io, 1, 'ambercast_run');
    await response(io, 1);
    sendRequest(io, 2, 'ambercast_run');
    await response(io, 2);
    process.emit('SIGTERM');
    expect(await running).toBe(0);
    expect(aborted).toBe(true);
    expect(runRunCommand).toHaveBeenCalledTimes(1);
  });
  it('aborts an active call on SIGTERM and returns its INTERRUPTED envelope with exit 0 (TEST-B9)', async () => {
    vi.mocked(runRunCommand).mockImplementationOnce(({ signal }) => new Promise<RunCommandOutput>((resolve) => {
      signal?.addEventListener('abort', () => resolve({
        exitCode: 4,
        envelope: {
          schemaVersion: '3.6', command: 'run', startedAt: '2026-08-09T00:00:00Z', durationMs: 0,
          summary: { total: 0, passed: 0, failed: 0, errored: 0, skipped: 0 },
          errors: [{ scope: 'run', kind: 'environment', code: 'INTERRUPTED', message: 'Run interrupted.' }],
          results: [], reportPersistence: 'not-attempted',
        },
      } as unknown as RunCommandOutput), { once: true });
    }));
    const io = streams();
    const directory = await fixtureDirectory();
    const running = runMcpCommand({ dir: directory, syncWaitMs: 45_000, ...io }).then((code) => ({ code }), (error: unknown) => ({ error }));
    await vi.waitFor(() => expect(serverFake.connected).toHaveBeenCalled());
    io.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } } })}\n`);
    io.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'ambercast_run', arguments: {} } })}\n`);
    await vi.waitFor(() => expect(serverFake.called).toHaveBeenCalledTimes(1));
    process.emit('SIGTERM');
    expect(await running).toEqual({ code: 0 });
    expect(io.output()).toContain('INTERRUPTED');
  });

  it('returns exit 3 when an active call ignores abort beyond ten seconds (TEST-B9)', async () => {
    vi.mocked(runRunCommand).mockImplementationOnce(() => new Promise<RunCommandOutput>(() => {}));
    vi.useFakeTimers();
    try {
      const io = streams();
      const directory = await fixtureDirectory();
      const running = runMcpCommand({ dir: directory, syncWaitMs: 45_000, ...io }).then((code) => ({ code }), (error: unknown) => ({ error }));
      await vi.waitFor(() => expect(serverFake.connected).toHaveBeenCalled());
      io.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ambercast_run', arguments: {} } })}\n`);
      await vi.waitFor(() => expect(serverFake.called).toHaveBeenCalledTimes(1));
      process.emit('SIGTERM');
      await vi.advanceTimersByTimeAsync(10_001);
      expect(await running).toEqual({ code: 3 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps draining after a repeated SIGTERM until the active call settles (TEST-B9)', async () => {
    let settleCall: ((value: RunCommandOutput) => void) | undefined;
    vi.mocked(runRunCommand).mockImplementationOnce(() => new Promise<RunCommandOutput>((resolve) => {
      settleCall = resolve;
    }));
    const io = streams();
    const directory = await fixtureDirectory();
    const initialListeners = process.listenerCount('SIGTERM');
    const running = runMcpCommand({ dir: directory, syncWaitMs: 45_000, ...io });
    await vi.waitFor(() => expect(serverFake.connected).toHaveBeenCalled());
    io.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ambercast_run', arguments: {} } })}\n`);
    await vi.waitFor(() => expect(serverFake.called).toHaveBeenCalledTimes(1));

    process.emit('SIGTERM');
    process.emit('SIGTERM');
    expect(process.listenerCount('SIGTERM')).toBe(initialListeners + 1);
    settleCall?.({ exitCode: 0, envelope: { schemaVersion: '3.6', command: 'run', startedAt: '2026-08-09T00:00:00Z', durationMs: 0, summary: { total: 0, passed: 0, failed: 0, errored: 0, skipped: 0 }, errors: [], results: [], reportPersistence: 'not-attempted' } } as unknown as RunCommandOutput);
    expect(await running).toBe(0);
    expect(process.listenerCount('SIGTERM')).toBe(initialListeners);
  });

  it('rejects a new call during drain before it reaches the tool handler and logs its count (TEST-B9)', async () => {
    const io = streams();
    const directory = await fixtureDirectory();
    const running = runMcpCommand({ dir: directory, syncWaitMs: 45_000, ...io }).then((code) => ({ code }), (error: unknown) => ({ error }));
    await vi.waitFor(() => expect(serverFake.connected).toHaveBeenCalled());
    process.emit('SIGTERM');
    io.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'ambercast_run', arguments: {} } })}\n`);
    expect(await running).toEqual({ code: 0 });
    expect(serverFake.called).not.toHaveBeenCalled();
    expect(io.errors().trim().split('\n')).toEqual([
      `ambercast mcp: serving ${directory}`,
      expect.stringMatching(/1.*reject|reject.*1/i),
    ]);
  });
  it('rejects a missing --dir with the resolved path and exit 2 (TEST-B1)', async () => {
    const directory = await fixtureDirectory();
    const missing = join(directory, 'missing');
    const io = streams();
    io.stdin.end();

    const exitCode = await runMcpCommand({ dir: relative(process.cwd(), missing), syncWaitMs: 45_000, ...io });

    expect(exitCode).toBe(2);
    expect(io.errors()).toBe(`ambercast mcp: --dir ${missing} is not a directory.\n`);
    expect(io.output()).toBe('');
  });

  it('rejects a file supplied as --dir with exit 2 (TEST-B1)', async () => {
    const directory = await fixtureDirectory();
    const file = join(directory, 'not-a-directory');
    await writeFile(file, 'fixture');
    const io = streams();
    io.stdin.end();

    const exitCode = await runMcpCommand({ dir: file, syncWaitMs: 45_000, ...io });

    expect(exitCode).toBe(2);
    expect(io.errors()).toBe(`ambercast mcp: --dir ${file} is not a directory.\n`);
    expect(io.output()).toBe('');
  });

  it('starts without a config and accepts the smallest positive sync wait (TEST-B5, TEST-B10)', async () => {
    const directory = await fixtureDirectory();
    const io = streams();
    io.stdin.end();

    const exitCode = await runMcpCommand({ dir: directory, syncWaitMs: 1, ...io });

    expect(exitCode).toBe(0);
    expect(io.errors()).toBe(`ambercast mcp: serving ${directory}\n`);
    expect(io.output()).toBe('');
  });
});
