import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { startAgenticMcpServer } from '#adapters/ai/agentic/mcp-server.js';
import { computePlanProducerBundleFingerprint, liveProducerBundleInputs } from '#core/ai/plan-producer-bundle.js';
import { AiResponseInvalidError } from '#core/errors/ai-response-invalid-error.js';
import { IntegrityViolationError } from '#core/errors/integrity-violation-error.js';
import { SecretUnresolvedError } from '#core/errors/secret-unresolved-error.js';
import type { InstructionCoverageAiActionController } from '#ports/ai.js';
import { reportError } from '#report/error-mapping.js';
import { ERROR_DETAILS_KEY_ORDER } from '../../../../../src/cli/main.js';

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
type ToolName = 'ambercast_perform' | 'ambercast_evaluate_assert' | 'ambercast_snapshot';
type SchemaMismatchIssue = { readonly code: string; readonly path: readonly (string | number)[]; readonly expected?: string; readonly values?: readonly unknown[]; readonly keyCount?: number };

const descriptions = {
  ambercast_perform: 'Perform one browser action on the current page. The action object is discriminated by its type field: click {target}, press {target, key: Enter|Tab|Escape|ArrowDown|ArrowUp}, fill {target, value}, fill-secret {target, secretRef}, navigate {url}. Every target is {strategy: "accessibility", role, name} using the exact role and accessible name shown by ambercast_snapshot. Never place a secret value in fill; use fill-secret with the secretRef declared for this step, written as {{secrets.NAME}}.',
  ambercast_evaluate_assert: 'Evaluate one assertion against the current page and return whether it passed. The check object always has type: "assert" and is discriminated by its check field: text-visible {text}, element-visible {target}, text-equals {target, text}, url-matches {pattern}, element-count {target, count}. Every target is {strategy: "accessibility", role, name} from ambercast_snapshot. Pass criterionId (the id of a trusted success criterion for this step) only on the terminal assertion that proves that criterion; omit it for intermediate checks.',
  ambercast_snapshot: 'Return the current page\'s accessibility snapshot (role and name tree). Call it before choosing a target so role and name match exactly. It takes no arguments.',
} as const;

function toolText(result: Awaited<ReturnType<Client['callTool']>>): string {
  const content = (result.content as readonly unknown[])[0];
  expect(content).toMatchObject({ type: 'text' });
  return (content as { readonly text: string }).text;
}

function mismatchBody(tool: ToolName, issues: readonly SchemaMismatchIssue[], rejectionsRemaining: number) {
  return { error: 'schema-mismatch', tool, issues, rejectionsRemaining, hint: descriptions[tool] };
}

function genericToolError(result: Awaited<ReturnType<Client['callTool']>>) {
  expect(result).toMatchObject({ isError: true, content: [{ type: 'text', text: 'Agentic MCP request failed.' }] });
}

