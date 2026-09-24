import { PassThrough } from 'node:stream';
import { setImmediate } from 'node:timers/promises';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema, type ClientCapabilities, type ElicitRequest, type ElicitResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMcpServer } from '#adapters/mcp/server.js';
import type { McpServerDeps } from '#adapters/mcp/types.js';
import { createSystemClock } from '#adapters/system/system-clock.js';
import type { Clock } from '#ports/system.js';

const toolNames = [
  'ambercast_generate',
  'ambercast_run',
  'ambercast_check',
  'ambercast_heal',
  'ambercast_job_status',
  'ambercast_job_cancel',
] as const;

function fakeDeps(overrides: Partial<McpServerDeps> = {}): McpServerDeps {
  const success = async () => ({ exitCode: 0, envelope: { summary: 'ok' } });
  const fake = <T extends (...args: any[]) => Promise<any>>(impl: T = success as T): T => new Proxy(vi.fn(impl), {
    apply(target, thisArg, [input]) {
      return Reflect.apply(target, thisArg, [input]);
    },
  }) as T;
  const applySuccess = async (_token: string, confirm: 'authorized' | 'declined' | 'interrupted') => {
    if (confirm === 'authorized') return { kind: 'report' as const, exitCode: 0, envelope: { summary: 'applied' } };
    if (confirm === 'declined') return { kind: 'report' as const, exitCode: 0, envelope: { summary: 'declined' } };
    return { kind: 'report' as const, exitCode: 1, envelope: { summary: 'interrupted' } };
  };
  return {
    sessionRoot: '/workspace',
    version: '0.6.0',
    stderr: new PassThrough(),
    generate: fake(),
    run: fake(),
    check: fake(),
    healPreview: fake(),
    applyHeal: fake(applySuccess),
    ...overrides,
  };
}

type ConnectedServer = ReturnType<typeof createMcpServer>;
const connections: Array<{ client: Client; server: ConnectedServer }> = [];

async function connect(
  deps: McpServerDeps,
  options?: { readonly signal?: AbortSignal; readonly syncWaitMs?: number; readonly clock?: Clock },
  clientOptions?: { capabilities?: ClientCapabilities; onElicit?: (request: ElicitRequest) => ElicitResult | Promise<ElicitResult> },
): Promise<Client> {
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(deps, { ...options, clock: options?.clock ?? createSystemClock() });
  const client = new Client({ name: 'ambercast-server-test', version: '1.0.0' }, clientOptions?.capabilities === undefined ? {} : { capabilities: clientOptions.capabilities });
  if (clientOptions?.onElicit !== undefined) client.setRequestHandler(ElicitRequestSchema, clientOptions.onElicit);
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  connections.push({ client, server });
  return client;
}

afterEach(async () => {
  for (const { client, server } of connections.splice(0)) {
    await client.close();
    await server.close();
  }
});

