import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { describe, expect, it } from 'vitest';
import { startAgenticMcpServer } from '#adapters/ai/agentic/mcp-server.js';
import { IntegrityViolationError } from '#core/errors/integrity-violation-error.js';
import { SecretUnresolvedError } from '#core/errors/secret-unresolved-error.js';
import type { InstructionCoverageAiActionController } from '#ports/ai.js';

function createController(overrides: Partial<InstructionCoverageAiActionController> = {}) {
  const calls = { perform: 0, evaluateAssert: 0, snapshotForResolution: 0 };
  const controller: InstructionCoverageAiActionController = {
    async perform(action) { calls.perform += 1; await overrides.perform?.(action); },
    async evaluateAssert(check, criterionId) {
      calls.evaluateAssert += 1;
      return overrides.evaluateAssert?.(check, criterionId) ?? { passed: true };
    },
    async snapshotForResolution() {
      calls.snapshotForResolution += 1;
      return overrides.snapshotForResolution?.() ?? { accessibilityTree: { role: 'document' } };
    },
  };
  return { controller, calls };
}

async function connectClient(url: string, token: string, responseBodies?: string[]): Promise<Client> {
  const client = new Client({ name: 'ambercast-mcp-test', version: '1.0.0' });
  const requestInit = { headers: { authorization: `Bearer ${token}` } };
  const transport = new StreamableHTTPClientTransport(new URL(url), responseBodies === undefined
    ? { requestInit }
    : {
      requestInit,
      fetch: async (input, init) => {
        const response = await fetch(input, init);
        responseBodies.push(await response.clone().text());
        return response;
      },
    });
  // SDK 1.30's transport declaration is not exact-optional compatible with
  // Client's Transport parameter even though the runtime transport is valid.
  await client.connect(transport as never);
  return client;
}

async function unauthorizedRequest(url: string, token?: string): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
  });
}

const action = { type: 'click', target: { strategy: 'accessibility', role: 'button', name: 'Continue' } } as never;
const check = { type: 'assert', check: 'element-visible', target: { strategy: 'accessibility', role: 'heading', name: 'Done' } } as never;
type McpServer = Awaited<ReturnType<typeof startAgenticMcpServer>>;
type LatchCase = {
  readonly label: string;
  readonly trigger: (client: Client, server: McpServer) => Promise<void>;
  readonly expectedCalls: { readonly perform: number; readonly evaluateAssert: number; readonly snapshotForResolution: number };
  readonly schemaViolation?: boolean;
  readonly transportRejects?: boolean;
};

