import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Provider behavior selected for each agentic CLI dispatch. */
export type AgenticClaudeSentinelMode = 'success' | 'hang-after-perform' | 'exit-after-perform' | 'malformed-after-success';

/** Filesystem-backed replacement for Claude that exercises Ambercast's MCP transport. */
export interface AgenticClaudeSentinel {
  /** Directory that must be prepended to the CLI child's PATH. */
  readonly pathEntry: string;
  /** Written after the hanging dispatch has completed its first MCP tool call. */
  readonly readyPath: string;
  /** Recorded provider argv arrays, in invocation order. */
  readonly invocations: () => Promise<readonly string[][]>;
  /** Removes the sentinel directory; repeated calls are no-ops. */
  readonly cleanup: () => Promise<void>;
}

/**
 * Creates a Claude-shaped executable that speaks the configured HTTP MCP wire protocol.
 *
 * Each `-p` invocation consumes one supplied mode. It reads the exact URL and bearer
 * header from the private `--mcp-config` artifact created by `buildClaudeInvocation`.
 */
export async function createAgenticClaudeSentinel(
  modes: readonly AgenticClaudeSentinelMode[],
): Promise<AgenticClaudeSentinel> {
  let directory: string | undefined;

  try {
    directory = await mkdtemp(join(tmpdir(), 'ambercast-agentic-claude-sentinel-'));
    const sentinelDirectory = directory;
    const counterPath = join(sentinelDirectory, 'invocations.jsonl');
    const readyPath = join(sentinelDirectory, 'ready');
    const executablePath = join(sentinelDirectory, 'claude');
    const source = `#!/usr/bin/env node
const { appendFileSync, readFileSync, writeFileSync } = require('node:fs');
const counterPath = ${JSON.stringify(counterPath)};
const readyPath = ${JSON.stringify(readyPath)};
const modes = ${JSON.stringify(modes)};
const argv = process.argv.slice(2);
appendFileSync(counterPath, JSON.stringify(argv) + '\\n');
process.stdin.resume();

if (argv[0] === '--version') {
  process.stdout.write('agentic claude sentinel 0.0.0\\n');
  process.exit(0);
}
if (argv[0] !== '-p') {
  process.stderr.write('agentic claude sentinel received an unexpected invocation\\n');
  process.exit(1);
}
const configIndex = argv.indexOf('--mcp-config');
const configPath = configIndex === -1 ? undefined : argv[configIndex + 1];
if (configPath === undefined || configIndex !== argv.lastIndexOf('--mcp-config')) {
  process.stderr.write('agentic claude sentinel did not receive exactly one MCP config path\\n');
  process.exit(1);
}
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const ambercast = config.mcpServers?.ambercast;
const url = ambercast?.url;
const authorization = ambercast?.headers?.Authorization;
if (typeof url !== 'string' || typeof authorization !== 'string') {
  process.stderr.write('agentic claude sentinel did not receive the MCP invocation contract\\n');
  process.exit(1);
}
const ordinal = readFileSync(counterPath, 'utf8').trim().split('\\n').filter(Boolean)
  .map((line) => JSON.parse(line)).filter((entry) => entry[0] === '-p').length - 1;
const mode = modes[ordinal];
if (mode === undefined) {
  process.stderr.write('agentic claude sentinel received more prompts than configured\\n');
  process.exit(1);
}
let id = 0;
const rpc = async (method, params) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { accept: 'application/json, text/event-stream', authorization, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
  });
  const body = await response.text();
  if (!response.ok || body.length === 0) throw new Error('MCP request failed: ' + response.status);
  const responseJson = response.headers.get('content-type')?.includes('text/event-stream')
    ? body.split(/\\r?\\n/).filter((line) => line.startsWith('data:')).at(-1)?.slice('data:'.length).trim()
    : body;
  if (responseJson === undefined || responseJson.length === 0) {
    throw new Error('MCP request returned no JSON-RPC response data');
  }
  let payload;
  try {
    payload = JSON.parse(responseJson);
  } catch {
    throw new Error('MCP request returned malformed JSON-RPC output');
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('MCP request returned a non-object JSON-RPC response');
  }
  if (payload.error !== undefined && payload.error !== null) {
    throw new Error('MCP request returned a JSON-RPC error');
  }
  if (payload.result !== null && typeof payload.result === 'object' && payload.result.isError === true) {
    throw new Error('MCP tool call returned an error result');
  }
};
(async () => {
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'agentic-sentinel', version: '1.0.0' } });
  await rpc('tools/call', { name: 'ambercast_perform', arguments: { action: { type: 'navigate', url: '/' } } });
  if (mode === 'hang-after-perform') {
    writeFileSync(readyPath, 'ready');
    await new Promise(() => {});
  }
  if (mode === 'exit-after-perform') process.exit(23);
  await rpc('tools/call', { name: 'ambercast_evaluate_assert', arguments: { check: { type: 'assert', check: 'text-visible', text: 'Agentic fixture ready' }, criterionId: ordinal === 0 ? 'first-complete' : 'second-complete' } });
  const finalOutcome = mode === 'malformed-after-success' ? '{"outcome":"success","extra":true}' : '{"outcome":"success"}';
  process.stdout.write(JSON.stringify({ result: finalOutcome }));
  process.exit(0);
})().catch((error) => {
  process.stderr.write(String(error) + '\\n');
  process.exit(1);
});
`;

    await writeFile(counterPath, '');
    await writeFile(executablePath, source);
    await chmod(executablePath, 0o755);

    let cleaned = false;
    return {
      pathEntry: sentinelDirectory,
      readyPath,
      async invocations(): Promise<readonly string[][]> {
        const content = await readFile(counterPath, 'utf8');
        return content.split('\n').filter((line) => line.length > 0).map((line) => JSON.parse(line) as string[]);
      },
      async cleanup(): Promise<void> {
        if (cleaned) return;
        cleaned = true;
        await rm(sentinelDirectory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (directory !== undefined) {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
    throw error;
  }
}