describe('mcp/server', () => {
  it('introduces the required purpose and workflow guidance in the initialization instructions (TEST-B2)', async () => {
    const client = await connect(fakeDeps());
    const instructions = client.getInstructions();

    expect(instructions).toBeDefined();
    expect(instructions).toMatch(/^Use this server to run and repair keystroke E2E tests with ambercast/);
    expect(instructions!.length).toBeLessThanOrEqual(300);
    expect(instructions).toMatch(/^[\x20-\x7E]+$/);
    for (const name of ['generate', 'run', 'check', 'heal', 'job_status', 'job_cancel']) {
      expect(instructions).toContain(name);
    }
  });

  it('consumes at FIFO admission before elicitation crosses the pending TTL', async () => {
    const token = 'a'.repeat(32);
    const applyArgs = { dryRun: false, applyToken: token };
    let elapsed = 1_000;
    const clock: Clock = { now: () => new Date(0), monotonicMs: () => elapsed };
    const beginHealApply = vi.fn(async () => ({ proceed: true as const }));
    const settleHealApply = vi.fn(async () => ({ kind: 'report' as const, exitCode: 0, envelope: { applied: true } }));
    const onElicit = vi.fn(async () => {
      expect(beginHealApply).toHaveBeenCalledExactlyOnceWith(token, expect.anything());
      elapsed += 600_001;
      return { action: 'accept' as const, content: { confirm: true } };
    });
    const client = await connect(fakeDeps({ beginHealApply, settleHealApply }), { clock }, { capabilities: { elicitation: { form: {} } }, onElicit });
    const result = await client.callTool({ name: 'ambercast_heal', arguments: applyArgs });
    expect(result).toMatchObject({ isError: false, structuredContent: { applied: true } });
    expect(settleHealApply).toHaveBeenCalledExactlyOnceWith(token, 'authorized', expect.anything());
  });

  it('consumes and interrupts a queued apply on original-request abort before TTL expiry', async () => {
    const token = 'a'.repeat(32);
    const applyArgs = { dryRun: false, applyToken: token };
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    let elapsed = 0;
    const clock: Clock = { now: () => new Date(0), monotonicMs: () => elapsed };
    let consumed = false;
    const beginHealApply = vi.fn(async () => {
      if (consumed) return { proceed: false as const, outcome: { kind: 'report' as const, exitCode: 1, envelope: { interrupted: true } } };
      if (elapsed >= 600_000) return { proceed: false as const, outcome: { kind: 'error' as const, code: 'EXPIRED_TOKEN', message: 'expired' } };
      consumed = true;
      return { proceed: true as const };
    });
    const settleHealApply = vi.fn(async () => ({ kind: 'report' as const, exitCode: 1, envelope: { interrupted: true } }));
    const client = await connect(fakeDeps({
      run: vi.fn(async () => { entered(); await blocked; return { exitCode: 0, envelope: {} }; }),
      beginHealApply, settleHealApply,
    }), { clock });
    const first = client.callTool({ name: 'ambercast_run', arguments: {} });
    await started;
    const controller = new AbortController();
    const pending = client.callTool({ name: 'ambercast_heal', arguments: applyArgs }, undefined, { signal: controller.signal });
    try {
      await setImmediate();
      controller.abort();
      await pending.catch(() => undefined);
      await vi.waitFor(() => expect(settleHealApply).toHaveBeenCalledExactlyOnceWith(token, 'interrupted', expect.anything()));
      elapsed = 600_001;
      release();
      const replay = await client.callTool({ name: 'ambercast_heal', arguments: applyArgs });
      expect(replay).toMatchObject({ isError: false, structuredContent: { interrupted: true } });
      expect(beginHealApply).toHaveBeenCalledTimes(2);
      expect(settleHealApply).toHaveBeenCalledTimes(1);
      expect((await first).isError).toBe(false);
    } finally { release(); await first.catch(() => undefined); }
  });
  it('accepts the C3 maximum wait of 45000 ms', async () => {
    const client = await connect(fakeDeps());
    const result = await client.callTool({ name: 'ambercast_job_status', arguments: { jobId: 'missing', waitMs: 45_000 } });
    expect(result.content).toEqual([{ type: 'text', text: 'JOB_NOT_FOUND: missing' }]);
  });

  it('lists jobs newest first with one text line per job and a no jobs line', async () => {
    let wall = new Date('2026-01-01T00:00:00.000Z');
    const clock: Clock = { now: () => wall, monotonicMs: () => 0, sleep: async () => {} };
    const client = await connect(fakeDeps(), { clock });
    expect((await client.callTool({ name: 'ambercast_job_status', arguments: {} })).content).toEqual([{ type: 'text', text: 'no jobs' }]);
    const first = await client.callTool({ name: 'ambercast_run', arguments: {} });
    wall = new Date('2026-01-02T00:00:00.000Z');
    const second = await client.callTool({ name: 'ambercast_generate', arguments: {} });
    const third = await client.callTool({ name: 'ambercast_heal', arguments: {} });
    const listing = await client.callTool({ name: 'ambercast_job_status', arguments: {} });
    const firstId = (first._meta?.job as { jobId: string }).jobId;
    const secondId = (second._meta?.job as { jobId: string }).jobId;
    const thirdId = (third._meta?.job as { jobId: string }).jobId;
    expect((listing.structuredContent as { jobs: Array<{ jobId: string }> }).jobs.map((job) => job.jobId)).toEqual([[secondId, thirdId].sort()[0], [secondId, thirdId].sort()[1], firstId]);
    const newestLines = [[secondId, 'generate'], [thirdId, 'heal']].sort(([a], [b]) => a!.localeCompare(b!)).map(([id, tool]) => `${id} completed ${tool} 2026-01-02T00:00:00.000Z`);
    expect(listing.content).toEqual([{ type: 'text', text: `${newestLines.join('\n')}\n${firstId} completed run 2026-01-01T00:00:00.000Z` }]);
  });

  it('keeps the B7 progress phrase on the record without a client progress token', async () => {
    let send!: Parameters<McpServerDeps['run']>[1]['sendNotification'];
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const run = vi.fn(async (_input: unknown, progress: Parameters<McpServerDeps['run']>[1]) => {
      send = progress.sendNotification;
      await blocked;
      return { exitCode: 0, envelope: {} };
    });
    const client = await connect(fakeDeps({ run }), { syncWaitMs: 0 });
    const handle = await client.callTool({ name: 'ambercast_run', arguments: {} });
    const jobId = (handle.structuredContent as { jobId: string }).jobId;
    try {
      await send({ method: 'internal/run-event' });
      await send({ method: 'notifications/progress', params: { progressToken: jobId, progress: 1, message: 'run: step one started' } });
      const status = await client.callTool({ name: 'ambercast_job_status', arguments: { jobId } });
      expect(status.structuredContent).toMatchObject({ progress: 1, statusMessage: 'run: step one started' });
    } finally { release(); }
  });

  it('stops forwarding progress after a handle while continuing record updates', async () => {
    let send!: Parameters<McpServerDeps['run']>[1]['sendNotification'];
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const client = await connect(fakeDeps({ run: vi.fn(async (_input, progress) => {
      send = progress.sendNotification;
      await blocked;
      return { exitCode: 0, envelope: {} };
    }) }), { syncWaitMs: 0 });
    const received: unknown[] = [];
    const handle = await client.callTool({ name: 'ambercast_run', arguments: {} }, undefined, { onprogress: (notification) => { received.push(notification); } });
    const jobId = (handle.structuredContent as { jobId: string }).jobId;
    try {
      await send({ method: 'internal/run-event' });
      await send({ method: 'notifications/progress', params: { progressToken: jobId, progress: 1, message: 'run: later event' } });
      expect(received).toEqual([]);
      const status = await client.callTool({ name: 'ambercast_job_status', arguments: { jobId } });
      expect(status.structuredContent).toMatchObject({ progress: 1, statusMessage: 'run: later event' });
    } finally { release(); }
  });

  it('turns response rendering exceptions into failed jobs with the error name', async () => {
    const client = await connect(fakeDeps({ run: vi.fn(async () => ({ exitCode: 0, envelope: { toJSON: () => { throw new TypeError('secret detail'); } } })) }));
    const result = await client.callTool({ name: 'ambercast_run', arguments: {} });
    expect(result).toMatchObject({ isError: true, content: [{ type: 'text', text: 'JOB_FAILED: the job crashed unexpectedly (TypeError)' }], _meta: { job: { status: 'failed' } } });
  });

  it('expires terminal jobs using monotonic time despite wall-clock changes', async () => {
    let elapsed = 0;
    let wall = new Date('2026-01-01T00:00:00.000Z');
    const clock: Clock = { now: () => wall, monotonicMs: () => elapsed, sleep: async () => {} };
    const client = await connect(fakeDeps(), { clock });
    const result = await client.callTool({ name: 'ambercast_run', arguments: {} });
    const jobId = (result._meta?.job as { jobId: string }).jobId;
    elapsed = 1_800_000;
    wall = new Date('2025-01-01T00:00:00.000Z');
    const status = await client.callTool({ name: 'ambercast_job_status', arguments: { jobId } });
    expect(status.content).toEqual([{ type: 'text', text: `JOB_NOT_FOUND: ${jobId}` }]);
  });

  it('cancels a queued job when its original request aborts before FIFO release', async () => {
    let release!: () => void;
    let started!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const running = new Promise<void>((resolve) => { started = resolve; });
    const healPreview = vi.fn(async () => ({ exitCode: 0, envelope: {} }));
    const client = await connect(fakeDeps({
      run: vi.fn(async () => { started(); await blocked; return { exitCode: 0, envelope: {} }; }),
      healPreview,
    }));
    const first = client.callTool({ name: 'ambercast_run', arguments: {} });
    await running;
    const controller = new AbortController();
    const second = client.callTool({ name: 'ambercast_heal', arguments: {} }, undefined, { signal: controller.signal });
    try {
      await setImmediate();
      controller.abort();
      await expect(second).rejects.toThrow();
      const listing = await client.callTool({ name: 'ambercast_job_status', arguments: {} });
      expect((listing.structuredContent as { jobs: Array<{ tool: string; status: string; statusMessage: string }> }).jobs)
        .toContainEqual(expect.objectContaining({ tool: 'heal', status: 'cancelled', statusMessage: 'cancelled before start' }));
      expect(healPreview).not.toHaveBeenCalled();
    } finally { release(); }
    await first;
  });

  it('does not cancel a queued job when the original request aborts after its handle was already returned', async () => {
    let release!: () => void;
    let started!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const running = new Promise<void>((resolve) => { started = resolve; });
    const healPreview = vi.fn(async () => ({ exitCode: 0, envelope: {} }));
    const client = await connect(fakeDeps({
      run: vi.fn(async () => { started(); await blocked; return { exitCode: 0, envelope: {} }; }),
      healPreview,
    }), { syncWaitMs: 0 });
    const first = client.callTool({ name: 'ambercast_run', arguments: {} });
    await running;
    const controller = new AbortController();
    try {
      const handle = await client.callTool({ name: 'ambercast_heal', arguments: {} }, undefined, { signal: controller.signal });
      const jobId = (handle.structuredContent as { jobId: string }).jobId;
      expect(jobId).toBeDefined();
      controller.abort();
      release();
      await vi.waitFor(async () => {
        const listing = await client.callTool({ name: 'ambercast_job_status', arguments: {} });
        expect((listing.structuredContent as { jobs: Array<{ jobId: string; status: string }> }).jobs)
          .toContainEqual(expect.objectContaining({ jobId, status: 'completed' }));
      });
      expect(healPreview).toHaveBeenCalled();
    } finally { release(); }
    await first;
  });

  it('routes a running original-request abort through job cancellation', async () => {
    let started!: () => void;
    const running = new Promise<void>((resolve) => { started = resolve; });
    const run = vi.fn(async (_input: unknown, _progress: unknown, signal?: AbortSignal) => {
      started();
      await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve(), { once: true }));
      return { exitCode: 3, envelope: { errors: [{ scope: 'run', code: 'INTERRUPTED' }] } };
    });
    const client = await connect(fakeDeps({ run }));
    const controller = new AbortController();
    const pending = client.callTool({ name: 'ambercast_run', arguments: {} }, undefined, { signal: controller.signal });
    await running;
    controller.abort();
    await expect(pending).rejects.toThrow();
    await vi.waitFor(async () => {
      const listing = await client.callTool({ name: 'ambercast_job_status', arguments: {} });
      expect((listing.structuredContent as { jobs: Array<{ status: string }> }).jobs[0]?.status).toBe('cancelled');
    });
  });

  it('releases an aborted job_status long poll without cancelling its job', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const client = await connect(fakeDeps({ run: vi.fn(async () => { await blocked; return { exitCode: 0, envelope: {} }; }) }), { syncWaitMs: 0 });
    const handle = await client.callTool({ name: 'ambercast_run', arguments: {} });
    const jobId = (handle.structuredContent as { jobId: string }).jobId;
    const setTimer = vi.spyOn(globalThis, 'setTimeout');
    const clearTimer = vi.spyOn(globalThis, 'clearTimeout');
    const controller = new AbortController();
    try {
      const pending = client.callTool({ name: 'ambercast_job_status', arguments: { jobId, waitMs: 45_000 } }, undefined, { signal: controller.signal });
      await vi.waitFor(() => expect(setTimer.mock.calls.some(([, ms]) => typeof ms === 'number' && ms > 44_000)).toBe(true));
      const index = setTimer.mock.calls.findIndex(([, ms]) => typeof ms === 'number' && ms > 44_000);
      const timer = setTimer.mock.results[index]?.value;
      controller.abort();
      await expect(pending).rejects.toThrow();
      await vi.waitFor(() => expect(clearTimer).toHaveBeenCalledWith(timer));
      const status = await client.callTool({ name: 'ambercast_job_status', arguments: { jobId } });
      expect(status.structuredContent).toMatchObject({ status: 'working' });
    } finally {
      setTimer.mockRestore();
      clearTimer.mockRestore();
      release();
    }
  });

  it('marks queued jobs as server shutting down during drain', async () => {
    let release!: () => void;
    let started!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const running = new Promise<void>((resolve) => { started = resolve; });
    const drain = new AbortController();
    const client = await connect(fakeDeps({ run: vi.fn(async () => { started(); await blocked; return { exitCode: 0, envelope: {} }; }) }), { signal: drain.signal });
    const first = client.callTool({ name: 'ambercast_run', arguments: {} });
    await running;
    const second = client.callTool({ name: 'ambercast_heal', arguments: {} });
    try {
      await setImmediate();
      drain.abort();
      const listing = await client.callTool({ name: 'ambercast_job_status', arguments: {} });
      expect((listing.structuredContent as { jobs: Array<{ tool: string; status: string; statusMessage: string }> }).jobs)
        .toContainEqual(expect.objectContaining({ tool: 'heal', status: 'cancelled', statusMessage: 'server shutting down' }));
    } finally { release(); }
    await Promise.all([first, second]);
  });
  it('lists the six tools in the fixed order with explicit safety annotations (TEST-B3, TEST-C8)', async () => {
    const client = await connect(fakeDeps());
    const { tools } = await client.listTools();

    expect(tools.map(({ name }) => name)).toEqual(toolNames);
    expect(tools.map(({ annotations }) => annotations)).toEqual([
      { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    ]);
    for (const tool of tools) {
      expect(tool.outputSchema).toBeUndefined();
      expect(tool.description?.length).toBeGreaterThan(0);
      expect(tool.description?.length).toBeLessThan(2048);
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool._meta).toEqual(tool.name === 'ambercast_heal'
        ? { 'anthropic/requiresUserInteraction': true }
        : undefined);
    }
  });

  it('describes purpose and required input near the start of each tool description (TEST-B3)', async () => {
    const client = await connect(fakeDeps());
    const { tools } = await client.listTools();
    const purpose = [/generat/i, /run|replay/i, /check|validat/i, /heal|repair/i, /job|status/i, /job|cancel/i];
    expect(tools).toHaveLength(purpose.length);
    tools.forEach((tool, index) => {
      const opening = tool.description?.slice(0, 500) ?? '';
      expect(opening).toMatch(/ambercast/i);
      expect(opening).toMatch(purpose[index]!);
      expect(opening).toMatch(/(require|argument|input)/i);
    });
  });

  it.each(toolNames.slice(0, 4))('%s returns the SDK validation result for unknown input keys (TEST-B4)', async (name) => {
    const deps = fakeDeps();
    const client = await connect(deps);
    const result = await client.callTool({ name, arguments: { unknown: 1 } });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: 'text', text: expect.stringMatching(/^MCP error -32602: Input validation error/) },
    ]);
    expect(deps.generate).not.toHaveBeenCalled();
    expect(deps.run).not.toHaveBeenCalled();
    expect(deps.check).not.toHaveBeenCalled();
    expect(deps.healPreview).not.toHaveBeenCalled();
  });

  it('returns an input validation error for malformed run grep (TEST-B4)', async () => {
    const deps = fakeDeps();
    const client = await connect(deps);
    const result = await client.callTool({ name: 'ambercast_run', arguments: { grep: '(' } });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: 'text', text: expect.stringMatching(/^MCP error -32602: Input validation error/) },
    ]);
    expect(deps.run).not.toHaveBeenCalled();
  });

  it.each([
    ['ambercast_job_status', { jobId: 'job', unknown: 1 }],
    ['ambercast_job_cancel', { jobId: 'job', unknown: 1 }],
    ['ambercast_job_status', { jobId: 'job', waitMs: -1 }],
    ['ambercast_job_status', { jobId: 'job', waitMs: 1e9 }],
    ['ambercast_job_status', { jobId: '' }],
  ] as const)('%s rejects invalid job input through SDK validation (TEST-C2, TEST-C8)', async (name, args) => {
    const client = await connect(fakeDeps());
    const result = await client.callTool({ name, arguments: args });
    expect(result).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: expect.stringMatching(/^MCP error -32602: Input validation error/) }],
    });
  });

  it.each([
    ['ambercast_generate', 'generate'],
    ['ambercast_run', 'run'],
    ['ambercast_check', 'check'],
    ['ambercast_heal', 'healPreview'],
  ] as const)('%s invokes only deps.%s with validated input (TEST-B5)', async (name, capability) => {
    const deps = fakeDeps();
    const client = await connect(deps);
    const result = await client.callTool({ name, arguments: {} });

    expect(result.isError).toBe(false);
    expect(deps[capability]).toHaveBeenCalledExactlyOnceWith({ allowEmpty: false });
    for (const other of ['generate', 'run', 'check', 'healPreview'] as const) {
      if (other !== capability) expect(deps[other]).not.toHaveBeenCalled();
    }
  });

  it('fills the generate allowEmpty default after validating omitted input (TEST-B4)', async () => {
    const deps = fakeDeps();
    const client = await connect(deps);
    await client.callTool({ name: 'ambercast_generate', arguments: {} });

    expect(deps.generate).toHaveBeenCalledWith(expect.objectContaining({ allowEmpty: false }));
  });

  it('delivers a run progress notification through the tool call context (TEST-B7)', async () => {
    const received: unknown[] = [];
    const run = vi.fn(async (_input: unknown, progress: Parameters<McpServerDeps['run']>[1]) => {
      expect(progress.progressToken).toEqual(expect.any(Number));
      await progress.sendNotification({
        method: 'notifications/progress',
        params: { progressToken: progress.progressToken, progress: 1, message: 'run: step one started' },
      });
      return { exitCode: 0, envelope: { summary: 'ok' } };
    });
    const client = await connect(fakeDeps({ run }));

    const result = await client.callTool(
      { name: 'ambercast_run', arguments: {} },
      undefined,
      { onprogress: (notification) => { received.push(notification); } },
    );

    expect(result.isError).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
    expect(received).toEqual([{ progress: 1, message: 'run: step one started' }]);
  });

  it('returns a synchronous run result when the runtime finishes within the wait (TEST-C1)', async () => {
    const envelope = { summary: 'finished within wait' };
    const client = await connect(fakeDeps({ run: vi.fn(async () => ({ exitCode: 4, envelope })) }));
    const result = await client.callTool({ name: 'ambercast_run', arguments: {} });
    expect(result).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: `exitCode: 4\n${JSON.stringify(envelope)}` }],
      structuredContent: envelope,
      _meta: { exitCode: 4 },
    });
  });


  it.each([
    ['ambercast_generate', 'ambercast_run'],
    ['ambercast_run', 'ambercast_heal'],
    ['ambercast_heal', 'ambercast_generate'],
  ] as const)('serializes %s before %s while the first call is pending (TEST-B8)', async (firstName, secondName) => {
    const calls: string[] = [];
    let releaseFirst!: () => void;
    let firstStarted!: () => void;
    const firstStartedPromise = new Promise<void>((resolve) => { firstStarted = resolve; });
    const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const makeCall = (name: string) => async () => {
      calls.push(name);
      if (name === firstName) {
        firstStarted();
        await firstBlocked;
      }
      return { exitCode: 0, envelope: { name } };
    };
    const deps = fakeDeps({
      generate: makeCall('ambercast_generate'),
      run: makeCall('ambercast_run'),
      check: makeCall('ambercast_check'),
      healPreview: makeCall('ambercast_heal'),
    });
    const client = await connect(deps);
    const first = client.callTool({ name: firstName, arguments: {} });
    await firstStartedPromise;
    const second = client.callTool({ name: secondName, arguments: {} });

    try {
      await setImmediate();
      expect(calls).toEqual([firstName]);
    } finally {
      releaseFirst();
    }
    await Promise.all([first, second]);
    expect(calls).toEqual([firstName, secondName]);
  });

  it('skips a queued call cancelled by its client and starts the next call after release (TEST-B8)', async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    let firstStarted!: () => void;
    const blocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const started = new Promise<void>((resolve) => { firstStarted = resolve; });
    const deps = fakeDeps({
      run: vi.fn(async () => {
        order.push('first');
        firstStarted();
        await blocked;
        return { exitCode: 0, envelope: {} };
      }),
      healPreview: vi.fn(async () => {
        order.push('cancelled');
        return { exitCode: 0, envelope: {} };
      }),
      generate: vi.fn(async () => {
        order.push('third');
        return { exitCode: 0, envelope: {} };
      }),
    });
    const client = await connect(deps);
    const first = client.callTool({ name: 'ambercast_run', arguments: {} });
    await started;
    const controller = new AbortController();
    const cancelled = client.callTool({ name: 'ambercast_heal', arguments: {} }, undefined, { signal: controller.signal });
    const third = client.callTool({ name: 'ambercast_generate', arguments: {} });
    controller.abort();
    try {
      await expect(cancelled).rejects.toThrow();
      expect(order).toEqual(['first']);
    } finally {
      releaseFirst();
    }
    await Promise.all([first, third]);
    expect(deps.healPreview).not.toHaveBeenCalled();
    expect(order).toEqual(['first', 'third']);
  });

  it('skips a queued call when server drain begins before its turn (TEST-B8, TEST-B9)', async () => {
    let releaseFirst!: () => void;
    let firstStarted!: () => void;
    const blocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const started = new Promise<void>((resolve) => { firstStarted = resolve; });
    const run = vi.fn(async () => {
      firstStarted();
      await blocked;
      return { exitCode: 0, envelope: {} };
    });
    const healPreview = vi.fn(async () => ({ exitCode: 0, envelope: {} }));
    const drainController = new AbortController();
    const client = await connect(fakeDeps({ run, healPreview }), { signal: drainController.signal });
    const first = client.callTool({ name: 'ambercast_run', arguments: {} });
    await started;
    const queued = client.callTool({ name: 'ambercast_heal', arguments: {} });

    try {
      await setImmediate();
      expect(healPreview).not.toHaveBeenCalled();
      drainController.abort();
    } finally {
      releaseFirst();
    }

    await expect(first).resolves.toMatchObject({ isError: false });
    await expect(queued).resolves.toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'Aborted' }],
    });
    expect(healPreview).not.toHaveBeenCalled();
  });

  // TEST-B12: fake deps expose no interactive input capability, so this
  // adapter-level fixture structurally cannot prompt when stdin is not a TTY.
});

