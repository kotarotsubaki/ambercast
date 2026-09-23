import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { PassThrough } from 'node:stream';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { McpServerDeps } from '#adapters/mcp/types.js';
import { runMcpCommand } from '#runtime/mcp-command.js';
import { runRunCommand, type RunCommandOutput } from '#runtime/run-command.js';

const serverFake = vi.hoisted(() => ({ connected: vi.fn(), called: vi.fn() }));
vi.mock('#adapters/mcp/server.js', () => ({
  createMcpServer: (deps: McpServerDeps) => {
    const server = new Server({ name: 'shutdown-test', version: '1.0.0' }, { capabilities: { tools: {} } });
    server.setRequestHandler(CallToolRequestSchema, async () => {
      serverFake.called();
      const result = await deps.run({}, { progressToken: undefined, sendNotification: async () => {} });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.envelope) }] };
    });
    return {
      connect: async (transport: Parameters<typeof server.connect>[0]) => {
        await server.connect(transport);
        serverFake.connected();
      },
      close: () => server.close(),
    };
  },
}));
vi.mock('#runtime/run-command.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#runtime/run-command.js')>();
  return { ...actual, runRunCommand: vi.fn(actual.runRunCommand) };
});

const temporaryDirectories: string[] = [];

async function fixtureDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ambercast-mcp-unit-'));
  temporaryDirectories.push(directory);
  return directory;
}

function streams() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let output = '';
  let errors = '';
  stdout.setEncoding('utf8');
  stderr.setEncoding('utf8');
  stdout.on('data', (chunk: string) => { output += chunk; });
  stderr.on('data', (chunk: string) => { errors += chunk; });
  return { stdin, stdout, stderr, output: () => output, errors: () => errors };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  vi.clearAllMocks();
});

describe('runtime/mcp-command', () => {
  it('aborts an active call on SIGTERM and returns its INTERRUPTED envelope with exit 0 (TEST-B9)', async () => {
    vi.mocked(runRunCommand).mockImplementationOnce(({ signal }) => new Promise<RunCommandOutput>((resolve) => {
      signal?.addEventListener('abort', () => resolve({
        exitCode: 4,
        envelope: {
          schemaVersion: '3.6', command: 'run', startedAt: '2026-08-09T00:00:00Z', durationMs: 0,
          summary: { total: 0, passed: 0, failed: 0, errored: 0, skipped: 0 },
          errors: [{ scope: 'run', kind: 'environment', code: 'INTERRUPTED', message: 'Run interrupted.' }],
          results: [], reportPersistence: 'not-attempted',
        },
      } as unknown as RunCommandOutput), { once: true });
    }));
    const io = streams();
    const directory = await fixtureDirectory();
    const running = runMcpCommand({ dir: directory, syncWaitMs: 45_000, ...io }).then((code) => ({ code }), (error: unknown) => ({ error }));
    await vi.waitFor(() => expect(serverFake.connected).toHaveBeenCalled());
    io.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } } })}\n`);
    io.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'ambercast_run', arguments: {} } })}\n`);
    await vi.waitFor(() => expect(serverFake.called).toHaveBeenCalledTimes(1));
    process.emit('SIGTERM');
    expect(await running).toEqual({ code: 0 });
    expect(io.output()).toContain('INTERRUPTED');
  });

  it('returns exit 3 when an active call ignores abort beyond ten seconds (TEST-B9)', async () => {
    vi.mocked(runRunCommand).mockImplementationOnce(() => new Promise<RunCommandOutput>(() => {}));
    vi.useFakeTimers();
    try {
      const io = streams();
      const directory = await fixtureDirectory();
      const running = runMcpCommand({ dir: directory, syncWaitMs: 45_000, ...io }).then((code) => ({ code }), (error: unknown) => ({ error }));
      await vi.waitFor(() => expect(serverFake.connected).toHaveBeenCalled());
      io.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ambercast_run', arguments: {} } })}\n`);
      await vi.waitFor(() => expect(serverFake.called).toHaveBeenCalledTimes(1));
      process.emit('SIGTERM');
      await vi.advanceTimersByTimeAsync(10_001);
      expect(await running).toEqual({ code: 3 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a new call during drain before it reaches the tool handler and logs its count (TEST-B9)', async () => {
    const io = streams();
    const directory = await fixtureDirectory();
    const running = runMcpCommand({ dir: directory, syncWaitMs: 45_000, ...io }).then((code) => ({ code }), (error: unknown) => ({ error }));
    await vi.waitFor(() => expect(serverFake.connected).toHaveBeenCalled());
    process.emit('SIGTERM');
    io.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'ambercast_run', arguments: {} } })}\n`);
    expect(await running).toEqual({ code: 0 });
    expect(serverFake.called).not.toHaveBeenCalled();
    expect(io.errors().trim().split('\n')).toEqual([
      `ambercast mcp: serving ${directory}`,
      expect.stringMatching(/1.*reject|reject.*1/i),
    ]);
  });
  it('rejects a missing --dir with the resolved path and exit 2 (TEST-B1)', async () => {
    const directory = await fixtureDirectory();
    const missing = join(directory, 'missing');
    const io = streams();
    io.stdin.end();

    const exitCode = await runMcpCommand({ dir: relative(process.cwd(), missing), syncWaitMs: 45_000, ...io });

    expect(exitCode).toBe(2);
    expect(io.errors()).toBe(`ambercast mcp: --dir ${missing} is not a directory.\n`);
    expect(io.output()).toBe('');
  });

  it('rejects a file supplied as --dir with exit 2 (TEST-B1)', async () => {
    const directory = await fixtureDirectory();
    const file = join(directory, 'not-a-directory');
    await writeFile(file, 'fixture');
    const io = streams();
    io.stdin.end();

    const exitCode = await runMcpCommand({ dir: file, syncWaitMs: 45_000, ...io });

    expect(exitCode).toBe(2);
    expect(io.errors()).toBe(`ambercast mcp: --dir ${file} is not a directory.\n`);
    expect(io.output()).toBe('');
  });

  it('starts without a config and accepts the smallest positive sync wait (TEST-B5, TEST-B10)', async () => {
    const directory = await fixtureDirectory();
    const io = streams();
    io.stdin.end();

    const exitCode = await runMcpCommand({ dir: directory, syncWaitMs: 1, ...io });

    expect(exitCode).toBe(0);
    expect(io.errors()).toBe(`ambercast mcp: serving ${directory}\n`);
    expect(io.output()).toBe('');
  });
});
