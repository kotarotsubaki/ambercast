import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { describe, expect, it, vi } from 'vitest';
import { createClaudeCodeCliExecutor } from '#adapters/ai/claude-code-cli/index.js';
import type { CommandRunner } from '#adapters/ai/shared/command-runner.js';
import { AGENTIC_TARGET_REJECTION_LIMIT } from '#core/errors/agentic-target-rejection.js';
import { run } from '#usecases/run.js';
import { buildRunReport } from '#usecases/run-report.js';
import { createFakeUiExecutor } from '../../doubles/fake-ui-executor.js';
import { assertDiagnosable } from '../../support/report-assertions.js';
import { connectClient } from '../../support/mcp-client.js';
import { aiStep, createFakeBrowserSession, createScenario, DEFAULT_OPTIONS, seedFreshArtifacts, writePrompt } from '../../support/run-scenario.js';

describe('run MCP target rejection', () => {
  it('reports an exhausted MCP target rejection from the real Claude executor', async () => {
    let mcpUrl = '';
    let mcpToken = '';
    const fakeRun: CommandRunner = async (_command, _args, options) => {
      const result = { outcome: 'exited' as const, stdout: '', stderr: '', exitCode: 0 };
      let client: Client | undefined;
      try {
        client = await connectClient(mcpUrl, mcpToken);
        const action = { type: 'click', element: { strategy: 'accessibility', role: 'button', name: 'Missing' } };
        for (let index = 0; index < AGENTIC_TARGET_REJECTION_LIMIT + 1; index += 1) {
          const response = await client.callTool({ name: 'ambercast_perform', arguments: { action } });
          expect(response.isError).toBe(true);
        }
      } finally {
        try {
          await client?.close();
        } finally {
          options?.onChildSettled?.(result);
        }
      }
      return result;
    };
    const executor = createClaudeCodeCliExecutor({
      run: fakeRun,
      buildInvocation: async (url, token) => {
        mcpUrl = url;
        mcpToken = token;
        return {
          command: 'test-provider', args: [], env: {}, cleanup: async () => undefined,
          readFinalOutcome: async () => ({ outcome: 'success' as const }),
        };
      },
    });
    const session = createFakeBrowserSession(new Map());
    vi.spyOn(session, 'resolveGrounded').mockResolvedValue({ kind: 'miss', reason: 'element-not-found' });
    const { deps, recordingStorage } = createScenario({
      uiExecutor: vi.fn(() => createFakeUiExecutor(() => session)),
      resolveAiExecutor: async () => executor,
    });
    const testPath = await writePrompt(recordingStorage.storage);
    await seedFreshArtifacts(recordingStorage.storage, testPath, [aiStep()]);

    const outcome = await run(deps, DEFAULT_OPTIONS);
    const report = buildRunReport({
      startedAt: '2026-10-08T00:00:00Z', durationMs: 0,
      options: { allowEmpty: false, list: false }, outcome,
    });
    assertDiagnosable(report.envelope);
    expect(report.envelope.errors).toContainEqual(expect.objectContaining({
      code: 'AGENTIC_STEP_FAILED',
      details: expect.objectContaining({ targetRejections: 4 }),
    }));
    expect(report.exitCode).toBe(3);
  }, 15_000);
});
