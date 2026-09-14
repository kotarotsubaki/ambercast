/**
 * Defines the shared browser-directed provider boundary before either CLI
 * adapter supplies its invocation-specific transport details.
 */

import { startAgenticMcpServer } from '#adapters/ai/agentic/mcp-server.js';
import type { CommandRunResult, CommandRunner } from '#adapters/ai/shared/command-runner.js';
import { buildInstructionCoveredAgenticPrompt } from '#adapters/ai/shared/prompt-envelope.js';
import { abortReason } from '#core/ai/reject-on-abort.js';
import type { AiAgenticResult, InstructionCoveredAiAgenticRequest } from '#ports/ai.js';

/**
 * Resources owned by one provider invocation.
 *
 * The executor keeps artifact cleanup with the builder that created
 * those artifacts, so provider-specific temporary files cannot outlive a
 * completed, rejected, or aborted agentic request.
 */
export interface InvocationResource {
  /** Provider executable selected for the isolated invocation. */
  readonly command: string;

  /** Provider arguments, excluding environment-delivered bearer credentials. */
  readonly args: readonly string[];

  /** Per-call environment additions that the command runner must filter after merging. */
  readonly env: Readonly<Record<string, string>>;

  /** Removes all temporary artifacts created for this invocation. */
  cleanup(): Promise<void>;

  /** Reads and validates the provider's final structured outcome after a clean exit. */
  readFinalOutcome(runResult: CommandRunResult): Promise<AiAgenticResult>;
}

/** Builds one provider-specific invocation after the loopback MCP server is listening. */
export type BuildInvocation = (url: string, token: string) => Promise<InvocationResource>;

/**
 * Coordinates one agentic provider process with its loopback MCP server.
 *
 * Child settlement is awaited independently of the run promise because an
 * abort rejects that promise before the provider necessarily exits. The MCP
 * latch outranks a nominal provider success so a failed tool interaction
 * cannot be masked by a valid-looking final outcome. An already-aborted
 * signal skips process and MCP interaction entirely, preserving cancellation
 * as a side-effect-free boundary. Cleanup remains paired with the builder's
 * artifacts so temporary credentials and configuration never outlive a call.
 */
export async function executeAgentic(
  request: InstructionCoveredAiAgenticRequest,
  run: CommandRunner,
  buildInvocation: BuildInvocation,
): Promise<AiAgenticResult> {
  const mcpServer = await startAgenticMcpServer(request.controller);
  let invocation: InvocationResource | undefined;
  let disposed = false;

  const dispose = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    try {
      await invocation?.cleanup();
    } finally {
      await mcpServer.close();
    }
  };

  try {
    if (request.signal?.aborted) throw abortReason(request.signal);
    invocation = await buildInvocation(mcpServer.url, mcpServer.token);
    let settleChild: (() => void) | undefined;
    const childSettled = new Promise<void>((resolve) => {
      settleChild = resolve;
    });
    let runResult: CommandRunResult | undefined;
    let runError: unknown;
    let runInvoked = false;

    try {
      if (request.signal?.aborted) throw abortReason(request.signal);
      runInvoked = true;
      runResult = await run(invocation.command, invocation.args, {
        input: buildInstructionCoveredAgenticPrompt(request),
        env: invocation.env,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
        onChildSettled: () => settleChild?.(),
      });
    } catch (error) {
      runError = error;
    }

    if (runInvoked) await childSettled;
    await mcpServer.awaitDrain();

    const latchedError = mcpServer.peekLatchedError();
    if (latchedError !== undefined) throw latchedError;
    if (runError !== undefined) throw runError;

    if (runResult === undefined || runResult.outcome !== 'exited' || runResult.exitCode !== 0) {
      throw new Error('Agentic provider did not complete successfully.');
    }

    return await invocation.readFinalOutcome(runResult);
  } finally {
    await dispose();
  }
}
