import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { McpServerDeps } from '#adapters/mcp/types.js';
import { createGuardedSend, runMcpCommand, type JobRecord } from '#runtime/mcp-command.js';
import { runRunCommand, type RunCommandOutput } from '#runtime/run-command.js';
import { runCheckCommand } from '#runtime/check-command.js';
import { prepareHeal, type HealCommandOutput, type HealPreparation } from '#runtime/heal-command.js';

const serverFake = vi.hoisted(() => ({ connected: vi.fn(), called: vi.fn(), connectFailure: null as unknown, useReal: false, deps: undefined as McpServerDeps | undefined }));
const clockFake = vi.hoisted(() => ({ elapsed: undefined as number | undefined }));
vi.mock('#adapters/mcp/server.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#adapters/mcp/server.js')>();
  return { createMcpServer: (deps: McpServerDeps, options: Parameters<typeof actual.createMcpServer>[1]) => {
    serverFake.deps = deps;
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
vi.mock('#runtime/heal-command.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#runtime/heal-command.js')>();
  return { ...actual, prepareHeal: vi.fn(actual.prepareHeal) };
});
vi.mock('#adapters/system/system-clock.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#adapters/system/system-clock.js')>();
  return { ...actual, createSystemClock: () => {
    const clock = actual.createSystemClock();
    return { now: clock.now, monotonicMs: () => clockFake.elapsed ?? clock.monotonicMs() };
  } };
});

const temporaryDirectories: string[] = [];
const openInputs: PassThrough[] = [];
const pendingReleases: Array<() => void> = [];

function trackRelease(resolve: (value: RunCommandOutput) => void): (value: RunCommandOutput) => void {
  pendingReleases.push(() => resolve({ exitCode: 0, envelope: { errors: [] } } as unknown as RunCommandOutput));
  return resolve;
}

async function fixtureDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ambercast-mcp-unit-'));
  temporaryDirectories.push(directory);
  return directory;
}

function streams() {
  const stdin = new PassThrough();
  openInputs.push(stdin);
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
  for (const release of pendingReleases.splice(0)) release();
  for (const input of openInputs.splice(0)) input.end();
  await new Promise<void>((resolve) => setImmediate(resolve));
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  serverFake.connectFailure = null;
  vi.clearAllMocks();
  vi.mocked(runRunCommand).mockReset();
  vi.mocked(runCheckCommand).mockReset();
  vi.mocked(prepareHeal).mockReset();
  clockFake.elapsed = undefined;
  serverFake.deps = undefined;
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

function responseNow(io: ReturnType<typeof streams>, id: number): Record<string, unknown> {
  const message = io.output().split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>)
    .find((entry) => entry.id === id);
  expect(message).toBeDefined();
  return message!;
}

async function responseSoon(io: ReturnType<typeof streams>, id: number): Promise<Record<string, unknown>> {
  await new Promise<void>((resolve) => setTimeout(resolve, 100));
  return responseNow(io, id);
}

function assertRecordResponse(result: unknown, expected: Pick<JobRecord, 'tool' | 'status' | 'statusMessage' | 'progress'>): JobRecord {
  const rendered = result as Record<string, unknown>;
  const record = rendered.structuredContent as JobRecord;
  expect(record).toEqual({
    jobId: expect.any(String),
    tool: expected.tool,
    status: expected.status,
    statusMessage: expected.statusMessage,
    progress: expected.progress,
    createdAt: expect.any(String),
    lastUpdatedAt: expect.any(String),
    pollIntervalMs: 2000,
    ttlMs: 1_800_000,
  });
  expect(record.jobId).not.toBe('');
  expect(Number.isNaN(Date.parse(record.createdAt))).toBe(false);
  expect(Number.isNaN(Date.parse(record.lastUpdatedAt))).toBe(false);
  expect(rendered).toMatchObject({ isError: false, _meta: { jobId: record.jobId } });
  expect(rendered.content).toEqual([{
    type: 'text',
    text: `jobId: ${record.jobId}\nstatus: ${record.status}\n${record.statusMessage}`,
  }]);
  return record;
}

function healOutput(exitCode = 0, errors: unknown[] = []): HealCommandOutput {
  return { exitCode, envelope: { errors } } as unknown as HealCommandOutput;
}

function interruptedRunOutput(): RunCommandOutput {
  return {
    exitCode: 3,
    envelope: {
      schemaVersion: '3.6', command: 'run', startedAt: '2026-08-09T00:00:00Z', durationMs: 0,
      summary: { total: 0, passed: 0, failed: 0, errored: 0, skipped: 0 },
      errors: [{ scope: 'run', kind: 'environment', code: 'INTERRUPTED', message: 'Run interrupted.' }],
      results: [], reportPersistence: 'not-attempted',
    },
  } as unknown as RunCommandOutput;
}

function abortAfterOneMacrotask(): void {
  vi.mocked(runRunCommand).mockImplementation(({ signal }) => new Promise<RunCommandOutput>((resolve) => {
    const interrupted = () => { setTimeout(() => resolve(interruptedRunOutput()), 50); };
    if (signal?.aborted) interrupted();
    else signal?.addEventListener('abort', interrupted, { once: true });
  }));
}

function assertInterruptedRun(result: unknown): void {
  expect(result).toMatchObject({
    isError: true,
    structuredContent: interruptedRunOutput().envelope,
    _meta: { exitCode: 3 },
  });
  const text = ((result as Record<string, unknown>).content as { text: string }[])[0]!.text;
  expect(text.split('\n')[0]).toBe('exitCode: 3');
  expect(text).toContain('INTERRUPTED');
}

function queuePreparation(settle = vi.fn(async () => healOutput()), preview = healOutput()) {
  const preparation: HealPreparation = {
    hasCommits: true,
    cases: [{ caseId: 'case-1', file: 'sample.test.md', healingSummary: 'repair' }],
    preview: () => preview,
    settle,
  };
  vi.mocked(prepareHeal).mockResolvedValueOnce(preparation);
  return { preparation, settle };
}

async function proposalSession() {
  const io = streams();
  const directory = await fixtureDirectory();
  const previousConnections = serverFake.connected.mock.calls.length;
  const running = runMcpCommand({ dir: directory, syncWaitMs: 1, ...io });
  await vi.waitFor(() => expect(serverFake.connected.mock.calls.length).toBeGreaterThan(previousConnections));
  const deps = serverFake.deps!;
  return { deps, close: async () => { io.stdin.end(); expect(await running).toBe(0); } };
}

const noProgress = { progressToken: undefined, sendNotification: async () => {} };

async function issuedToken(deps: McpServerDeps): Promise<string> {
  const result = await deps.healPreview({}, noProgress);
  expect(result.applyToken).toMatch(/^[0-9a-f]{32}$/);
  return result.applyToken!;
}

function expectTokenError(outcome: Awaited<ReturnType<NonNullable<McpServerDeps['applyHeal']>>>, state: string): void {
  expect(outcome.kind).toBe('error');
  expect(JSON.stringify(outcome)).toMatch(new RegExp(state, 'i'));
}