type LatchCase = {
  readonly label: string;
  readonly trigger: (client: Client, server: McpServer) => Promise<void>;
  readonly expectedCalls: { readonly perform: number; readonly evaluateAssert: number; readonly snapshotForResolution: number };
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
      ['unknown tool', 'not-a-tool', {}],
    ] as const).map(([label, name, arguments_]) => ({
      label,
      trigger: async (client: Client) => {
        const result = await client.callTool({ name, arguments: arguments_ });
        expect(result.isError).toBe(true);
      },
      expectedCalls: { perform: 0, evaluateAssert: 0, snapshotForResolution: 0 },
    })),
  ];

  it.each(latchCases)('latches $label without allowing later controller work', async ({ trigger, expectedCalls, transportRejects }) => {
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
    await client.close();
    await server.close();
  });

  it.each([
    ['perform unknown key', 'ambercast_perform', { action, extra: true }, [{ code: 'unrecognized_keys', path: [], keyCount: 1 }], { action }],
    ['perform wrong shape', 'ambercast_perform', { action: 'wrong' }, [{ code: 'invalid_type', path: ['action'], expected: 'object' }], { action }],
    ['assert unknown key', 'ambercast_evaluate_assert', { check, extra: true }, [{ code: 'unrecognized_keys', path: [], keyCount: 1 }], { check }],
    ['assert wrong check shape', 'ambercast_evaluate_assert', { check: 'wrong' }, [{ code: 'invalid_type', path: ['check'], expected: 'object' }], { check }],
    ['assert wrong criterionId shape', 'ambercast_evaluate_assert', { check, criterionId: 1 }, [{ code: 'invalid_type', path: ['criterionId'], expected: 'string' }], { check }],
    ['snapshot nonempty object', 'ambercast_snapshot', { extra: true }, [{ code: 'unrecognized_keys', path: [], keyCount: 1 }], {}],
  ] as const)('returns a non-latching structured schema mismatch for %s', async (_label, name, arguments_, issues, validArguments) => {
    const { controller, calls } = createController();
    const server = await startAgenticMcpServer(controller);
    const client = await connectClient(server.url, server.token);

    const rejected = await client.callTool({ name, arguments: arguments_ });

    expect(rejected.isError).toBe(true);
    expect(toolText(rejected)).toBe(JSON.stringify(mismatchBody(name, issues, 2)));
    expect(JSON.parse(toolText(rejected))).toStrictEqual(mismatchBody(name, issues, 2));
    expect(server.peekLatchedError()).toBeUndefined();
    expect(calls).toStrictEqual({ perform: 0, evaluateAssert: 0, snapshotForResolution: 0 });

    const recovered = await client.callTool({ name, arguments: validArguments });
    expect(recovered.isError).not.toBe(true);
    expect(calls).toStrictEqual({
      perform: name === 'ambercast_perform' ? 1 : 0,
      evaluateAssert: name === 'ambercast_evaluate_assert' ? 1 : 0,
      snapshotForResolution: name === 'ambercast_snapshot' ? 1 : 0,
    });
    await client.close();
    await server.close();
  });

  it('counts schema rejections across tools and latches only on the fourth', async () => {
    const { controller } = createController();
    const server = await startAgenticMcpServer(controller);
    const client = await connectClient(server.url, server.token);
    const rejected = [
      ['ambercast_perform', { action: 'wrong' }],
      ['ambercast_evaluate_assert', { check, criterionId: 1 }],
      ['ambercast_snapshot', { extra: true }],
    ] as const;

    for (const [index, [name, arguments_]] of rejected.entries()) {
      const result = await client.callTool({ name, arguments: arguments_ });
      expect(JSON.parse(toolText(result))).toMatchObject({ error: 'schema-mismatch', tool: name, rejectionsRemaining: 2 - index });
      expect(server.peekLatchedError()).toBeUndefined();
    }

    genericToolError(await client.callTool({ name: 'ambercast_perform', arguments: { action: 'wrong', extra: true } }));
    const latched = server.peekLatchedError();
    expect(latched).toBeInstanceOf(AiResponseInvalidError);
    expect(latched).toMatchObject({
      message: 'The ambercast_perform input does not match the required schema after 3 rejected calls.',
    });
    expect((latched as AiResponseInvalidError).details!.issues).toStrictEqual([
      { code: 'schema-mismatch', path: ['action'] },
      { code: 'schema-mismatch', path: [] },
    ]);
    genericToolError(await client.callTool({ name: 'ambercast_perform', arguments: { action } }));
    await client.close();
    await server.close();
  });

  it('does not reset the cumulative rejection counter after a valid recovery', async () => {
    const { controller, calls } = createController();
    const server = await startAgenticMcpServer(controller);
    const client = await connectClient(server.url, server.token);

    for (const remaining of [2, 1, 0]) {
      const result = await client.callTool({ name: 'ambercast_perform', arguments: { action: 'wrong' } });
      expect(JSON.parse(toolText(result))).toMatchObject({ rejectionsRemaining: remaining });
    }
    expect((await client.callTool({ name: 'ambercast_perform', arguments: { action } })).isError).not.toBe(true);
    genericToolError(await client.callTool({ name: 'ambercast_perform', arguments: { action: 'wrong' } }));
    expect(server.peekLatchedError()).toBeInstanceOf(AiResponseInvalidError);
    expect(calls.perform).toBe(1);
    await client.close();
    await server.close();
  });

  it('treats omitted snapshot arguments as an empty object without consuming a rejection', async () => {
    const { controller, calls } = createController();
    const server = await startAgenticMcpServer(controller);
    const client = await connectClient(server.url, server.token);

    expect((await client.callTool({ name: 'ambercast_snapshot' })).isError).not.toBe(true);
    for (const remaining of [2, 1, 0]) {
      const result = await client.callTool({ name: 'ambercast_perform', arguments: { action: 'wrong' } });
      expect(JSON.parse(toolText(result))).toMatchObject({ rejectionsRemaining: remaining });
    }
    genericToolError(await client.callTool({ name: 'ambercast_perform', arguments: { action: 'wrong' } }));
    expect(calls.snapshotForResolution).toBe(1);
    await client.close();
    await server.close();
  });

  it.each([
    ['ambercast_perform'],
    ['ambercast_evaluate_assert'],
  ] as const)('consumes a schema rejection when %s omits required arguments', async (name) => {
    const { controller } = createController();
    const server = await startAgenticMcpServer(controller);
    const client = await connectClient(server.url, server.token);

    const result = await client.callTool({ name });
    expect(result.isError).toBe(true);
    expect(JSON.parse(toolText(result))).toMatchObject({ error: 'schema-mismatch', tool: name, rejectionsRemaining: 2 });
    expect(server.peekLatchedError()).toBeUndefined();
    await client.close();
    await server.close();
  });

  it.each([
    ['null', null],
    ['string', 'wrong'],
    ['number', 42],
    ['array', []],
  ] as const)('rejects explicit %s snapshot arguments at the MCP transport without consuming a schema rejection', async (_label, arguments_) => {
    const { controller, calls } = createController();
    const server = await startAgenticMcpServer(controller);
    const client = await connectClient(server.url, server.token);

    const rejection = client.callTool({ name: 'ambercast_snapshot', arguments: arguments_ as never });

    await expect(rejection).rejects.toThrow(McpError);
    await expect(rejection).rejects.toMatchObject({ code: ErrorCode.InternalError });
    expect(server.peekLatchedError()).toBeUndefined();
    expect(calls).toStrictEqual({ perform: 0, evaluateAssert: 0, snapshotForResolution: 0 });

    for (const remaining of [2, 1, 0]) {
      const result = await client.callTool({ name: 'ambercast_perform', arguments: { action: 'wrong' } });
      expect(JSON.parse(toolText(result))).toMatchObject({ error: 'schema-mismatch', rejectionsRemaining: remaining });
      expect(server.peekLatchedError()).toBeUndefined();
    }
    expect(calls).toStrictEqual({ perform: 0, evaluateAssert: 0, snapshotForResolution: 0 });
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

  it('does not leak a resolved-looking fill value from a structured schema mismatch', async () => {
    const secretValue = 'MCP_SCHEMA_SECRET_MUST_NOT_LEAK';
    const { controller, calls } = createController();
    const server = await startAgenticMcpServer(controller);
    const responseBodies: string[] = [];
    const client = await connectClient(server.url, server.token, responseBodies);
    const fill = { type: 'fill', target: { strategy: 'accessibility', role: 'textbox', name: 'Password' }, value: secretValue };

    const result = await client.callTool({ name: 'ambercast_perform', arguments: { action: fill, extra: true } });

    expect(result.isError).toBe(true);
    expect(toolText(result)).toBe(JSON.stringify(mismatchBody('ambercast_perform', [
      { code: 'unrecognized_keys', path: [], keyCount: 1 },
    ], 2)));
    expect(server.peekLatchedError()).toBeUndefined();
    expect(calls).toStrictEqual({ perform: 0, evaluateAssert: 0, snapshotForResolution: 0 });
    expect(responseBodies.join('\n')).not.toContain(secretValue);
    await client.close();
    await server.close();
  });

  it('does not echo a malformed fill-secret reference from a structured schema mismatch', async () => {
    const malformedSecretRef = '{{secrets.malformed secret}}';
    const { controller, calls } = createController();
    const server = await startAgenticMcpServer(controller);
    const responseBodies: string[] = [];
    const client = await connectClient(server.url, server.token, responseBodies);
    const fillSecret = { type: 'fill-secret', target: { strategy: 'accessibility', role: 'textbox', name: 'Password' }, secretRef: malformedSecretRef };

    const result = await client.callTool({ name: 'ambercast_perform', arguments: { action: fillSecret } });

    expect(result.isError).toBe(true);
    expect(toolText(result)).toBe(JSON.stringify(mismatchBody('ambercast_perform', [
      { code: 'invalid_format', path: ['action', 'secretRef'] },
    ], 2)));
    expect(server.peekLatchedError()).toBeUndefined();
    expect(calls).toStrictEqual({ perform: 0, evaluateAssert: 0, snapshotForResolution: 0 });
    expect(toolText(result)).not.toContain(malformedSecretRef);
    expect(responseBodies.join('\n')).not.toContain(malformedSecretRef);
    await client.close();
    await server.close();
  });

  it('lists the three SPEC-4 tool descriptions byte-for-byte', async () => {
    const { controller } = createController();
    const server = await startAgenticMcpServer(controller);
    const client = await connectClient(server.url, server.token);

    const listed = await client.listTools();

    expect(listed.tools.map((tool) => [tool.name, tool.description])).toStrictEqual([
      ['ambercast_perform', descriptions.ambercast_perform],
      ['ambercast_evaluate_assert', descriptions.ambercast_evaluate_assert],
      ['ambercast_snapshot', descriptions.ambercast_snapshot],
    ]);
    await client.close();
    await server.close();
  });

  it.each([
    ['invalid_type', 'ambercast_perform', { action: 'wrong' }, [{ code: 'invalid_type', path: ['action'], expected: 'object' }]],
    ['invalid_value', 'ambercast_evaluate_assert', { check: { ...(check as Record<string, unknown>), type: 'not-assert' } }, [{ code: 'invalid_value', path: ['check', 'type'], values: ['assert'] }]],
    ['unrecognized_keys', 'ambercast_snapshot', { extra: true }, [{ code: 'unrecognized_keys', path: [], keyCount: 1 }]],
    ['invalid_union', 'ambercast_evaluate_assert', { check: { type: 'assert', check: 'not-a-check' } }, [{ code: 'invalid_union', path: ['check', 'check'] }]],
  ] as const)('uses the closed schema-mismatch allowlist for %s', async (_label, name, arguments_, issues) => {
    const { controller } = createController();
    const server = await startAgenticMcpServer(controller);
    const client = await connectClient(server.url, server.token);

    const result = await client.callTool({ name, arguments: arguments_ });
    const body = JSON.parse(toolText(result));

    expect(body.issues).toStrictEqual(issues);
    if (_label === 'invalid_union') {
      expect(JSON.stringify(body)).not.toMatch(/errors|note|discriminator|message|input/);
    }
    await client.close();
    await server.close();
  });

  it('preserves schema issue order and duplicates through the public MCP result', async () => {
    const { controller } = createController();
    const server = await startAgenticMcpServer(controller);
    const client = await connectClient(server.url, server.token);

    const result = await client.callTool({ name: 'ambercast_evaluate_assert', arguments: { check: 'wrong', criterionId: 1 } });

    expect(JSON.parse(toolText(result)).issues).toStrictEqual([
      { code: 'invalid_type', path: ['check'], expected: 'object' },
      { code: 'invalid_type', path: ['criterionId'], expected: 'string' },
    ]);
    await client.close();
    await server.close();
  });

  it('keeps the producer-bundle fingerprint at the fixed pre-change baseline', () => {
    expect(computePlanProducerBundleFingerprint(liveProducerBundleInputs())).toBe('dece452ee142237497ede8cdacac570d27f0d49b31fa25b06cbf7eea44346871');
  });

  it('projects a terminal schema latch into the case report without attempts', async () => {
    const { controller } = createController();
    const server = await startAgenticMcpServer(controller);
    const client = await connectClient(server.url, server.token);
    for (let index = 0; index < 4; index += 1) {
      await client.callTool({ name: 'ambercast_perform', arguments: { action: 'wrong' } });
    }

    const latched = server.peekLatchedError();
    expect(latched).toBeInstanceOf(AiResponseInvalidError);
    const report = reportError(latched as AiResponseInvalidError, { scope: 'case', caseId: 'case-379' });

    expect(report).toMatchObject({
      scope: 'case', caseId: 'case-379', kind: 'environment', code: 'AI_RESPONSE_INVALID',
      details: { issues: [{ code: 'schema-mismatch', path: ['action'] }] },
    });
    expect((report as { details?: Record<string, unknown> }).details).not.toHaveProperty('attempts');
    expect(ERROR_DETAILS_KEY_ORDER.AI_RESPONSE_INVALID).toStrictEqual(['issues', 'attempts']);
    await client.close();
    await server.close();
  });

  it('serializes concurrent schema rejections into three corrections and one terminal latch', async () => {
    const { controller } = createController();
    const server = await startAgenticMcpServer(controller);
    const client = await connectClient(server.url, server.token);
    const rejected = [
      { name: 'ambercast_perform', arguments_: { action: 'wrong' }, terminalIssues: [{ code: 'schema-mismatch', path: ['action'] }] },
      { name: 'ambercast_evaluate_assert', arguments_: { check: 'wrong', criterionId: 1 }, terminalIssues: [{ code: 'schema-mismatch', path: ['check'] }, { code: 'schema-mismatch', path: ['criterionId'] }] },
      { name: 'ambercast_snapshot', arguments_: { extra: true }, terminalIssues: [{ code: 'schema-mismatch', path: [] }] },
      { name: 'ambercast_perform', arguments_: { action: 'wrong', extra: true }, terminalIssues: [{ code: 'schema-mismatch', path: ['action'] }, { code: 'schema-mismatch', path: [] }] },
    ] as const;
    const results = await Promise.all(rejected.map(({ name, arguments_ }) => client.callTool({ name, arguments: arguments_ })));

    const corrections = results
      .filter((result) => toolText(result) !== 'Agentic MCP request failed.')
      .map((result) => JSON.parse(toolText(result)).rejectionsRemaining)
      .sort();
    expect(corrections).toStrictEqual([0, 1, 2]);
    const terminalIndex = results.findIndex((result) => toolText(result) === 'Agentic MCP request failed.');
    expect(terminalIndex).not.toBe(-1);
    expect(results.filter((result) => toolText(result) === 'Agentic MCP request failed.')).toHaveLength(1);
    const terminal = rejected[terminalIndex]!;
    const latched = server.peekLatchedError();
    expect(latched).toBeInstanceOf(AiResponseInvalidError);
    expect(latched).toMatchObject({
      message: `The ${terminal.name} input does not match the required schema after 3 rejected calls.`,
    });
    expect((latched as AiResponseInvalidError).details!.issues).toStrictEqual(terminal.terminalIssues);
    await client.close();
    await server.close();
  });
});
