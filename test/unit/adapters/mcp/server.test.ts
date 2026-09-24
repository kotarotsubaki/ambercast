import { PassThrough } from 'node:stream';
import { setImmediate } from 'node:timers/promises';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMcpServer } from '#adapters/mcp/server.js';
import type { McpServerDeps } from '#adapters/mcp/types.js';

const toolNames = [
  'ambercast_generate',
  'ambercast_run',
  'ambercast_check',
  'ambercast_heal',
] as const;

function fakeDeps(overrides: Partial<McpServerDeps> = {}): McpServerDeps {
  const success = async () => ({ exitCode: 0, envelope: { summary: 'ok' } });
  const fake = () => new Proxy(vi.fn(success), {
    apply(target, thisArg, [input]) {
      return Reflect.apply(target, thisArg, [input]);
    },
  });
  return {
    sessionRoot: '/workspace',
    version: '0.6.0',
    stderr: new PassThrough(),
    generate: fake(),
    run: fake(),
    check: fake(),
    healPreview: fake(),
    ...overrides,
  };
}

type ConnectedServer = ReturnType<typeof createMcpServer>;
const connections: Array<{ client: Client; server: ConnectedServer }> = [];

async function connect(deps: McpServerDeps, options?: { readonly signal?: AbortSignal }): Promise<Client> {
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(deps, options);
  const client = new Client({ name: 'ambercast-server-test', version: '1.0.0' });
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

  it('lists the four synchronous tools in order with explicit safety annotations (TEST-B3)', async () => {
    const client = await connect(fakeDeps());
    const { tools } = await client.listTools();

    expect(tools.map(({ name }) => name)).toEqual(toolNames);
    expect(tools.map(({ annotations }) => annotations)).toEqual([
      { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
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
    const purpose = [/generat/i, /run|replay/i, /check|validat/i, /heal|repair/i];
    expect(tools).toHaveLength(purpose.length);
    tools.forEach((tool, index) => {
      const opening = tool.description?.slice(0, 500) ?? '';
      expect(opening).toMatch(/ambercast/i);
      expect(opening).toMatch(purpose[index]!);
      expect(opening).toMatch(/(require|argument|input)/i);
    });
  });

  it.each(toolNames)('%s returns the SDK validation result for unknown input keys (TEST-B4)', async (name) => {
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

  it.each([
    ['ambercast_generate', 'ambercast_run'],
    ['ambercast_run', 'ambercast_check'],
    ['ambercast_check', 'ambercast_heal'],
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
      check: vi.fn(async () => {
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
    const cancelled = client.callTool({ name: 'ambercast_check', arguments: {} }, undefined, { signal: controller.signal });
    const third = client.callTool({ name: 'ambercast_generate', arguments: {} });
    controller.abort();
    try {
      await expect(cancelled).rejects.toThrow();
      expect(order).toEqual(['first']);
    } finally {
      releaseFirst();
    }
    await Promise.all([first, third]);
    expect(deps.check).not.toHaveBeenCalled();
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
    const check = vi.fn(async () => ({ exitCode: 0, envelope: {} }));
    const drainController = new AbortController();
    const client = await connect(fakeDeps({ run, check }), { signal: drainController.signal });
    const first = client.callTool({ name: 'ambercast_run', arguments: {} });
    await started;
    const queued = client.callTool({ name: 'ambercast_check', arguments: {} });

    try {
      await setImmediate();
      expect(check).not.toHaveBeenCalled();
      drainController.abort();
    } finally {
      releaseFirst();
    }

    await expect(first).resolves.toMatchObject({ isError: false });
    await expect(queued).resolves.toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'Aborted' }],
    });
    expect(check).not.toHaveBeenCalled();
  });

  // TEST-B12: fake deps expose no interactive input capability, so this
  // adapter-level fixture structurally cannot prompt when stdin is not a TTY.
});
