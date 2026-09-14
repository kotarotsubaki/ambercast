/** Builds Claude Code's isolated MCP-backed agentic invocation. */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { typedJsonSchema } from '#core/ai/typed-json-schema.js';

import type { InvocationResource } from './agentic-executor.js';
import { FinalOutcome, parseFinalOutcome } from './final-outcome.js';

/**
 * Writes Claude's mode-0600 MCP configuration and returns its disposable invocation.
 *
 * The private mode-0600 file carries loopback credentials so the token never
 * enters argv and is removed with the invocation. The isolation settings keep
 * project configuration and built-in tools outside this narrow MCP boundary;
 * the explicit allow-list admits only Ambercast actions. A clean process exit
 * still requires the strict `{ outcome }` contract, preventing an
 * unconstrained textual success claim from completing the request.
 */
export async function buildClaudeInvocation(
  url: string,
  token: string,
): Promise<InvocationResource> {
  const directory = await mkdtemp(join(tmpdir(), 'ambercast-claude-'));
  const configPath = join(directory, 'mcp.json');

  try {
    const { $schema: _schemaDeclaration, ...schema } = typedJsonSchema(FinalOutcome);
    await writeFile(configPath, JSON.stringify({
      mcpServers: {
        ambercast: {
          type: 'http',
          url,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    }), { mode: 0o600 });

    return {
      command: 'claude',
      args: [
        '-p', '--output-format', 'json', '--json-schema', JSON.stringify(schema), '--setting-sources', 'user',
        '--mcp-config', configPath, '--strict-mcp-config',
        '--allowed-tools', 'mcp__ambercast__ambercast_perform mcp__ambercast__ambercast_evaluate_assert mcp__ambercast__ambercast_snapshot',
        '--tools', '',
      ],
      env: {},
      cleanup: async () => rm(directory, { recursive: true, force: true }),
      readFinalOutcome: async (runResult) => {
        const response: unknown = JSON.parse(runResult.stdout);
        if (response === null || typeof response !== 'object' || Array.isArray(response)) {
          throw new Error('The Claude Code CLI response did not contain a string result.');
        }

        const result = (response as Record<string, unknown>).result;
        if (typeof result !== 'string') {
          throw new Error('The Claude Code CLI response did not contain a string result.');
        }

        return parseFinalOutcome(result);
      },
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}
