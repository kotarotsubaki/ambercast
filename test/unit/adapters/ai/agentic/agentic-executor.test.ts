import { describe, expect, it, vi } from 'vitest';
import { executeAgentic, type BuildInvocation } from '#adapters/ai/agentic/agentic-executor.js';
import type { CommandRunner } from '#adapters/ai/shared/command-runner.js';
import { AiResponseInvalidError } from '#core/errors/ai-response-invalid-error.js';
import { createFakeAiActionController } from '../../../../doubles/fake-ai-action-controller.js';

const mcp = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock('#adapters/ai/agentic/mcp-server.js', () => ({ startAgenticMcpServer: mcp.start }));

function request() {
  return {
    instructionPrompt: 'Complete sign-in.', allowedSecretRefs: [], allowedRunRefs: [],
    trustedInstructionCoverage: [{ id: 'complete', kind: 'success' as const, text: 'Complete sign-in.', sourceSpan: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 18 } }],
    controller: createFakeAiActionController(),
  };
}

function invocation(order: string[], readFinalOutcome: () => Promise<{ readonly outcome: 'success' | 'failure' }>): BuildInvocation {
  return async () => ({ command: 'provider', args: [], env: {}, cleanup: async () => { order.push('cleanup'); }, readFinalOutcome: async () => { order.push('read'); return readFinalOutcome(); } });
}

describe('executeAgentic', () => {
  it('rejects an already-aborted request promptly without building or running a provider', async () => {
    const order: string[] = [];
    const abort = new Error('caller aborted before execution');
    const controller = new AbortController();
    controller.abort(abort);
    mcp.start.mockResolvedValue({ url: 'http://127.0.0.1:1', token: 'token', awaitDrain: async () => undefined, peekLatchedError: () => undefined, close: async () => { order.push('close'); } });
    const run = vi.fn<CommandRunner>();
    const buildInvocation = vi.fn<BuildInvocation>();
    const execution = executeAgentic({ ...request(), signal: controller.signal }, run, buildInvocation);
    const timeout = new Promise<Error>((resolve) => {
      setTimeout(() => resolve(new Error('execution did not settle promptly')), 100);
    });

    await expect(Promise.race([execution, timeout])).rejects.toBe(abort);
    expect(run).not.toHaveBeenCalled();
    expect(buildInvocation).not.toHaveBeenCalled();
    expect(order).toEqual(['close']);
  });

  it.each([
    ['a generic Error', new Error('latched MCP error')],
    ['an AiResponseInvalidError', new AiResponseInvalidError('latched schema mismatch', { issues: [{ code: 'schema-mismatch', path: ['action'] }] })],
  ])('rejects %s latched MCP error even after a nominal provider success and cleans up before close', async (_label, latch) => {
    const order: string[] = [];
    mcp.start.mockResolvedValue({ url: 'http://127.0.0.1:1', token: 'token', awaitDrain: async () => undefined, peekLatchedError: () => latch, close: async () => { order.push('close'); } });
    const run: CommandRunner = async (_command, _args, options) => {
      const result = { outcome: 'exited' as const, stdout: '{"outcome":"success"}', stderr: '', exitCode: 0 };
      options?.onChildSettled?.(result);
      return result;
    };

    await expect(executeAgentic(request(), run, invocation(order, async () => ({ outcome: 'success' })))).rejects.toBe(latch);
    expect(order).toEqual(['cleanup', 'close']);
  });

  it.each([
    ['nonzero exit', { outcome: 'exited' as const, stdout: '', stderr: 'failed', exitCode: 1 }],
    ['signal termination', { outcome: 'signaled' as const, stdout: '', stderr: '', signal: 'SIGTERM' as const }],
  ])('rejects %s and always disposes invocation before MCP transport', async (_label, result) => {
    const order: string[] = [];
    mcp.start.mockResolvedValue({ url: 'http://127.0.0.1:1', token: 'token', awaitDrain: async () => undefined, peekLatchedError: () => undefined, close: async () => { order.push('close'); } });
    const run: CommandRunner = async (_command, _args, options) => { options?.onChildSettled?.(result); return result; };

    await expect(executeAgentic(request(), run, invocation(order, async () => ({ outcome: 'success' })))).rejects.toThrow();
    expect(order).toEqual(['cleanup', 'close']);
  });

  it('waits for a post-abort child settlement, drain, and latch inspection before rejecting', async () => {
    const order: string[] = [];
    const abort = new Error('caller aborted');
    let onChildSettled: NonNullable<Parameters<CommandRunner>[2]>['onChildSettled'];
    let resolveDrain: (() => void) | undefined;
    const drain = new Promise<void>((resolve) => { resolveDrain = resolve; });
    mcp.start.mockResolvedValue({ url: 'http://127.0.0.1:1', token: 'token', awaitDrain: async () => drain, peekLatchedError: () => undefined, close: async () => { order.push('close'); } });
    const run: CommandRunner = async (_command, _args, options) => {
      onChildSettled = options?.onChildSettled;
      throw abort;
    };

    const execution = executeAgentic(request(), run, invocation(order, async () => ({ outcome: 'success' })));
    await vi.waitFor(() => expect(onChildSettled).toBeDefined());
    expect(order).toEqual([]);

    onChildSettled?.({ outcome: 'signaled', stdout: '', stderr: '', signal: 'SIGTERM' });
    await Promise.resolve();
    await Promise.resolve();

    expect(order).toEqual([]);
    resolveDrain?.();
    await expect(execution).rejects.toBe(abort);

    expect(order).toEqual(['cleanup', 'close']);
  });

  it('settles a no-child runner failure after its errored settlement callback', async () => {
    const order: string[] = [];
    const failure = new Error('provider failed before creating a child');
    mcp.start.mockResolvedValue({ url: 'http://127.0.0.1:1', token: 'token', awaitDrain: async () => undefined, peekLatchedError: () => undefined, close: async () => { order.push('close'); } });
    const run: CommandRunner = async (_command, _args, options) => {
      options?.onChildSettled?.({ outcome: 'errored', error: failure });
      throw failure;
    };
    const execution = executeAgentic(request(), run, invocation(order, async () => ({ outcome: 'success' })));
    const timeout = new Promise<Error>((resolve) => {
      setTimeout(() => resolve(new Error('execution did not settle after an errored child settlement')), 100);
    });

    await expect(Promise.race([execution, timeout])).rejects.toBe(failure);
    expect(order).toEqual(['cleanup', 'close']);
  });

  it('passes the instruction-covered prompt to provider stdin and reads the final outcome before disposal', async () => {
    const order: string[] = [];
    mcp.start.mockResolvedValue({ url: 'http://127.0.0.1:1', token: 'token', awaitDrain: async () => undefined, peekLatchedError: () => undefined, close: async () => { order.push('close'); } });
    const result = { outcome: 'exited' as const, stdout: '', stderr: '', exitCode: 0 };
    let input: string | undefined;
    const run: CommandRunner = async (_command, _args, options) => {
      input = options?.input;
      options?.onChildSettled?.(result);
      return result;
    };

    await expect(executeAgentic(request(), run, invocation(order, async () => ({ outcome: 'success' })))).resolves.toEqual({ outcome: 'success' });

    expect(input).toContain('Complete sign-in.');
    expect(order).toEqual(['read', 'cleanup', 'close']);
  });
});
