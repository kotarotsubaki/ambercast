import { access, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildCodexInvocation } from '#adapters/ai/agentic/codex-invocation.js';

const fsMocks = vi.hoisted(() => ({
  mkdtemp: vi.fn(),
  rm: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:fs/promises')>(),
  mkdtemp: fsMocks.mkdtemp,
  rm: fsMocks.rm,
  writeFile: fsMocks.writeFile,
}));

beforeEach(async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  fsMocks.mkdtemp.mockImplementation(actual.mkdtemp);
  fsMocks.rm.mockImplementation(actual.rm);
  fsMocks.writeFile.mockImplementation(actual.writeFile);
});

afterEach(() => vi.clearAllMocks());

function paths(args: readonly string[]): { readonly schemaPath: string; readonly outputPath: string } {
  const schemaPath = args[args.indexOf('--output-schema') + 1];
  const outputPath = args[args.indexOf('-o') + 1];
  if (schemaPath === undefined || outputPath === undefined) throw new Error('Expected Codex artifact paths.');
  return { schemaPath, outputPath };
}

describe('buildCodexInvocation', () => {
  it('uses the isolated MCP configuration, puts its token in env, and reads the output file', async () => {
    const token = 'test-token';
    const invocation = await buildCodexInvocation('http://127.0.0.1:4312/mcp', token);
    const { schemaPath, outputPath } = paths(invocation.args);

    try {
      expect(invocation.command).toBe('codex');
      expect(invocation.args).toEqual([
        'exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--ignore-user-config', '--strict-config',
        '-c', 'mcp_servers.ambercast.url=http://127.0.0.1:4312/mcp',
        '-c', 'mcp_servers.ambercast.bearer_token_env_var=AMBERCAST_MCP_BEARER_TOKEN',
        '-c', 'mcp_servers.ambercast.required=true',
        '-c', 'mcp_servers.ambercast.enabled_tools=["ambercast_perform","ambercast_evaluate_assert","ambercast_snapshot"]',
        '--output-schema', schemaPath, '-o', outputPath, '-',
      ]);
      expect(invocation.args.join(' ')).not.toContain(token);
      expect(invocation.env).toEqual({ AMBERCAST_MCP_BEARER_TOKEN: token });
      expect(JSON.parse(await readFile(schemaPath, 'utf8'))).toMatchObject({
        type: 'object', required: ['outcome'], additionalProperties: false,
      });
      await writeFile(outputPath, '{"outcome":"failure"}');
      await expect(invocation.readFinalOutcome({
        outcome: 'exited', stdout: '', stderr: '', exitCode: 0,
      })).resolves.toEqual({ outcome: 'failure' });
    } finally {
      await invocation.cleanup();
    }

    await expect(access(schemaPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(dirname(schemaPath))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects output that violates the strict final-outcome schema', async () => {
    const invocation = await buildCodexInvocation('http://127.0.0.1:4312/mcp', 'test-token');
    const { outputPath } = paths(invocation.args);

    try {
      await writeFile(outputPath, '{"outcome":"success","extra":true}');
      await expect(invocation.readFinalOutcome({
        outcome: 'exited', stdout: '', stderr: '', exitCode: 0,
      })).rejects.toThrow();
    } finally {
      await invocation.cleanup();
    }
  });

  it('removes a partially created directory and preserves the setup error', async () => {
    const error = new Error('cannot write response schema');
    fsMocks.mkdtemp.mockResolvedValue('/tmp/ambercast-codex-partial');
    fsMocks.writeFile.mockRejectedValueOnce(error);
    fsMocks.rm.mockResolvedValue(undefined);

    await expect(buildCodexInvocation('http://127.0.0.1:4312/mcp', 'test-token')).rejects.toBe(error);
    expect(fsMocks.rm).toHaveBeenCalledWith('/tmp/ambercast-codex-partial', { recursive: true, force: true });
  });
});
