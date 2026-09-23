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
  return {
    sessionRoot: '/workspace',
    version: '0.6.0',
    stderr: new PassThrough(),
    generate: vi.fn(success),
    run: vi.fn(success),
    check: vi.fn(success),
    healPreview: vi.fn(success),
    ...overrides,
  };
}

type ConnectedServer = ReturnType<typeof createMcpServer>;
const connections: Array<{ client: Client; server: ConnectedServer }> = [];

async function connect(deps: McpServerDeps): Promise<Client> {
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(deps);
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
    expect(deps[capability]).toHaveBeenCalledExactlyOnceWith({});
    for (const other of ['generate', 'run', 'check', 'healPreview'] as const) {
      if (other !== capability) expect(deps[other]).not.toHaveBeenCalled();
    }
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

  // TEST-B12: fake deps expose no interactive input capability, so this
  // adapter-level fixture structurally cannot prompt when stdin is not a TTY.
});