describe('mcp/server heal apply', () => {
  const token = 'a'.repeat(32);
  const applyArgs = { dryRun: false, applyToken: token };

  it('marks first delivery at the synchronous terminal response, and repeated reads preserve its time (TEST-D2)', async () => {
    let elapsed = 100;
    let wall = new Date('2026-01-01T00:00:00.000Z');
    const clock: Clock = { now: () => wall, monotonicMs: () => elapsed };
    const marks: number[] = [];
    const markHealDelivered = vi.fn(() => {
      marks.push(elapsed);
    });
    const healPreview = vi.fn(async () => {
      expect(markHealDelivered).not.toHaveBeenCalled();
      return { exitCode: 0, envelope: { summary: 'preview' }, applyToken: token };
    });
    const client = await connect(fakeDeps({ healPreview, markHealDelivered }), { clock });

    const preview = await client.callTool({ name: 'ambercast_heal', arguments: {} });
    expect(preview.content).toEqual([{ type: 'text', text: expect.stringContaining(`applyToken: ${token}`) }]);
    expect(markHealDelivered).toHaveBeenCalledWith(token);
    expect(marks).toEqual([100]);
    const jobId = (preview._meta?.job as { jobId: string }).jobId;

    elapsed = 8_000;
    wall = new Date('2025-01-01T00:00:00.000Z');
    const again = await client.callTool({ name: 'ambercast_job_status', arguments: { jobId } });
    expect(again.content).toEqual([{ type: 'text', text: expect.stringContaining(`applyToken: ${token}`) }]);
    expect(marks).toEqual([100]);
  });

  it('waits for a terminal job_status read after an early handle before marking first delivery (TEST-D2)', async () => {
    let elapsed = 30;
    let wall = new Date('2026-01-01T00:00:00.000Z');
    const clock: Clock = { now: () => wall, monotonicMs: () => elapsed };
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const marks: number[] = [];
    const markHealDelivered = vi.fn(() => { marks.push(elapsed); });
    const client = await connect(fakeDeps({
      healPreview: vi.fn(async () => {
        await blocked;
        expect(markHealDelivered).not.toHaveBeenCalled();
        return { exitCode: 0, envelope: { summary: 'preview' }, applyToken: token };
      }),
      markHealDelivered,
    }), { clock, syncWaitMs: 0 });

    const handle = await client.callTool({ name: 'ambercast_heal', arguments: {} });
    const jobId = (handle.structuredContent as { jobId: string }).jobId;
    expect(marks).toEqual([]);
    try {
      release();
      await vi.waitFor(async () => {
        const listing = await client.callTool({ name: 'ambercast_job_status', arguments: {} });
        expect((listing.structuredContent as { jobs: Array<{ jobId: string; status: string }> }).jobs)
          .toContainEqual(expect.objectContaining({ jobId, status: 'completed' }));
      });
      expect(markHealDelivered).not.toHaveBeenCalled();

      elapsed = 300;
      const firstRead = await client.callTool({ name: 'ambercast_job_status', arguments: { jobId } });
      expect(firstRead.content).toEqual([{ type: 'text', text: expect.stringContaining(`applyToken: ${token}`) }]);
      expect(markHealDelivered).toHaveBeenCalledWith(token);
      expect(marks).toEqual([300]);

      elapsed = 900;
      wall = new Date('2025-01-01T00:00:00.000Z');
      await client.callTool({ name: 'ambercast_job_status', arguments: { jobId } });
      expect(marks).toEqual([300]);
    } finally { release(); }
  });

  it('cancels an apply waiting in the write FIFO without invoking settlement (TEST-D4)', async () => {
    let release!: () => void;
    let started!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const running = new Promise<void>((resolve) => { started = resolve; });
    let interrupted = false;
    const writes: string[] = [];
    const applyHeal = vi.fn(async (_token: string, confirm: 'authorized' | 'declined' | 'interrupted') => {
      if (confirm === 'interrupted') {
        interrupted = true;
        return { kind: 'report' as const, exitCode: 1, envelope: { summary: 'interrupted' } };
      }
      if (interrupted) return { kind: 'error' as const, code: 'TOKEN_CONSUMED', message: 'already interrupted' };
      if (confirm === 'authorized') writes.push(_token);
      return { kind: 'report' as const, exitCode: 0, envelope: { summary: 'applied' } };
    });
    const client = await connect(fakeDeps({
      run: vi.fn(async () => { started(); await blocked; return { exitCode: 0, envelope: {} }; }),
      applyHeal,
    }));
    const first = client.callTool({ name: 'ambercast_run', arguments: {} });
    await running;
    const controller = new AbortController();
    const pending = client.callTool({ name: 'ambercast_heal', arguments: applyArgs }, undefined, { signal: controller.signal });
    try {
      await setImmediate();
      controller.abort();
      await expect(pending).rejects.toThrow();
      const listing = await client.callTool({ name: 'ambercast_job_status', arguments: {} });
      const cancelled = (listing.structuredContent as { jobs: Array<{ jobId: string; tool: string; status: string }> }).jobs
        .find((job) => job.tool === 'heal');
      expect(cancelled).toMatchObject({ status: 'cancelled' });
      expect(applyHeal).not.toHaveBeenCalledWith(token, 'authorized');
    } finally {
      release();
      await first.catch(() => undefined);
    }
    const listing = await client.callTool({ name: 'ambercast_job_status', arguments: {} });
    const cancelled = (listing.structuredContent as { jobs: Array<{ jobId: string; tool: string; status: string }> }).jobs
      .find((job) => job.tool === 'heal');
    expect(cancelled).toMatchObject({ status: 'cancelled' });
    expect(applyHeal).toHaveBeenCalledExactlyOnceWith(token, 'interrupted', expect.anything());
    await client.callTool({ name: 'ambercast_heal', arguments: applyArgs });
    expect(writes).toEqual([]);
    expect(applyHeal).not.toHaveBeenCalledWith(token, 'authorized');
  });

  it('renders a preimage-changed settlement failure as an error outcome (TEST-D4)', async () => {
    const applyHeal = vi.fn(async (_token: string, _confirm: 'authorized' | 'declined' | 'interrupted') => ({ kind: 'error' as const, code: 'PREIMAGE_CHANGED', message: 'file changed after preview' }));
    const client = await connect(fakeDeps({ applyHeal }));
    const result = await client.callTool({ name: 'ambercast_heal', arguments: applyArgs });
    expect(result.isError).toBe(true);
    expect(applyHeal).toHaveBeenCalledTimes(1);
  });

  it('records a settlement throw as a failed apply job (TEST-D4)', async () => {
    const applyHeal = vi.fn(async (_token: string, _confirm: 'authorized' | 'declined' | 'interrupted'): Promise<never> => {
      throw new Error('preimage changed during settlement');
    });
    const client = await connect(fakeDeps({ applyHeal }));

    const result = await client.callTool({ name: 'ambercast_heal', arguments: applyArgs });
    expect(applyHeal).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ isError: true, _meta: { job: { status: 'failed' } } });
  });

  it.each([
    ['accept with confirmed content', { action: 'accept' as const, content: { confirm: true } }, 'authorized'],
    ['accept without confirmation', { action: 'accept' as const, content: { confirm: false } }, 'declined'],
    ['accept with omitted confirm', { action: 'accept' as const, content: {} }, 'declined'],
    ['decline', { action: 'decline' as const }, 'declined'],
    ['cancel', { action: 'cancel' as const }, 'interrupted'],
  ])('maps %s to settlement (TEST-D5)', async (_name, elicited, decision) => {
    const onElicit = vi.fn(async (_request: ElicitRequest): Promise<ElicitResult> => elicited);
    const applyHeal = vi.fn(async (_token: string, _confirm: 'authorized' | 'declined' | 'interrupted') => ({ kind: 'report' as const, exitCode: 0, envelope: { summary: 'settled' } }));
    const client = await connect(fakeDeps({ applyHeal }), undefined, { capabilities: { elicitation: { form: {} } }, onElicit });

    await client.callTool({ name: 'ambercast_heal', arguments: applyArgs });
    expect(onElicit).toHaveBeenCalledTimes(1);
    expect(onElicit.mock.calls[0]?.[0]).toMatchObject({ method: 'elicitation/create', params: { mode: 'form' } });
    expect(applyHeal).toHaveBeenCalledTimes(1);
    expect(applyHeal.mock.calls[0]?.[1]).toBe(decision);
  });

  it('maps an elicitation request rejection to interrupted (TEST-D5)', async () => {
    const onElicit = vi.fn(async (): Promise<ElicitResult> => { throw new Error('client rejected elicitation'); });
    const applyHeal = vi.fn(async (_token: string, _confirm: 'authorized' | 'declined' | 'interrupted') => ({ kind: 'report' as const, exitCode: 0, envelope: { summary: 'interrupted' } }));
    const client = await connect(fakeDeps({ applyHeal }), undefined, { capabilities: { elicitation: { form: {} } }, onElicit });

    await client.callTool({ name: 'ambercast_heal', arguments: applyArgs });
    expect(onElicit).toHaveBeenCalledTimes(1);
    expect(applyHeal.mock.calls[0]?.[1]).toBe('interrupted');
  });

  it('maps an explicit reject action to interrupted even though the SDK rejects that result shape (TEST-D5)', async () => {
    const onElicit = vi.fn(async (): Promise<ElicitResult> => ({ action: 'reject' } as unknown as ElicitResult));
    const applyHeal = vi.fn(async (_token: string, _confirm: 'authorized' | 'declined' | 'interrupted') => ({ kind: 'report' as const, exitCode: 0, envelope: { summary: 'interrupted' } }));
    const client = await connect(fakeDeps({ applyHeal }), undefined, { capabilities: { elicitation: { form: {} } }, onElicit });

    await client.callTool({ name: 'ambercast_heal', arguments: applyArgs });
    expect(onElicit).toHaveBeenCalledTimes(1);
    expect(applyHeal.mock.calls[0]?.[1]).toBe('interrupted');
  });

  it('authorizes directly when the client has no form elicitation capability (TEST-D5)', async () => {
    const applyHeal = vi.fn(async (_token: string, _confirm: 'authorized' | 'declined' | 'interrupted') => ({ kind: 'report' as const, exitCode: 0, envelope: { summary: 'applied' } }));
    const onElicit = vi.fn(async (): Promise<ElicitResult> => ({ action: 'accept', content: { confirm: true } }));
    const client = await connect(fakeDeps({ applyHeal }), undefined, { capabilities: { elicitation: { url: {} } }, onElicit });

    const result = await client.callTool({ name: 'ambercast_heal', arguments: applyArgs });
    expect(result.isError).toBe(false);
    expect(applyHeal).toHaveBeenCalledTimes(1);
    expect(applyHeal.mock.calls[0]?.[1]).toBe('authorized');
    expect(onElicit).not.toHaveBeenCalled();
  });

  it('interrupts confirmation after its 600000 ms response deadline (TEST-D5)', async () => {
    let release!: () => void;
    const blocked = new Promise<ElicitResult>((resolve) => { release = () => resolve({ action: 'cancel' }); });
    const onElicit = vi.fn(async () => blocked);
    const applyHeal = vi.fn(async (_token: string, _confirm: 'authorized' | 'declined' | 'interrupted') => ({ kind: 'report' as const, exitCode: 0, envelope: { summary: 'interrupted' } }));
    const client = await connect(fakeDeps({ applyHeal }), undefined, { capabilities: { elicitation: { form: {} } }, onElicit });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const pending = client.callTool({ name: 'ambercast_heal', arguments: applyArgs }, undefined, { timeout: 700_000 });
    try {
      await vi.waitFor(() => expect(onElicit).toHaveBeenCalledTimes(1));
      expect(applyHeal).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(600_000);
      await pending;
      expect(applyHeal.mock.calls[0]?.[1]).toBe('interrupted');
    } finally {
      release();
      vi.useRealTimers();
      await pending.catch(() => undefined);
    }
  });

  it('interrupts confirmation on original-request abort before settlement starts (TEST-D4, TEST-D5)', async () => {
    let entered!: () => void;
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { entered = resolve; });
    const blocked = new Promise<ElicitResult>((resolve) => { release = () => resolve({ action: 'accept', content: { confirm: true } }); });
    const onElicit = vi.fn(async () => { entered(); return blocked; });
    const applyHeal = vi.fn(async (_token: string, _confirm: 'authorized' | 'declined' | 'interrupted') => ({ kind: 'report' as const, exitCode: 0, envelope: { summary: 'interrupted' } }));
    const client = await connect(fakeDeps({ applyHeal }), undefined, { capabilities: { elicitation: { form: {} } }, onElicit });
    const controller = new AbortController();
    const pending = client.callTool({ name: 'ambercast_heal', arguments: applyArgs }, undefined, { signal: controller.signal });
    try {
      await vi.waitFor(() => expect(onElicit).toHaveBeenCalledTimes(1));
      await waiting;
      controller.abort();
      await expect(pending).rejects.toThrow();
      await vi.waitFor(() => expect(applyHeal.mock.calls[0]?.[1]).toBe('interrupted'));
    } finally {
      release();
      await pending.catch(() => undefined);
    }
  });

  it('keeps an authorized settlement running after original-request abort and stores its result (TEST-D4)', async () => {
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const envelope = { summary: 'authorized write completed' };
    const applyHeal = vi.fn(async (_token: string, _confirm: 'authorized' | 'declined' | 'interrupted') => {
      entered();
      await blocked;
      return { kind: 'report' as const, exitCode: 0, envelope };
    });
    const client = await connect(fakeDeps({ applyHeal }));
    const controller = new AbortController();
    const pending = client.callTool({ name: 'ambercast_heal', arguments: applyArgs }, undefined, { signal: controller.signal });
    try {
      await vi.waitFor(() => expect(applyHeal).toHaveBeenCalledTimes(1));
      await started;
      expect(applyHeal.mock.calls[0]?.[1]).toBe('authorized');
      controller.abort();
      await expect(pending).rejects.toThrow();
      release();
      await vi.waitFor(async () => {
        const listing = await client.callTool({ name: 'ambercast_job_status', arguments: {} });
        expect((listing.structuredContent as { jobs: Array<{ tool: string; status: string }> }).jobs)
          .toContainEqual(expect.objectContaining({ tool: 'heal', status: 'completed' }));
      });
      const listing = await client.callTool({ name: 'ambercast_job_status', arguments: {} });
      const jobId = (listing.structuredContent as { jobs: Array<{ jobId: string; tool: string }> }).jobs.find((job) => job.tool === 'heal')!.jobId;
      const terminal = await client.callTool({ name: 'ambercast_job_status', arguments: { jobId } });
      expect(terminal.structuredContent).toEqual(envelope);
      expect(applyHeal).toHaveBeenCalledTimes(1);
    } finally {
      release();
      await pending.catch(() => undefined);
    }
  });
});
