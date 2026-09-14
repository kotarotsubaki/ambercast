import { access, readFile, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildClaudeInvocation } from '#adapters/ai/agentic/claude-invocation.js';

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

describe('buildClaudeInvocation', () => {
  it('keeps the bearer token in a mode-0600 MCP config and parses Claude structured output', async () => {
    const token = 'test-token';
    const invocation = await buildClaudeInvocation('http://127.0.0.1:4312/mcp', token);
    const configIndex = invocation.args.indexOf('--mcp-config');
    const configPath = invocation.args[configIndex + 1];

    if (configPath === undefined) throw new Error('Expected an MCP config path.');

    try {
      expect(invocation.command).toBe('claude');
      expect(invocation.args).toEqual(expect.arrayContaining([
        '-p', '--output-format', 'json', '--json-schema', expect.any(String), '--setting-sources', 'user',
        '--mcp-config', configPath, '--strict-mcp-config',
        '--allowed-tools', 'mcp__ambercast__ambercast_perform mcp__ambercast__ambercast_evaluate_assert mcp__ambercast__ambercast_snapshot',
        '--tools', '',
      ]));
      expect(invocation.args.join(' ')).not.toContain(token);
      expect(invocation.env).toEqual({});
      expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual({
        mcpServers: {
          ambercast: {
            type: 'http',
            url: 'http://127.0.0.1:4312/mcp',
            headers: { Authorization: `Bearer ${token}` },
          },
        },
      });
      expect((await stat(configPath)).mode & 0o777).toBe(0o600);
      await expect(invocation.readFinalOutcome({
        outcome: 'exited', stdout: '{"result":"{\\"outcome\\":\\"success\\"}"}', stderr: '', exitCode: 0,
      })).resolves.toEqual({ outcome: 'success' });
    } finally {
      await invocation.cleanup();
    }

    await expect(access(configPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(dirname(configPath))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a Claude result that violates the strict final-outcome schema', async () => {
    const invocation = await buildClaudeInvocation('http://127.0.0.1:4312/mcp', 'test-token');

    try {
      await expect(invocation.readFinalOutcome({
        outcome: 'exited', stdout: '{"result":"{\\"outcome\\":\\"success\\",\\"extra\\":true}"}', stderr: '', exitCode: 0,
      })).rejects.toThrow();
    } finally {
      await invocation.cleanup();
    }
  });

  it('removes a partially created directory and preserves the setup error', async () => {
    const error = new Error('cannot write MCP config');
    fsMocks.mkdtemp.mockResolvedValue('/tmp/ambercast-claude-partial');
    fsMocks.writeFile.mockRejectedValueOnce(error);
    fsMocks.rm.mockResolvedValue(undefined);

    await expect(buildClaudeInvocation('http://127.0.0.1:4312/mcp', 'test-token')).rejects.toBe(error);
    expect(fsMocks.rm).toHaveBeenCalledWith('/tmp/ambercast-claude-partial', { recursive: true, force: true });
  });
});