describe('runtime/mcp-command', () => {
  describe('guarded transport send (TEST-B1)', () => {
    const responseMessage = { jsonrpc: '2.0' as const, id: 7, result: {} };
    const notification = { jsonrpc: '2.0' as const, method: 'notifications/progress' };
    const request = { jsonrpc: '2.0' as const, id: 8, method: 'elicitation/create' };

    it.each([
      [responseMessage, 'ambercast mcp: failed to send a response\n', 7],
      [notification, 'ambercast mcp: failed to send a notification (notifications/progress)\n', undefined],
      [request, 'ambercast mcp: failed to send a request (elicitation/create)\n', undefined],
      [{ jsonrpc: '2.0' as const, method: 'notice\u001b[31m' }, 'ambercast mcp: failed to send a notification (notice\\u001b[31m)\n', undefined],
    ])('logs one line and resolves for a rejected lower send %#', async (message, line, responseId) => {
      const stderr = streams().stderr;
      let written = '';
      stderr.on('data', (chunk: Buffer | string) => { written += String(chunk); });
      const onResponse = vi.fn();
      const send = vi.fn(async () => { throw new Error('send failed'); });
      await expect(createGuardedSend(send, { stderr, isClosed: () => false, onResponse })(message)).resolves.toBeUndefined();
      expect(send).toHaveBeenCalledOnce();
      expect(written).toBe(line);
      expect(onResponse.mock.calls).toEqual(responseId === undefined ? [] : [[responseId]]);
    });

    it('logs once and reports an error response id when the lower send rejects', async () => {
      const io = streams();
      const onResponse = vi.fn();
      const send = vi.fn(async () => { throw new Error('send failed'); });
      const errorResponse = { jsonrpc: '2.0' as const, id: 9, error: { code: -32603, message: 'Internal error' } };

      await expect(createGuardedSend(send, { stderr: io.stderr, isClosed: () => false, onResponse })(errorResponse)).resolves.toBeUndefined();
      expect(send).toHaveBeenCalledOnce();
      expect(io.errors()).toBe('ambercast mcp: failed to send a response\n');
      expect(onResponse).toHaveBeenCalledExactlyOnceWith(9);
    });

    it('keeps successful sends silent and reports only response ids', async () => {
      const io = streams();
      const onResponse = vi.fn();
      const send = vi.fn(async () => {});
      const guarded = createGuardedSend(send, { stderr: io.stderr, isClosed: () => false, onResponse });
      await guarded(responseMessage);
      await guarded(notification);
      await guarded(request);
      expect(send).toHaveBeenCalledTimes(3);
      expect(onResponse.mock.calls).toEqual([[7]]);
      expect(io.errors()).toBe('');
    });

    it('does not call the lower send or log after close', async () => {
      const io = streams();
      const send = vi.fn(async () => {});
      const onResponse = vi.fn();
      await createGuardedSend(send, { stderr: io.stderr, isClosed: () => true, onResponse })(responseMessage);
      expect(send).not.toHaveBeenCalled();
      expect(onResponse).not.toHaveBeenCalled();
      expect(io.errors()).toBe('');
    });

    it('resolves and logs once when the lower send throws synchronously', async () => {
      const io = streams();
      const order: string[] = [];
      const send = vi.fn((): Promise<void> => { order.push('send'); throw new Error('sync failure'); });
      const onResponse = vi.fn((id: string | number) => { order.push(`response:${id}`); });
      const guarded = createGuardedSend(send, { stderr: io.stderr, isClosed: () => false, onResponse });
      const result = guarded(responseMessage);
      expect(order).toEqual(['send', 'response:7']);
      await expect(result).resolves.toBeUndefined();
      expect(io.errors()).toBe('ambercast mcp: failed to send a response\n');
      expect(onResponse).toHaveBeenCalledExactlyOnceWith(7);
    });

    it('resolves when stderr.write throws', async () => {
      const stderr = { write: () => { throw new Error('log failure'); } } as unknown as NodeJS.WritableStream;
      await expect(createGuardedSend(async () => { throw new Error('send failure'); }, {
        stderr, isClosed: () => false,
      })(notification)).resolves.toBeUndefined();
    });

    it('calls onResponse immediately after invoking a pending lower send', async () => {
      let rejectSend!: (reason: Error) => void;
      const order: string[] = [];
      const send = vi.fn(() => {
        order.push('send');
        return new Promise<void>((_resolve, reject) => { rejectSend = reject; });
      });
      const io = streams();
      const guarded = createGuardedSend(send, {
        stderr: io.stderr, isClosed: () => false, onResponse: (id) => { order.push(`response:${id}`); },
      });
      const result = guarded(responseMessage);
      expect(order).toEqual(['send', 'response:7']);
      expect(io.errors()).toBe('');
      rejectSend(new Error('later failure'));
      await expect(result).resolves.toBeUndefined();
      expect(io.errors()).toBe('ambercast mcp: failed to send a response\n');
    });
  });

  it('continues progress after the second transport send fails (TEST-B2)', async () => {
    serverFake.useReal = true;
    const attempts: string[] = [];
    const originalSend = StdioServerTransport.prototype.send;
    let progressCount = 0;
    const sendSpy = vi.spyOn(StdioServerTransport.prototype, 'send').mockImplementation(function (this: StdioServerTransport, message) {
      if ('method' in message && message.method === 'notifications/progress') {
        progressCount += 1;
        attempts.push(`progress:${progressCount}`);
        if (progressCount === 2) return Promise.reject(new Error('progress send failed'));
      } else if ('id' in message && message.id === 1 && 'result' in message) attempts.push('response');
      return originalSend.call(this, message);
    });
    let releaseRun!: (value: RunCommandOutput) => void;
    vi.mocked(runRunCommand).mockImplementationOnce(({ events }) => new Promise<RunCommandOutput>((resolve) => {
      releaseRun = trackRelease(resolve);
      events?.emit({ type: 'step-start', stepId: 'one' });
      events?.emit({ type: 'step-start', stepId: 'two' });
      events?.emit({ type: 'step-start', stepId: 'three' });
    }));
    const io = streams();
    const directory = await fixtureDirectory();
    const running = runMcpCommand({ dir: directory, syncWaitMs: 45_000, ...io });
    try {
      await initialize(io);
      const stderrBeforeCall = io.errors();
      io.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
        name: 'ambercast_run', arguments: {}, _meta: { progressToken: 'run-progress' },
      } })}\n`);
      await vi.waitFor(() => expect(progressCount).toBe(3));
      releaseRun({ exitCode: 0, envelope: { errors: [] } } as unknown as RunCommandOutput);
      await response(io, 1);
      expect(attempts).toEqual(['progress:1', 'progress:2', 'progress:3', 'response']);
      const messages = io.output().split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
      const progress = messages.filter((message) => message.method === 'notifications/progress');
      expect(progress.map((message) => (message.params as Record<string, unknown>).progress)).toEqual([1, 3]);
      expect(messages.findIndex((message) => message.id === 1)).toBeGreaterThan(messages.findIndex((message) =>
        message.method === 'notifications/progress' && (message.params as Record<string, unknown>).progress === 3));
      expect(io.errors().slice(stderrBeforeCall.length)).toBe('ambercast mcp: failed to send a notification (notifications/progress)\n');
    } finally {
      sendSpy.mockRestore();
      io.stdin.end();
      await running;
    }
  });
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
    const job = assertRecordResponse(handle, { tool: 'run', status: 'working', statusMessage: 'running', progress: 0 });
    sendRequest(io, 2, 'ambercast_job_status', { jobId: job.jobId, waitMs: 0 });
    assertRecordResponse((await response(io, 2)).result, { tool: 'run', status: 'working', statusMessage: 'running', progress: 0 });
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
    assertRecordResponse((await response(io, 2)).result, { tool: 'run', status: 'cancelled', statusMessage: 'cancelled', progress: 0 });
    expect(aborted).toBe(true);
    io.stdin.end();
    expect(await running).toBe(0);
  });

  it('uses the first settlement at the sync wait boundary in both orders (TEST-C1)', async () => {
    for (const order of ['runtime-first', 'timer-first'] as const) {
    serverFake.useReal = true;
    let releaseRun!: (value: RunCommandOutput) => void;
    let runStarted!: () => void;
    const started = new Promise<void>((resolve) => { runStarted = resolve; });
    vi.mocked(runRunCommand).mockImplementationOnce(() => {
      runStarted();
      return new Promise<RunCommandOutput>((resolve) => { releaseRun = trackRelease(resolve); });
    });
    const io = streams();
    const directory = await fixtureDirectory();
    const running = runMcpCommand({ dir: directory, syncWaitMs: 20, ...io });
    await initialize(io);
    vi.useFakeTimers();
    try {
      sendRequest(io, 1, 'ambercast_run');
      await vi.advanceTimersByTimeAsync(0);
      await started;
      const output = { exitCode: 0, envelope: { summary: 'done', errors: [] } } as unknown as RunCommandOutput;
      if (order === 'runtime-first') {
        releaseRun(output);
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(20);
        expect((await response(io, 1)).result).toMatchObject({ structuredContent: output.envelope, _meta: { exitCode: 0 } });
      } else {
        await vi.advanceTimersByTimeAsync(20);
        assertRecordResponse(responseNow(io, 1).result, { tool: 'run', status: 'working', statusMessage: 'running', progress: 0 });
        releaseRun(output);
      }
    } finally {
      releaseRun?.({ exitCode: 0, envelope: { errors: [] } } as unknown as RunCommandOutput);
      vi.useRealTimers();
      io.stdin.end();
      await running;
    }
    }
  });

  it('returns status immediately at waitMs zero and long-polls until completion (TEST-C2)', async () => {
    serverFake.useReal = true;
    let releaseRun!: (value: RunCommandOutput) => void;
    vi.mocked(runRunCommand).mockImplementationOnce(() => new Promise<RunCommandOutput>((resolve) => { releaseRun = trackRelease(resolve); }));
    const io = streams();
    const directory = await fixtureDirectory();
    const running = runMcpCommand({ dir: directory, syncWaitMs: 1, ...io });
    await initialize(io);
    sendRequest(io, 1, 'ambercast_run');
    const job = assertRecordResponse((await responseSoon(io, 1)).result, { tool: 'run', status: 'working', statusMessage: 'running', progress: 0 });
    vi.useFakeTimers();
    try {
      const beforeStatus = Date.now();
      sendRequest(io, 2, 'ambercast_job_status', { jobId: job.jobId, waitMs: 0 });
      await vi.advanceTimersByTimeAsync(0);
      assertRecordResponse(responseNow(io, 2).result, { tool: 'run', status: 'working', statusMessage: 'running', progress: 0 });
      sendRequest(io, 4, 'ambercast_job_status', { jobId: job.jobId });
      await vi.advanceTimersByTimeAsync(0);
      assertRecordResponse(responseNow(io, 4).result, { tool: 'run', status: 'working', statusMessage: 'running', progress: 0 });
      expect(Date.now()).toBe(beforeStatus);
      sendRequest(io, 3, 'ambercast_job_status', { jobId: job.jobId, waitMs: 5000 });
      await vi.advanceTimersByTimeAsync(0);
      expect(io.output()).not.toMatch(/"id":3[,}]/);
      releaseRun({ exitCode: 0, envelope: { summary: 'done', errors: [] } } as unknown as RunCommandOutput);
      await vi.advanceTimersByTimeAsync(0);
      expect(responseNow(io, 3).result).toMatchObject({ _meta: { exitCode: 0, job: { jobId: job.jobId, status: 'completed', statusMessage: 'completed' } } });
    } finally {
      releaseRun?.({ exitCode: 0, envelope: { errors: [] } } as unknown as RunCommandOutput);
      vi.useRealTimers();
      io.stdin.end();
      await running;
    }
  });

  it('cancels queued work without invoking its runtime and preserves terminal cancellation (TEST-C3)', async () => {
    serverFake.useReal = true;
    let releaseFirst!: (value: RunCommandOutput) => void;
    vi.mocked(runRunCommand).mockImplementationOnce(() => new Promise<RunCommandOutput>((resolve) => { releaseFirst = trackRelease(resolve); }));
    const io = streams();
    const directory = await fixtureDirectory();
    const running = runMcpCommand({ dir: directory, syncWaitMs: 1, ...io });
    await initialize(io);
    sendRequest(io, 1, 'ambercast_run');
    await responseSoon(io, 1);
    sendRequest(io, 2, 'ambercast_run');
    const queued = (await responseSoon(io, 2)).result as Record<string, unknown>;
    const queuedId = (queued.structuredContent as JobRecord).jobId;
    expect((queued.structuredContent as JobRecord).status).toBe('working');
    expect(runRunCommand).toHaveBeenCalledTimes(1);
    sendRequest(io, 3, 'ambercast_job_cancel', { jobId: queuedId });
    const cancelled = assertRecordResponse((await response(io, 3)).result, { tool: 'run', status: 'cancelled', statusMessage: 'cancelled before start', progress: 0 });
    expect(cancelled.jobId).toBe(queuedId);
    sendRequest(io, 4, 'ambercast_job_cancel', { jobId: queuedId });
    expect((await response(io, 4)).result).toEqual((await response(io, 3)).result);
    expect(runRunCommand).toHaveBeenCalledTimes(1);
    releaseFirst({ exitCode: 0, envelope: { errors: [] } } as unknown as RunCommandOutput);
    io.stdin.end();
    expect(await running).toBe(0);
    expect(runRunCommand).toHaveBeenCalledTimes(1);
  });

  it('returns cancel requested while an active runtime ignores abort (TEST-C3)', async () => {
    serverFake.useReal = true;
    let releaseRun!: (value: RunCommandOutput) => void;
    vi.mocked(runRunCommand).mockImplementationOnce(() => new Promise<RunCommandOutput>((resolve) => { releaseRun = trackRelease(resolve); }));
    const io = streams();
    const directory = await fixtureDirectory();
    const running = runMcpCommand({ dir: directory, syncWaitMs: 1, ...io });
    await initialize(io);
    sendRequest(io, 1, 'ambercast_run');
    const job = (await responseSoon(io, 1)).result as Record<string, unknown>;
    const jobId = (job.structuredContent as JobRecord).jobId;
    vi.useFakeTimers();
    try {
      sendRequest(io, 2, 'ambercast_job_cancel', { jobId });
      await vi.advanceTimersByTimeAsync(10_000);
      assertRecordResponse(responseNow(io, 2).result, { tool: 'run', status: 'working', statusMessage: 'cancel requested', progress: 0 });
      releaseRun({ exitCode: 4, envelope: { errors: [{ scope: 'run', code: 'INTERRUPTED' }] } } as unknown as RunCommandOutput);
      sendRequest(io, 3, 'ambercast_job_cancel', { jobId });
      await vi.advanceTimersByTimeAsync(0);
      assertRecordResponse(responseNow(io, 3).result, { tool: 'run', status: 'cancelled', statusMessage: 'cancelled', progress: 0 });
    } finally {
      releaseRun?.({ exitCode: 4, envelope: { errors: [{ scope: 'run', code: 'INTERRUPTED' }] } } as unknown as RunCommandOutput);
      vi.useRealTimers();
      io.stdin.end();
      await running;
    }
  });

  it.each([
    ['completed', { exitCode: 0, envelope: { errors: [] } }],
    ['cancelled', { exitCode: 4, envelope: { errors: [{ scope: 'run', code: 'INTERRUPTED' }] } }],
  ] as const)('keeps the %s terminal record unchanged on repeated cancel (TEST-C3)', async (status, output) => {
    serverFake.useReal = true;
    let releaseRun!: (value: RunCommandOutput) => void;
    vi.mocked(runRunCommand).mockImplementationOnce(() => new Promise<RunCommandOutput>((resolve) => { releaseRun = trackRelease(resolve); }));
    const io = streams();
    const directory = await fixtureDirectory();
    const running = runMcpCommand({ dir: directory, syncWaitMs: 1, ...io });
    await initialize(io);
    sendRequest(io, 1, 'ambercast_run');
    const first = assertRecordResponse((await responseSoon(io, 1)).result, { tool: 'run', status: 'working', statusMessage: 'running', progress: 0 });
    const jobId = first.jobId;
    releaseRun(output as unknown as RunCommandOutput);
    sendRequest(io, 4, 'ambercast_job_status', { jobId, waitMs: 1000 });
    await response(io, 4);
    sendRequest(io, 2, 'ambercast_job_cancel', { jobId });
    const cancelled = assertRecordResponse((await response(io, 2)).result, { tool: 'run', status, statusMessage: status, progress: 0 });
    sendRequest(io, 3, 'ambercast_job_cancel', { jobId });
    expect((await response(io, 3)).result).toEqual((await response(io, 2)).result);
    expect(cancelled.jobId).toBe(jobId);
    io.stdin.end();
    expect(await running).toBe(0);
  });

  it('keeps natural completion when it settles before an abort request (TEST-C3)', async () => {
    serverFake.useReal = true;
    let releaseRun!: (value: RunCommandOutput) => void;
    vi.mocked(runRunCommand).mockImplementationOnce(() => new Promise<RunCommandOutput>((resolve) => { releaseRun = trackRelease(resolve); }));
    const io = streams();
    const directory = await fixtureDirectory();
    const running = runMcpCommand({ dir: directory, syncWaitMs: 1, ...io });
    await initialize(io);
    sendRequest(io, 1, 'ambercast_run');
    const job = assertRecordResponse((await responseSoon(io, 1)).result, { tool: 'run', status: 'working', statusMessage: 'running', progress: 0 });
    releaseRun({ exitCode: 0, envelope: { errors: [] } } as unknown as RunCommandOutput);
    sendRequest(io, 2, 'ambercast_job_status', { jobId: job.jobId, waitMs: 1000 });
    expect((await response(io, 2)).result).toMatchObject({ _meta: { job: { status: 'completed', statusMessage: 'completed' } } });
    sendRequest(io, 3, 'ambercast_job_cancel', { jobId: job.jobId });
    assertRecordResponse((await response(io, 3)).result, { tool: 'run', status: 'completed', statusMessage: 'completed', progress: 0 });
    io.stdin.end();
    expect(await running).toBe(0);
  });

  it('keeps a failed terminal record unchanged on cancel (TEST-C3)', async () => {
    serverFake.useReal = true;
    let rejectRun!: (error: Error) => void;
    vi.mocked(runRunCommand).mockImplementationOnce(() => new Promise<RunCommandOutput>((_resolve, reject) => {
      rejectRun = reject;
      pendingReleases.push(() => reject(new Error('cleanup')));
    }));
    const io = streams();
    const directory = await fixtureDirectory();
    const running = runMcpCommand({ dir: directory, syncWaitMs: 1, ...io });
    await initialize(io);
    sendRequest(io, 1, 'ambercast_run');
    const job = assertRecordResponse((await responseSoon(io, 1)).result, { tool: 'run', status: 'working', statusMessage: 'running', progress: 0 });
    rejectRun(new Error('runtime failed'));
    sendRequest(io, 4, 'ambercast_job_status', { jobId: job.jobId, waitMs: 1000 });
    await response(io, 4);
    sendRequest(io, 2, 'ambercast_job_cancel', { jobId: job.jobId });
    assertRecordResponse((await response(io, 2)).result, { tool: 'run', status: 'failed', statusMessage: 'failed', progress: 0 });
    sendRequest(io, 3, 'ambercast_job_cancel', { jobId: job.jobId });
    expect((await response(io, 3)).result).toEqual((await response(io, 2)).result);
    io.stdin.end();
    expect(await running).toBe(0);
  });

  it('retains terminal jobs until TTL and never prunes a working job (TEST-C2)', async () => {
    serverFake.useReal = true;
    let releaseTerminal!: (value: RunCommandOutput) => void;
    let releaseWorking!: (value: RunCommandOutput) => void;
    vi.mocked(runRunCommand)
      .mockImplementationOnce(() => new Promise<RunCommandOutput>((resolve) => { releaseTerminal = trackRelease(resolve); }))
      .mockImplementationOnce(() => new Promise<RunCommandOutput>((resolve) => { releaseWorking = trackRelease(resolve); }));
    const io = streams();
    const directory = await fixtureDirectory();
    const running = runMcpCommand({ dir: directory, syncWaitMs: 1, ...io });
    await initialize(io);
    vi.useFakeTimers();
    try {
      sendRequest(io, 1, 'ambercast_run');
      await vi.advanceTimersByTimeAsync(1);
      const terminal = assertRecordResponse(responseNow(io, 1).result, { tool: 'run', status: 'working', statusMessage: 'running', progress: 0 });
      const terminalId = terminal.jobId;
      releaseTerminal({ exitCode: 0, envelope: { errors: [] } } as unknown as RunCommandOutput);
      await vi.advanceTimersByTimeAsync(0);
      sendRequest(io, 2, 'ambercast_run');
      await vi.advanceTimersByTimeAsync(1);
      const working = assertRecordResponse(responseNow(io, 2).result, { tool: 'run', status: 'working', statusMessage: 'running', progress: 0 });
      await vi.advanceTimersByTimeAsync(1_799_997);
      sendRequest(io, 3, 'ambercast_job_status', { jobId: terminalId });
      await vi.advanceTimersByTimeAsync(0);
      expect(responseNow(io, 3).result).toMatchObject({ _meta: { job: { jobId: terminalId, status: 'completed' } } });
      await vi.advanceTimersByTimeAsync(2);
      sendRequest(io, 4, 'ambercast_job_status', { jobId: terminalId });
      sendRequest(io, 5, 'ambercast_job_status', { jobId: working.jobId });
      await vi.advanceTimersByTimeAsync(0);
      expect(responseNow(io, 4).result).toMatchObject({ isError: true, content: [{ type: 'text', text: `JOB_NOT_FOUND: ${terminalId}` }] });
      assertRecordResponse(responseNow(io, 5).result, { tool: 'run', status: 'working', statusMessage: 'running', progress: 0 });
    } finally {
      releaseTerminal?.({ exitCode: 0, envelope: { errors: [] } } as unknown as RunCommandOutput);
      releaseWorking?.({ exitCode: 0, envelope: { errors: [] } } as unknown as RunCommandOutput);
      vi.useRealTimers();
      io.stdin.end();
      await running;
    }
  });

  it('counts runtime events without a progress token and collapses terminal statusMessage (TEST-C1)', async () => {
    serverFake.useReal = true;
    let releaseRun!: (value: RunCommandOutput) => void;
    let emitEvent!: (event: unknown) => void;
    vi.mocked(runRunCommand).mockImplementationOnce((input) => {
      emitEvent = (event) => { void input.events?.emit(event as Parameters<NonNullable<typeof input.events>['emit']>[0]); };
      return new Promise<RunCommandOutput>((resolve) => { releaseRun = trackRelease(resolve); });
    });
    const io = streams();
    const directory = await fixtureDirectory();
    const running = runMcpCommand({ dir: directory, syncWaitMs: 1, ...io });
    await initialize(io);
    sendRequest(io, 1, 'ambercast_run');
    const job = assertRecordResponse((await responseSoon(io, 1)).result, { tool: 'run', status: 'working', statusMessage: 'running', progress: 0 });
    emitEvent({ type: 'step-start', stepId: 'step-1' });
    sendRequest(io, 2, 'ambercast_job_status', { jobId: job.jobId });
    expect(((await response(io, 2)).result as Record<string, unknown>).structuredContent).toMatchObject({
      progress: 1, statusMessage: 'run: step step-1 started',
    });
    emitEvent({ type: 'step-result', stepId: 'step-1', via: 'grounding' });
    sendRequest(io, 3, 'ambercast_job_status', { jobId: job.jobId });
    expect(((await response(io, 3)).result as Record<string, unknown>).structuredContent).toMatchObject({
      progress: 2, statusMessage: 'run: step step-1 started',
    });
    releaseRun({ exitCode: 0, envelope: { errors: [] } } as unknown as RunCommandOutput);
    sendRequest(io, 5, 'ambercast_job_status', { jobId: job.jobId, waitMs: 1000 });
    await response(io, 5);
    sendRequest(io, 4, 'ambercast_job_cancel', { jobId: job.jobId });
    assertRecordResponse((await response(io, 4)).result, { tool: 'run', status: 'completed', statusMessage: 'completed', progress: 2 });
    io.stdin.end();
    expect(await running).toBe(0);
  });

  it('does not queue job listing or missing-job cancellation behind a pending write (TEST-C6)', async () => {
    serverFake.useReal = true;
    let releaseRun!: (value: RunCommandOutput) => void;
    vi.mocked(runRunCommand).mockImplementationOnce(() => new Promise<RunCommandOutput>((resolve) => { releaseRun = trackRelease(resolve); }));
    const io = streams();
    const directory = await fixtureDirectory();
    const running = runMcpCommand({ dir: directory, syncWaitMs: 1, ...io });
    await initialize(io);
    sendRequest(io, 1, 'ambercast_run');
    const job = assertRecordResponse((await responseSoon(io, 1)).result, { tool: 'run', status: 'working', statusMessage: 'running', progress: 0 });
    sendRequest(io, 2, 'ambercast_job_status');
    sendRequest(io, 3, 'ambercast_job_cancel', { jobId: 'missing-job' });
    try {
      expect((await responseSoon(io, 2)).result).toMatchObject({ isError: false });
      expect((await responseSoon(io, 3)).result).toMatchObject({ isError: true, content: [{ type: 'text', text: 'JOB_NOT_FOUND: missing-job' }] });
      expect(runRunCommand).toHaveBeenCalledTimes(1);
      expect(job.status).toBe('working');
    } finally {
      releaseRun({ exitCode: 0, envelope: { errors: [] } } as unknown as RunCommandOutput);
      io.stdin.end();
      await running;
    }
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

  it('sends an interrupted heal apply response before leaving elicitation drain (TEST-A1)', async () => {
    serverFake.useReal = true;
    const interrupted = {
      exitCode: 4,
      envelope: { results: [{ id: 'sample.test.md', application: 'interrupted' }], errors: [{ scope: 'heal', code: 'INTERRUPTED' }] },
    } as unknown as HealCommandOutput;
    const settle = vi.fn(async (confirm: 'authorized' | 'declined' | 'interrupted') => {
      expect(confirm).toBe('interrupted');
      return interrupted;
    });
    vi.mocked(prepareHeal).mockResolvedValueOnce({
      hasCommits: true,
      cases: [{ caseId: 'case-1', file: 'sample.test.md', healingSummary: 'repair' }],
      preview: () => healOutput(),
      settle,
    });
    const io = streams();
    const directory = await fixtureDirectory();
    const running = runMcpCommand({ dir: directory, syncWaitMs: 45_000, ...io });
    io.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1000, method: 'initialize', params: {
      protocolVersion: '2025-03-26', capabilities: { elicitation: { form: {} } }, clientInfo: { name: 'job-test', version: '1' },
    } })}\n`);
    await response(io, 1000);
    io.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    sendRequest(io, 1, 'ambercast_heal', { dryRun: true });
    const preview = (await response(io, 1)).result as Record<string, unknown>;
    const token = (preview._meta as Record<string, unknown>).applyToken;
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    sendRequest(io, 2, 'ambercast_heal', { dryRun: false, applyToken: token });
    await vi.waitFor(() => expect(io.output()).toContain('"method":"elicitation/create"'));
    const started = Date.now();
    process.emit('SIGTERM');
    expect(await running).toBe(0);
    expect(Date.now() - started).toBeLessThan(10_000);
    const applyResponses = io.output().split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((message) => message.id === 2);
    expect(applyResponses).toHaveLength(1);
    expect((applyResponses[0]!.result as Record<string, unknown>).structuredContent).toEqual(interrupted.envelope);
    expect(settle).toHaveBeenCalledExactlyOnceWith('interrupted');
  });

  it('sends an interrupted heal apply response before leaving write FIFO drain (TEST-A1)', async () => {
    serverFake.useReal = true;
    abortAfterOneMacrotask();
    const interrupted = {
      exitCode: 4,
      envelope: { results: [{ id: 'sample.test.md', application: 'interrupted' }], errors: [{ scope: 'heal', code: 'INTERRUPTED' }] },
    } as unknown as HealCommandOutput;
    const settle = vi.fn(async (confirm: 'authorized' | 'declined' | 'interrupted') => {
      expect(confirm).toBe('interrupted');
      return interrupted;
    });
    vi.mocked(prepareHeal).mockResolvedValueOnce({
      hasCommits: true,
      cases: [{ caseId: 'case-1', file: 'sample.test.md', healingSummary: 'repair' }],
      preview: () => healOutput(),
      settle,
    });
    const io = streams();
    const directory = await fixtureDirectory();
    const running = runMcpCommand({ dir: directory, syncWaitMs: 45_000, ...io });
    await initialize(io);
    sendRequest(io, 1, 'ambercast_heal', { dryRun: true });
    const preview = (await response(io, 1)).result as Record<string, unknown>;
    const token = (preview._meta as Record<string, unknown>).applyToken;
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    sendRequest(io, 2, 'ambercast_run');
    await vi.waitFor(() => expect(runRunCommand).toHaveBeenCalledTimes(1));
    sendRequest(io, 3, 'ambercast_heal', { dryRun: false, applyToken: token });
    await vi.waitFor(() => expect(io.errors()).toContain('heal apply authorized'));
    expect(settle).not.toHaveBeenCalled();
    expect(io.output()).not.toMatch(/"id":3[,}]/);
    const started = Date.now();
    process.emit('SIGTERM');
    expect(await running).toBe(0);
    expect(Date.now() - started).toBeLessThan(10_000);
    const applyResponses = io.output().split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((message) => message.id === 3);
    expect(applyResponses).toHaveLength(1);
    expect((applyResponses[0]!.result as Record<string, unknown>).structuredContent).toEqual(interrupted.envelope);
    expect(settle).toHaveBeenCalledExactlyOnceWith('interrupted');
    assertInterruptedRun(responseNow(io, 2).result);
  });

  it('waits through a delayed runtime abort and sends its synchronous run response (TEST-A2)', async () => {
    serverFake.useReal = true;
    abortAfterOneMacrotask();
    const io = streams();
    const directory = await fixtureDirectory();
    const running = runMcpCommand({ dir: directory, syncWaitMs: 45_000, ...io });
    await initialize(io);
    sendRequest(io, 1, 'ambercast_run');
    await vi.waitFor(() => expect(runRunCommand).toHaveBeenCalledTimes(1));
    process.emit('SIGTERM');
    expect(await running).toBe(0);
    assertInterruptedRun(responseNow(io, 1).result);
  });

  it('sends the active interrupted run and a queued shutdown record (TEST-A3)', async () => {
    serverFake.useReal = true;
    abortAfterOneMacrotask();
    const io = streams();
    const directory = await fixtureDirectory();
    const running = runMcpCommand({ dir: directory, syncWaitMs: 45_000, ...io });
    await initialize(io);
    sendRequest(io, 1, 'ambercast_run');
    await vi.waitFor(() => expect(runRunCommand).toHaveBeenCalledTimes(1));
    sendRequest(io, 2, 'ambercast_run');
    expect(runRunCommand).toHaveBeenCalledTimes(1);
    process.emit('SIGTERM');
    expect(await running).toBe(0);
    assertInterruptedRun(responseNow(io, 1).result);
    assertRecordResponse(responseNow(io, 2).result, {
      tool: 'run', status: 'cancelled', statusMessage: 'server shutting down', progress: 0,
    });
    expect(runRunCommand).toHaveBeenCalledTimes(1);
  });

  it('removes a valid client-cancelled request before the runtime abort settles (TEST-A5)', async () => {
    serverFake.useReal = true;
    abortAfterOneMacrotask();
    const io = streams();
    const directory = await fixtureDirectory();
    const running = runMcpCommand({ dir: directory, syncWaitMs: 45_000, ...io });
    await initialize(io);
    sendRequest(io, 1, 'ambercast_run');
    await vi.waitFor(() => expect(runRunCommand).toHaveBeenCalledTimes(1));
    vi.useFakeTimers();
    let returned: number | undefined;
    void running.then((code) => { returned = code; });
    try {
      io.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1, reason: 'client cancelled' } })}\n`);
      await vi.advanceTimersByTimeAsync(0);
      sendRequest(io, 2, 'ambercast_run');
      await vi.advanceTimersByTimeAsync(0);
      process.emit('SIGTERM');
      await vi.advanceTimersByTimeAsync(51);
      expect(returned).toBe(0);
      expect(io.output().split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>).filter((message) => message.id === 1)).toEqual([]);
      assertRecordResponse(responseNow(io, 2).result, {
        tool: 'run', status: 'cancelled', statusMessage: 'server shutting down', progress: 0,
      });
    } finally {
      await vi.advanceTimersByTimeAsync(10_001);
      vi.useRealTimers();
      await running;
    }
  });

  it('ignores cancellation with requestId zero and sends that request before exit (TEST-A5)', async () => {
    serverFake.useReal = true;
    abortAfterOneMacrotask();
    const io = streams();
    const directory = await fixtureDirectory();
    const running = runMcpCommand({ dir: directory, syncWaitMs: 45_000, ...io });
    await initialize(io);
    sendRequest(io, 0, 'ambercast_run');
    await vi.waitFor(() => expect(runRunCommand).toHaveBeenCalledTimes(1));
    io.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 0 } })}\n`);
    process.emit('SIGTERM');
    expect(await running).toBe(0);
    assertInterruptedRun(responseNow(io, 0).result);
  });

  it('retains one response for two requests sharing an id after one cancellation (TEST-A5)', async () => {
    serverFake.useReal = true;
    abortAfterOneMacrotask();
    const io = streams();
    const directory = await fixtureDirectory();
    const running = runMcpCommand({ dir: directory, syncWaitMs: 45_000, ...io });
    await initialize(io);
    sendRequest(io, 1, 'ambercast_run');
    await vi.waitFor(() => expect(runRunCommand).toHaveBeenCalledTimes(1));
    sendRequest(io, 1, 'ambercast_run');
    io.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } })}\n`);
    process.emit('SIGTERM');
    expect(await running).toBe(0);
    const replies = io.output().split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((message) => message.id === 1);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toHaveProperty('result');
  });

  it('keeps a request forwarded in the same synchronous call as SIGTERM in flight (TEST-A6)', async () => {
    serverFake.useReal = true;
    abortAfterOneMacrotask();
    const io = streams();
    const directory = await fixtureDirectory();
    const running = runMcpCommand({ dir: directory, syncWaitMs: 45_000, ...io });
    await initialize(io);
    const sendAndDrain = (): void => {
      sendRequest(io, 1, 'ambercast_run');
      process.emit('SIGTERM');
    };
    sendAndDrain();
    expect(await running).toBe(0);
    expect(responseNow(io, 1)).toHaveProperty('result');
  });

  it('does not retain invalid or non-request lines in the shutdown ledger (TEST-A6)', async () => {
    serverFake.useReal = true;
    const io = streams();
    const directory = await fixtureDirectory();
    const running = runMcpCommand({ dir: directory, syncWaitMs: 45_000, ...io });
    await initialize(io);
    sendRequest(io, 1, 'ambercast_unknown');
    sendRequest(io, 2, 'ambercast_run', { bogus: 1 });
    const unknown = await response(io, 1);
    const invalidArguments = await response(io, 2);
    expect(unknown).toMatchObject({ result: { isError: true } });
    expect(invalidArguments).toMatchObject({ result: { isError: true } });
    expect(unknown).not.toHaveProperty('error');
    expect(invalidArguments).not.toHaveProperty('error');
    const started = Date.now();
    process.emit('SIGTERM');
    expect(await running).toBe(0);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(runRunCommand).not.toHaveBeenCalled();
  });

  it.each([
    ['broken JSON', '{broken json\n', undefined],
    ['missing jsonrpc', `${JSON.stringify({ id: 3, method: 'tools/call', params: { name: 'ambercast_run', arguments: {} } })}\n`, 3],
    ['fractional id', `${JSON.stringify({ jsonrpc: '2.0', id: 1.5, method: 'tools/call', params: { name: 'ambercast_run', arguments: {} } })}\n`, 1.5],
  ])('does not count %s as a request during drain (TEST-A6)', async (_label, line, invalidId) => {
    serverFake.useReal = true;
    const io = streams();
    const directory = await fixtureDirectory();
    const running = runMcpCommand({ dir: directory, syncWaitMs: 45_000, ...io });
    await initialize(io);
    io.stdin.write(line);
    await new Promise<void>((resolve) => setImmediate(resolve));
    const started = Date.now();
    process.emit('SIGTERM');
    expect(await running).toBe(0);
    expect(Date.now() - started).toBeLessThan(10_000);
    const replies = io.output().split('\n').filter(Boolean).map((entry) => JSON.parse(entry) as Record<string, unknown>);
    expect(replies.filter((message) => message.id === invalidId)).toEqual([]);
    expect(runRunCommand).not.toHaveBeenCalled();
  });

  it('leaves the ledger after invoking a lower send whose write never completes (TEST-A6)', async () => {
    serverFake.useReal = true;
    const writes: string[] = [];
    let hold = false;
    const pending = new Writable({ highWaterMark: 1, write(chunk, _encoding, callback) {
      writes.push(String(chunk));
      if (!hold) callback();
    } });
    const io = { ...streams(), stdout: pending as unknown as PassThrough, output: () => writes.join('') };
    const directory = await fixtureDirectory();
    const running = runMcpCommand({ dir: directory, syncWaitMs: 45_000, ...io });
    await initialize(io);
    hold = true;
    sendRequest(io, 1, 'ambercast_unknown');
    await vi.waitFor(() => expect(writes.some((line) => line.includes('"id":1'))).toBe(true));
    process.emit('SIGTERM');
    expect(await running).toBe(0);
    const atClose = writes.length;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(writes).toHaveLength(atClose);
    expect((responseNow(io, 1).result as Record<string, unknown>).isError).toBe(true);
  });

  it('sends the interrupted terminal job_status response before drain returns (TEST-A7)', async () => {
    serverFake.useReal = true;
    abortAfterOneMacrotask();
    const io = streams();
    const directory = await fixtureDirectory();
    const running = runMcpCommand({ dir: directory, syncWaitMs: 1, ...io });
    await initialize(io);
    sendRequest(io, 1, 'ambercast_run');
    const job = assertRecordResponse((await responseSoon(io, 1)).result, {
      tool: 'run', status: 'working', statusMessage: 'running', progress: 0,
    });
    sendRequest(io, 2, 'ambercast_job_status', { jobId: job.jobId, waitMs: 45_000 });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(io.output()).not.toMatch(/"id":2[,}]/);
    process.emit('SIGTERM');
    expect(await running).toBe(0);
    const result = responseNow(io, 2).result as Record<string, unknown>;
    assertInterruptedRun(result);
    expect(result).toMatchObject({ _meta: { job: { jobId: job.jobId, status: 'cancelled' } } });
  });

  it('sends an interrupted run response before EOF-triggered drain returns (TEST-A9)', async () => {
    serverFake.useReal = true;
    abortAfterOneMacrotask();
    const io = streams();
    const directory = await fixtureDirectory();
    const running = runMcpCommand({ dir: directory, syncWaitMs: 45_000, ...io });
    await initialize(io);
    sendRequest(io, 1, 'ambercast_run');
    await vi.waitFor(() => expect(runRunCommand).toHaveBeenCalledTimes(1));
    io.stdin.end();
    expect(await running).toBe(0);
    assertInterruptedRun(responseNow(io, 1).result);
  });
  it('waits for an in-flight heal apply settlement before shutdown completes (TEST-B9)', async () => {
    const session = await proposalSession();
    let release!: (output: HealCommandOutput) => void;
    const blocked = new Promise<HealCommandOutput>((resolve) => { release = resolve; });
    const { settle } = queuePreparation(vi.fn(async () => blocked));
    const token = await issuedToken(session.deps);
    expect(await session.deps.beginHealApply!(token)).toMatchObject({ proceed: true });
    const pending = session.deps.settleHealApply!(token, 'authorized');
    await vi.waitFor(() => expect(settle).toHaveBeenCalledTimes(1));
    let closed = false;
    const closing = session.close().then(() => { closed = true; });
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(closed).toBe(false);
    } finally {
      release(healOutput());
      await pending;
      await closing;
    }
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

  it('issues a 32-character lowercase hex token whenever preparation has commits (TEST-D1)', async () => {
    clockFake.elapsed = 100;
    const session = await proposalSession();
    try {
      queuePreparation();
      const token = await issuedToken(session.deps);
      expect(token).toMatch(/^[0-9a-f]{32}$/);
      vi.mocked(prepareHeal).mockResolvedValueOnce({
        hasCommits: false, cases: [], preview: () => healOutput(),
        settle: vi.fn(async () => healOutput()),
      });
      const unchanged = await session.deps.healPreview({}, noProgress);
      expect(unchanged.applyToken).toBeUndefined();
      queuePreparation(vi.fn(async () => healOutput()), healOutput(2, [{ code: 'PREVIEW_FAILED' }]));
      const failed = await session.deps.healPreview({}, noProgress);
      expect(failed.applyToken).toMatch(/^[0-9a-f]{32}$/);
      vi.mocked(prepareHeal).mockResolvedValueOnce({
        hasCommits: true, cases: [],
        preview: () => { throw new Error('preview rendering crashed'); },
        settle: vi.fn(async () => healOutput()),
      });
      await expect(session.deps.healPreview({}, noProgress)).rejects.toThrow('preview rendering crashed');
      vi.mocked(prepareHeal).mockRejectedValueOnce(new Error('preview crashed'));
      await expect(session.deps.healPreview({}, noProgress)).rejects.toThrow('preview crashed');
      expectTokenError(await session.deps.applyHeal!(token, 'declined'), 'superseded');
      expect(await session.deps.applyHeal!(failed.applyToken!, 'declined')).toMatchObject({ kind: 'report' });
    } finally {
      await session.close();
    }
  });

  it('supersedes older pending tokens at issuance even if their delivery TTL later elapses (TEST-D1, TEST-D4)', async () => {
    clockFake.elapsed = 1_000;
    const session = await proposalSession();
    try {
      const first = queuePreparation();
      const oldToken = await issuedToken(session.deps);
      session.deps.markHealDelivered!(oldToken);
      queuePreparation();
      const newToken = await issuedToken(session.deps);
      expect(newToken).not.toBe(oldToken);
      clockFake.elapsed = 601_000;
      expectTokenError(await session.deps.applyHeal!(oldToken, 'authorized'), 'superseded');
      expect(first.settle).not.toHaveBeenCalled();
    } finally {
      await session.close();
    }
  });

  it('reports a missing token as unknown before any expiry or consumption check (TEST-D4)', async () => {
    clockFake.elapsed = 700_000;
    const session = await proposalSession();
    try {
      expect(await session.deps.applyHeal!('f'.repeat(32), 'authorized')).toEqual({
        kind: 'error', code: 'HEAL_APPLY_TOKEN_INVALID', message: 'unknown-token',
      });
    } finally {
      await session.close();
    }
  });

  it('settles a token consumed before confirmation even after the pending TTL passes', async () => {
    clockFake.elapsed = 1_000;
    const session = await proposalSession();
    try {
      const { settle } = queuePreparation();
      const token = await issuedToken(session.deps);
      session.deps.markHealDelivered!(token);
      expect(await session.deps.beginHealApply!(token)).toEqual({
        proceed: true, cases: [{ file: 'sample.test.md', healingSummary: 'repair' }],
      });
      clockFake.elapsed = 601_001;
      expect(await session.deps.settleHealApply!(token, 'authorized')).toMatchObject({ kind: 'report', exitCode: 0 });
      expect(settle).toHaveBeenCalledExactlyOnceWith('authorized');
    } finally {
      await session.close();
    }
  });

  it.each([
    { offset: 599_999, expired: false },
    { offset: 600_000, expired: false },
    { offset: 600_001, expired: true },
  ])('uses the exact deliveredAt TTL boundary at $offset ms (TEST-D4)', async ({ offset, expired }) => {
    clockFake.elapsed = 2_000;
    const session = await proposalSession();
    try {
      const { settle } = queuePreparation();
      const token = await issuedToken(session.deps);
      session.deps.markHealDelivered!(token);
      clockFake.elapsed = 2_000 + offset;
      const outcome = await session.deps.applyHeal!(token, 'authorized');
      if (expired) {
        expectTokenError(outcome, 'expired');
        expect(settle).not.toHaveBeenCalled();
      } else {
        expect(outcome).toMatchObject({ kind: 'report', exitCode: 0 });
        expect(settle).toHaveBeenCalledExactlyOnceWith('authorized');
      }
    } finally {
      await session.close();
    }
  });

  it('keeps the first deliveredAt when the same token is marked delivered again (TEST-D2)', async () => {
    clockFake.elapsed = 1_000;
    const session = await proposalSession();
    try {
      const { settle } = queuePreparation();
      const token = await issuedToken(session.deps);
      session.deps.markHealDelivered!(token);
      clockFake.elapsed = 500_000;
      session.deps.markHealDelivered!(token);
      clockFake.elapsed = 601_001;
      expectTokenError(await session.deps.applyHeal!(token, 'authorized'), 'expired');
      expect(settle).not.toHaveBeenCalled();
    } finally {
      await session.close();
    }
  });

  it('returns an error outcome if settlement throws (TEST-D4)', async () => {
    clockFake.elapsed = 1_000;
    const session = await proposalSession();
    try {
      const settle = vi.fn(async (): Promise<HealCommandOutput> => { throw new TypeError('secret path: preimage changed'); });
      queuePreparation(settle);
      const token = await issuedToken(session.deps);
      session.deps.markHealDelivered!(token);
      const outcome = await session.deps.applyHeal!(token, 'authorized');
      expect(outcome).toEqual({
        kind: 'error', code: 'HEAL_APPLY_FAILED', message: 'the apply crashed unexpectedly (TypeError)',
      });
      expect(await session.deps.applyHeal!(token, 'authorized')).toEqual(outcome);
      expect(settle).toHaveBeenCalledExactlyOnceWith('authorized');
    } finally {
      await session.close();
    }
  });

  it('preserves a partial preimage failure report as an error exit, never a successful apply (TEST-D4)', async () => {
    clockFake.elapsed = 1_000;
    const session = await proposalSession();
    try {
      const partial = healOutput(2, [{ caseId: 'case-1', code: 'PREIMAGE_CHANGED' }]);
      queuePreparation(vi.fn(async () => partial));
      const token = await issuedToken(session.deps);
      session.deps.markHealDelivered!(token);
      expect(await session.deps.applyHeal!(token, 'authorized')).toMatchObject({
        kind: 'report', exitCode: 2, envelope: { errors: [{ code: 'PREIMAGE_CHANGED' }] },
      });
    } finally {
      await session.close();
    }
  });

  it('settles interrupted before authorization when its signal is already aborted (TEST-D4)', async () => {
    clockFake.elapsed = 1_000;
    const session = await proposalSession();
    try {
      const { settle } = queuePreparation();
      const token = await issuedToken(session.deps);
      session.deps.markHealDelivered!(token);
      const controller = new AbortController();
      controller.abort();
      await session.deps.applyHeal!(token, 'authorized', controller.signal);
      expect(settle).toHaveBeenCalledExactlyOnceWith('interrupted');
      expect(settle).not.toHaveBeenCalledWith('authorized');
    } finally {
      await session.close();
    }
  });

  it('keeps authorized settlement running after a later abort and stores the final output (TEST-D4, TEST-D6)', async () => {
    clockFake.elapsed = 1_000;
    const session = await proposalSession();
    let finish: ((value: HealCommandOutput) => void) | undefined;
    try {
      const settle = vi.fn(() => new Promise<HealCommandOutput>((resolve) => { finish = resolve; }));
      queuePreparation(settle);
      const token = await issuedToken(session.deps);
      session.deps.markHealDelivered!(token);
      const controller = new AbortController();
      const applying = session.deps.applyHeal!(token, 'authorized', controller.signal);
      await vi.waitFor(() => expect(settle).toHaveBeenCalledExactlyOnceWith('authorized'));
      controller.abort();
      const report = healOutput();
      finish!(report);
      expect(await applying).toEqual({ kind: 'report', ...report });
      expect(await session.deps.applyHeal!(token, 'authorized')).toEqual({ kind: 'report', ...report });
      expect(settle).toHaveBeenCalledTimes(1);
    } finally {
      finish?.(healOutput());
      await session.close();
    }
  });

  it('replays a consumed token without invoking settle a second time (TEST-D6)', async () => {
    clockFake.elapsed = 1_000;
    const session = await proposalSession();
    try {
      const { settle } = queuePreparation();
      const token = await issuedToken(session.deps);
      session.deps.markHealDelivered!(token);
      const first = await session.deps.applyHeal!(token, 'authorized');
      clockFake.elapsed = 2_000;
      const replay = await session.deps.applyHeal!(token, 'declined');
      expect(replay).toEqual(first);
      expect(settle).toHaveBeenCalledExactlyOnceWith('authorized');
    } finally {
      await session.close();
    }
  });

  it('coalesces a concurrent apply into the first in-flight settlement (TEST-D6)', async () => {
    clockFake.elapsed = 1_000;
    const session = await proposalSession();
    let finish: ((value: HealCommandOutput) => void) | undefined;
    try {
      const settle = vi.fn(() => new Promise<HealCommandOutput>((resolve) => { finish = resolve; }));
      queuePreparation(settle);
      const token = await issuedToken(session.deps);
      session.deps.markHealDelivered!(token);
      const first = session.deps.applyHeal!(token, 'authorized');
      const second = session.deps.applyHeal!(token, 'authorized');
      await vi.waitFor(() => expect(settle).toHaveBeenCalledTimes(1));
      finish!(healOutput());
      expect(await second).toEqual(await first);
      expect(settle).toHaveBeenCalledTimes(1);
    } finally {
      finish?.(healOutput());
      await session.close();
    }
  });

  it('keeps consumed-token replay pending throughout confirmation before settlement (TEST-D6)', async () => {
    const session = await proposalSession();
    try {
      const { settle } = queuePreparation();
      const token = await issuedToken(session.deps);
      expect((await session.deps.beginHealApply!(token)).proceed).toBe(true);
      let replayReturned = false;
      const replay = session.deps.beginHealApply!(token).then((value) => { replayReturned = true; return value; });
      await Promise.resolve();
      expect(replayReturned).toBe(false);
      expect(settle).not.toHaveBeenCalled();
      const first = await session.deps.settleHealApply!(token, 'declined');
      expect(replayReturned).toBe(false);
      session.deps.finalizeHealApply!(token);
      expect(await replay).toEqual({ proceed: false, outcome: first });
      expect(settle).toHaveBeenCalledExactlyOnceWith('declined');
    } finally {
      await session.close();
    }
  });

  it('stores unexpected confirmation failures for consumed-token replay without exposing error text (TEST-D4, TEST-D6)', async () => {
    const session = await proposalSession();
    try {
      const { settle } = queuePreparation();
      const token = await issuedToken(session.deps);
      expect((await session.deps.beginHealApply!(token)).proceed).toBe(true);
      const failure = await session.deps.failHealApply!(token, new RangeError('private provider output'));
      expect(failure).toEqual({ kind: 'error', code: 'HEAL_APPLY_FAILED', message: 'the apply crashed unexpectedly (RangeError)' });
      expect(await session.deps.beginHealApply!(token)).toEqual({ proceed: false, outcome: failure });
      expect(settle).not.toHaveBeenCalled();
    } finally {
      await session.close();
    }
  });

  it('replaces a settled report if response rendering fails, then replays that error (TEST-D4, TEST-D6)', async () => {
    const session = await proposalSession();
    try {
      queuePreparation();
      const token = await issuedToken(session.deps);
      expect((await session.deps.beginHealApply!(token)).proceed).toBe(true);
      expect(await session.deps.settleHealApply!(token, 'authorized')).toMatchObject({ kind: 'report', exitCode: 0 });
      const failure = await session.deps.failHealApply!(token, new SyntaxError('private rendering details'));
      expect(failure).toEqual({
        kind: 'error', code: 'HEAL_APPLY_FAILED', message: 'the apply crashed unexpectedly (SyntaxError)',
      });
      expect(await session.deps.beginHealApply!(token)).toEqual({ proceed: false, outcome: failure });
      expect(await session.deps.failHealApply!(token, new TypeError('later failure'))).toEqual(failure);
    } finally {
      await session.close();
    }
  });

  it('holds concurrent replay after settlement until the response renders (TEST-D6)', async () => {
    const session = await proposalSession();
    try {
      queuePreparation();
      const token = await issuedToken(session.deps);
      expect((await session.deps.beginHealApply!(token)).proceed).toBe(true);
      const report = await session.deps.settleHealApply!(token, 'authorized');
      let replayReturned = false;
      const replay = session.deps.beginHealApply!(token).then((value) => { replayReturned = true; return value; });
      await Promise.resolve();
      expect(replayReturned).toBe(false);
      session.deps.finalizeHealApply!(token);
      expect(await replay).toEqual({ proceed: false, outcome: report });
    } finally {
      await session.close();
    }
  });

  it('forwards settlement events to the apply request progress token (TEST-B7, TEST-D4)', async () => {
    const session = await proposalSession();
    try {
      vi.mocked(prepareHeal).mockImplementationOnce(async (input) => ({
        hasCommits: true,
        cases: [{ caseId: 'case-1', file: 'sample.test.md', healingSummary: 'repair' }],
        preview: () => healOutput(),
        settle: vi.fn(async () => {
          input.events?.emit({ type: 'ai-result', callId: 'call-1', durationMs: 1, outcome: 'ok' });
          return healOutput();
        }),
      }));
      const token = await issuedToken(session.deps);
      expect((await session.deps.beginHealApply!(token)).proceed).toBe(true);
      const notifications: unknown[] = [];
      await session.deps.settleHealApply!(token, 'authorized', undefined, {
        progressToken: 'apply-progress',
        sendNotification: async (notification) => { notifications.push(notification); },
      });
      expect(notifications).toContainEqual({
        method: 'notifications/progress',
        params: { progressToken: 'apply-progress', progress: 1, message: 'heal: ai call done (ok)' },
      });
    } finally {
      await session.close();
    }
  });

  it.each([
    { offset: 599_999, expired: false },
    { offset: 600_000, expired: false },
    { offset: 600_001, expired: true },
  ])('anchors consumed replay to settledAt at $offset ms, independently of deliveredAt (TEST-D6)', async ({ offset, expired }) => {
    clockFake.elapsed = 1_000;
    const session = await proposalSession();
    try {
      const { settle } = queuePreparation();
      const token = await issuedToken(session.deps);
      session.deps.markHealDelivered!(token);
      clockFake.elapsed = 500_000;
      const first = await session.deps.applyHeal!(token, 'authorized');
      clockFake.elapsed = 500_000 + offset;
      const replay = await session.deps.applyHeal!(token, 'authorized');
      if (expired) expectTokenError(replay, 'expired');
      else expect(replay).toEqual(first);
      expect(settle).toHaveBeenCalledTimes(1);
    } finally {
      await session.close();
    }
  });

  // Each runMcpCommand session creates a local HealProposalStore. Two calls
  // model separate MCP processes with independent stores and no shared token state.
  it('treats a token from an independent process-like MCP session store as unknown (TEST-D7)', async () => {
    clockFake.elapsed = 1_000;
    const first = await proposalSession();
    try {
      queuePreparation();
      const token = await issuedToken(first.deps);
      first.deps.markHealDelivered!(token);
      const second = await proposalSession();
      try {
        expectTokenError(await second.deps.applyHeal!(token, 'authorized'), 'unknown');
      } finally {
        await second.close();
      }
    } finally {
      await first.close();
    }
  });
});
