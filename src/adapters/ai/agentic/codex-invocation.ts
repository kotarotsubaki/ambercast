/** Builds Codex CLI's isolated MCP-backed agentic invocation. */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { typedJsonSchema } from '#core/ai/typed-json-schema.js';

import type { InvocationResource } from './agentic-executor.js';
import { FinalOutcome, parseFinalOutcome } from './final-outcome.js';

/**
 * Creates Codex's isolated schema/output artifacts and MCP configuration.
 *
 * The schema/output artifact pair isolates structured provider I/O and shares
 * one disposable lifecycle. The invocation ignores ambient user configuration
 * and limits the provider to the required Ambercast MCP tools, preventing
 * local configuration or unrelated tools from changing replay authority. The
 * token reaches the child only through its environment, never configuration
 * text or argv, and the output still satisfies the strict `{ outcome }`
 * schema before reporting success or failure.
 */
export async function buildCodexInvocation(
  url: string,
  token: string,
): Promise<InvocationResource> {
  const directory = await mkdtemp(join(tmpdir(), 'ambercast-codex-'));
  const schemaPath = join(directory, 'response.schema.json');
  const outputPath = join(directory, 'response.json');

  try {
    await writeFile(schemaPath, JSON.stringify(typedJsonSchema(FinalOutcome)));

    return {
      command: 'codex',
      args: [
        'exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--ignore-user-config', '--strict-config',
        '-c', `mcp_servers.ambercast.url=${url}`,
        '-c', 'mcp_servers.ambercast.bearer_token_env_var=AMBERCAST_MCP_BEARER_TOKEN',
        '-c', 'mcp_servers.ambercast.required=true',
        '-c', 'mcp_servers.ambercast.enabled_tools=["ambercast_perform","ambercast_evaluate_assert","ambercast_snapshot"]',
        '--output-schema', schemaPath, '-o', outputPath, '-',
      ],
      env: { AMBERCAST_MCP_BEARER_TOKEN: token },
      cleanup: async () => rm(directory, { recursive: true, force: true }),
      readFinalOutcome: async () => parseFinalOutcome(await readFile(outputPath, 'utf8')),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}
