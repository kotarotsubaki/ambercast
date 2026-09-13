/**
 * Adapts Codex CLI's non-interactive structured-output protocol to the AI
 * port without exposing temporary schema-file management to callers.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { rejectOnAbort } from '#core/ai/reject-on-abort.js';
import { AiExecutorUnavailableError } from '#core/errors/ai-executor-unavailable-error.js';
import { AiResponseInvalidError } from '#core/errors/ai-response-invalid-error.js';
import { buildStructuredPrompt } from '#adapters/ai/shared/prompt-envelope.js';
import { validateAiResponse } from '#adapters/ai/shared/response-validator.js';
import {
  createSpawnCommandRunner,
  type CommandRunner,
} from '#adapters/ai/shared/command-runner.js';
import {
  executeAgentic,
  type BuildInvocation,
} from '#adapters/ai/agentic/agentic-executor.js';
import { buildCodexInvocation } from '#adapters/ai/agentic/codex-invocation.js';
import type {
  AiAgenticResult,
  AiExecuteRequest,
  AiExecuteResult,
  InstructionCoveredAiAgenticRequest,
  InstructionCoveredAiExecutor,
} from '#ports/ai.js';

/**
 * Creates the Codex CLI executor.
 *
 * @param deps - Optional subprocess seam for hermetic adapter tests.
 * @returns An executor named `codex-cli`.
 * @remarks
 * `execute` writes the output schema to a unique
 * temporary directory, uses that directory as the child cwd to cut
 * discovery of `AGENTS.md` and `.agents/skills` off from the inherited project,
 * and pipes the isolated prompt to Codex's structured-output execution
 * protocol. The narrow `--skip-git-repo-check` exception applies solely to
 * Codex's repository-trust gate, allowing the fresh, empty per-call directory
 * to serve as cwd; the separate `--sandbox read-only` policy remains in
 * effect. The directory's fresh, empty, per-call isolation and the read-only
 * sandbox compensate for that explicit trust-gate exception. It then validates
 * the output file's text. A
 * best-effort `finally` path attempts
 * directory removal after every provider outcome without replacing that
 * outcome when cleanup fails. Nonzero, signaled, spawn-failure, and temporary
 * artifact-preparation outcomes classify as an unavailable executor.
 * Retaining a bounded stderr excerpt gives operators enough signal to
 * distinguish CLI failure causes such as authentication, sandbox, or
 * model-availability errors without allowing unbounded provider output to
 * inflate caller error details or logs. Accordingly, nonzero exits and
 * signaled outcomes include non-empty child stderr in `stderrExcerpt`, capped
 * at the first 1,000 UTF-16 code units; the field is omitted when stderr is
 * empty. `codex --version` probes never throw.
 *
     * Its `executeAgentic` method delegates browser-directed work to the shared
     * loopback-MCP executor. Runtime composition supplies the environment-filtered
     * runner, while this adapter owns only Codex-specific invocation resources.
     * Injected runners leave the protocol deterministic under test.
 */
export function createCodexCliExecutor(
  deps: {
    readonly run?: CommandRunner;
    readonly buildInvocation?: BuildInvocation;
  } = {},
): InstructionCoveredAiExecutor {
  const run = deps.run ?? createSpawnCommandRunner();
  const buildInvocation = deps.buildInvocation ?? buildCodexInvocation;

  return {
    name: 'codex-cli',
    execute<T>(request: AiExecuteRequest<T>): Promise<AiExecuteResult<T>> {
      let work: Promise<AiExecuteResult<T>> | undefined;
      const guarded = rejectOnAbort(request.signal, () => {
        work = (async () => {
          try {
            const directory = await mkdtemp(join(tmpdir(), 'ambercast-codex-'));
            const schemaPath = join(directory, 'response.schema.json');
            const outputPath = join(directory, 'response.json');

            try {
              await writeFile(schemaPath, JSON.stringify(request.responseSchema));

              let result;
              try {
                result = await run(
                  'codex',
                  ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--json', '--output-schema', schemaPath, '-o', outputPath, '-'],
                  {
                    input: buildStructuredPrompt(request),
                    cwd: directory,
                    ...(request.signal === undefined ? {} : { signal: request.signal }),
                  },
                );
              } catch (error) {
                throw new AiExecutorUnavailableError('The Codex CLI is unavailable.', { provider: 'codex' }, { cause: error });
              }

              if (result.outcome !== 'exited' || result.exitCode !== 0) {
                throw new AiExecutorUnavailableError('The Codex CLI did not complete the request.', {
                  provider: 'codex',
                  ...(result.stderr === '' ? {} : { stderrExcerpt: result.stderr.slice(0, 1_000) }),
                });
              }

              let raw: string;
              try {
                raw = await readFile(outputPath, 'utf8');
              } catch (error) {
                throw new AiExecutorUnavailableError('The Codex CLI did not produce a response file.', { provider: 'codex' }, { cause: error });
              }

              return { data: validateAiResponse(raw, request.responseSchema), raw };
            } finally {
              await rm(directory, { recursive: true, force: true }).catch(() => undefined);
            }
          } catch (error) {
            if (error instanceof AiExecutorUnavailableError || error instanceof AiResponseInvalidError) {
              throw error;
            }

            throw new AiExecutorUnavailableError(
              'The Codex CLI could not prepare a structured response.',
              { provider: 'codex' },
              { cause: error },
            );
          }
        })();
        return work;
      });

      return guarded.catch(async (error: unknown) => {
        if (request.signal?.aborted && work !== undefined) {
          await work.catch(() => undefined);
        }
        throw error;
      });
    },
    async executeAgentic(request: InstructionCoveredAiAgenticRequest): Promise<AiAgenticResult> {
      return rejectOnAbort(request.signal, () => executeAgentic(request, run, buildInvocation));
    },
    async isAvailable(signal?: AbortSignal): Promise<boolean> {
      try {
        const result = await run('codex', ['--version'], signal === undefined ? undefined : { signal });
        return result.outcome === 'exited' && result.exitCode === 0;
      } catch {
        return false;
      }
    },
  };
}