describe('startAgenticMcpServer', () => {
  it('binds strictly to loopback and closes idempotently', async () => {
    const { controller } = createController();
    const server = await startAgenticMcpServer(controller);

    expect(new URL(server.url).hostname).toBe('127.0.0.1');
    await expect(server.close()).resolves.toBeUndefined();
    await expect(server.close()).resolves.toBeUndefined();
  });

  it('creates a distinct 32-byte base64url bearer token for each server', async () => {
    const { controller } = createController();
    const first = await startAgenticMcpServer(controller);
    const second = await startAgenticMcpServer(controller);

    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.token).not.toBe(second.token);
    await first.close();
    await second.close();
  });

  it('speaks initialize, tools/list, and successful tools/call through the SDK client', async () => {
    const received: { action?: unknown; assertion?: unknown; criterionId?: unknown } = {};
    const snapshot = { accessibilityTree: { role: 'main', name: 'Account' } };
    const { controller } = createController({
      perform: async (performed) => { received.action = performed; },
      evaluateAssert: async (assertion, criterionId) => {
        received.assertion = assertion;
        received.criterionId = criterionId;
        return { passed: false, message: 'Still loading.' };
      },
      snapshotForResolution: async () => snapshot,
    });
    const server = await startAgenticMcpServer(controller);
    const client = await connectClient(server.url, server.token);

    const listed = await client.listTools();
    const perform = await client.callTool({ name: 'ambercast_perform', arguments: { action } });
    const assertion = await client.callTool({ name: 'ambercast_evaluate_assert', arguments: { check, criterionId: 'complete' } });
    const captured = await client.callTool({ name: 'ambercast_snapshot', arguments: {} });

    expect(listed.tools.map((tool) => tool.name)).toEqual([
      'ambercast_perform',
      'ambercast_evaluate_assert',
      'ambercast_snapshot',
    ]);
    expect(received).toStrictEqual({ action, assertion: check, criterionId: 'complete' });
    expect(perform.isError).not.toBe(true);
    expect(JSON.stringify(assertion)).toContain('Still loading.');
    expect(JSON.stringify(captured)).toContain('Account');
    await client.close();
    await server.close();
  });

  it('exposes a drained, read-only latch inspection without closing the socket', async () => {
    const { controller } = createController();
    const server = await startAgenticMcpServer(controller);

    await unauthorizedRequest(server.url);
    await server.awaitDrain();

    expect(server.peekLatchedError()).toBeInstanceOf(Error);
    await server.close();
  });

  const latchCases: readonly LatchCase[] = [
    {
      label: 'missing bearer authentication',
      trigger: async (_client, server) => {
        const response = await unauthorizedRequest(server.url);
        expect(response.status).toBe(401);
      },
      expectedCalls: { perform: 0, evaluateAssert: 0, snapshotForResolution: 0 },
      transportRejects: true,
    },
    {
      label: 'wrong bearer authentication',
      trigger: async (_client, server) => {
        const response = await unauthorizedRequest(server.url, 'wrong');
        expect(response.status).toBe(401);
      },
      expectedCalls: { perform: 0, evaluateAssert: 0, snapshotForResolution: 0 },
      transportRejects: true,
    },
    ...([
      ['unknown tool', 'not-a-tool', {}, false],
      ['perform unknown key', 'ambercast_perform', { action, extra: true }, true],
      ['perform wrong shape', 'ambercast_perform', { action: 'wrong' }, true],
      ['assert unknown key', 'ambercast_evaluate_assert', { check, extra: true }, true],
      ['assert wrong check shape', 'ambercast_evaluate_assert', { check: 'wrong' }, true],
      ['assert wrong criterionId shape', 'ambercast_evaluate_assert', { check, criterionId: 1 }, true],
      ['snapshot nonempty object', 'ambercast_snapshot', { extra: true }, true],
    ] as const).map(([label, name, arguments_, schemaViolation]) => ({
      label,
      trigger: async (client: Client) => {
        const result = await client.callTool({ name, arguments: arguments_ });
        expect(result.isError).toBe(true);
      },
      expectedCalls: { perform: 0, evaluateAssert: 0, snapshotForResolution: 0 },
      schemaViolation,
    })),
  ];

  it.each(latchCases)('latches $label without allowing later controller work', async ({ trigger, expectedCalls, schemaViolation, transportRejects }) => {
    const { controller, calls } = createController();
    const server = await startAgenticMcpServer(controller);
    const client = await connectClient(server.url, server.token);

    await trigger(client, server);
    const latched = server.peekLatchedError();

    if (transportRejects) {
      await expect(client.callTool({ name: 'ambercast_snapshot', arguments: {} })).rejects.toThrow();
    } else {
      const later = await client.callTool({ name: 'ambercast_snapshot', arguments: {} });
      expect(later.isError).toBe(true);
    }
    expect(latched).toBeInstanceOf(Error);
    expect(server.peekLatchedError()).toBe(latched);
    expect(calls).toStrictEqual(expectedCalls);
    if (schemaViolation) {
      expect(latched).toBeInstanceOf(IntegrityViolationError);
      expect(latched).toMatchObject({ details: { issues: expect.any(Array) } });
    }
    await client.close();
    await server.close();
  });

  it.each([
    ['controller error', new Error('browser failure')],
    ['controller integrity rejection', new IntegrityViolationError('controller rejected invalid trace')],
    ['controller secret rejection', new SecretUnresolvedError('secret unavailable', { secretRef: 'password' })],
  ])('latches %s and prevents a second controller call', async (_label, error) => {
    const { controller, calls } = createController({ snapshotForResolution: async () => { throw error; } });
    const server = await startAgenticMcpServer(controller);
    const client = await connectClient(server.url, server.token);

    const first = await client.callTool({ name: 'ambercast_snapshot', arguments: {} });
    const latched = server.peekLatchedError();
    const later = await client.callTool({ name: 'ambercast_snapshot', arguments: {} });

    expect(first.isError).toBe(true);
    expect(later.isError).toBe(true);
    expect(latched).toBe(error);
    expect(server.peekLatchedError()).toBe(latched);
    expect(calls).toStrictEqual({ perform: 0, evaluateAssert: 0, snapshotForResolution: 1 });
    await client.close();
    await server.close();
  });

  it('latches an out-of-grant fill-secret rejection without leaking the resolved secret', async () => {
    const secretValue = 'MCP_TEST_SECRET_MUST_NOT_LEAK';
    const secretRef = '{{secrets.outside_grant}}';
    const { controller, calls } = createController({
      perform: async () => { throw new IntegrityViolationError(`Secret ${secretValue} is outside allowedSecretRefs.`, { secretRef }); },
    });
    const server = await startAgenticMcpServer(controller);
    const responseBodies: string[] = [];
    const client = await connectClient(server.url, server.token, responseBodies);
    const fillSecret = { type: 'fill-secret', target: { strategy: 'accessibility', role: 'textbox', name: 'Password' }, secretRef } as never;

    const first = await client.callTool({ name: 'ambercast_perform', arguments: { action: fillSecret } });
    const latched = server.peekLatchedError();
    const later = await client.callTool({ name: 'ambercast_snapshot', arguments: {} });
    const fullResponse = responseBodies.join('\n');

    expect(first.isError).toBe(true);
    expect(later.isError).toBe(true);
    expect(latched).toBeInstanceOf(IntegrityViolationError);
    expect(server.peekLatchedError()).toBe(latched);
    expect(calls).toStrictEqual({ perform: 1, evaluateAssert: 0, snapshotForResolution: 0 });
    expect(fullResponse).not.toContain(secretValue);
    await client.close();
    await server.close();
  });
});
