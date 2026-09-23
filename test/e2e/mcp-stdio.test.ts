import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const binPath = fileURLToPath(new URL('../../bin/ambercast.js', import.meta.url));
const temporaryDirectories: string[] = [];
const children: Array<{ child: ChildProcessWithoutNullStreams; exited: Promise<unknown> }> = [];

interface ServerProcess {
  readonly child: ChildProcessWithoutNullStreams;
  readonly lines: string[];
  readonly stderr: () => string;
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  request(id: number, method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
}

async function fixtureDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ambercast-mcp-stdio-'));
  temporaryDirectories.push(directory);
  return directory;
}

function startServer(args: readonly string[], cwd = repoRoot): ServerProcess {
  const child = spawn(process.execPath, [binPath, 'mcp', ...args], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  const lines: string[] = [];
  let errors = '';
  const reader = createInterface({ input: child.stdout });
  reader.on('line', (line) => { lines.push(line); });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => { errors += chunk; });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  children.push({ child, exited });

  return {
    child,
    lines,
    stderr: () => errors,
    exited,
    request(id, method, params = {}) {
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        const onLine = (line: string): void => {
          try {
            const message = JSON.parse(line) as Record<string, unknown>;
            if (message.id === id) {
              cleanup();
              resolve(message);
            }
          } catch (error) {
            cleanup();
            reject(error);
          }
        };
        const onClose = (code: number | null): void => {
          cleanup();
          reject(new Error(`MCP server closed before response ${id} (exit ${code}): ${errors}`));
        };
        const cleanup = (): void => {
          reader.off('line', onLine);
          child.off('close', onClose);
        };
        reader.on('line', onLine);
        child.once('close', onClose);
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      });
    },
  };
}

afterEach(async () => {
  const running = children.splice(0);
  for (const { child } of running) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }
  await Promise.allSettled(running.map(({ exited }) => exited));
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('e2e/mcp-stdio', () => {
  it('rejects a nonexistent --dir before writing protocol bytes (TEST-B1)', async () => {
    const directory = await fixtureDirectory();
    const missing = join(directory, 'missing');
    const server = startServer(['--dir', missing]);
    server.child.stdin.end();

    expect(await server.exited).toEqual({ code: 2, signal: null });
    expect(server.stderr()).toBe(`ambercast mcp: --dir ${missing} is not a directory.\n`);
    expect(server.lines).toEqual([]);
  }, 10_000);

  it.each([
    { args: ['--sync-wait-ms', '0'] },
    { args: ['--sync-wait-ms', '-1'] },
    { args: ['--sync-wait-ms', '1.5'] },
    { args: ['--sync-wait-ms', 'not-a-number'] },
    { args: ['--sync-wait-ms'] },
    { args: ['--bogus'] },
    { args: ['unexpected-positional'] },
  ])('rejects invalid arguments $args with usage on stderr (TEST-B1)', async ({ args }) => {
    const server = startServer(args);
    server.child.stdin.end();

    expect(await server.exited).toEqual({ code: 2, signal: null });
    expect(server.stderr()).toMatch(/usage/i);
    expect(server.lines).toEqual([]);
  }, 10_000);

  it('gives --help precedence over invalid options (TEST-B1)', async () => {
    const server = startServer(['--help', '--bogus']);
    server.child.stdin.end();

    expect(await server.exited).toEqual({ code: 0, signal: null });
    expect(server.lines.join('\n')).toMatch(/usage/i);
    expect(server.stderr()).toBe('');
  }, 10_000);

  it('exchanges initialize and tools/list over pure JSON-RPC stdout, then exits on EOF (TEST-B2, TEST-B9)', async () => {
    const directory = await fixtureDirectory();
    const server = startServer(['--dir', directory, '--sync-wait-ms', '1']);
    const initialized = await server.request(1, 'initialize', {
      protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'ambercast-stdio-test', version: '1.0.0' },
    });
    expect(initialized.result).toMatchObject({ capabilities: { tools: {} } });
    server.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

    const listed = await server.request(2, 'tools/list');
    expect(listed.result).toMatchObject({ tools: [
      { name: 'ambercast_generate' },
      { name: 'ambercast_run' },
      { name: 'ambercast_check' },
      { name: 'ambercast_heal' },
      { name: 'ambercast_job_status' },
      { name: 'ambercast_job_cancel' },
    ] });
    server.child.stdin.end();

    expect(await server.exited).toEqual({ code: 0, signal: null });
    expect(server.lines.length).toBeGreaterThanOrEqual(2);
    for (const line of server.lines) {
      const message = JSON.parse(line) as Record<string, unknown>;
      expect(message.jsonrpc).toBe('2.0');
      expect('id' in message || 'method' in message).toBe(true);
    }
  }, 10_000);

  it('does not send another response after stdin EOF followed by SIGTERM (TEST-B9)', async () => {
    const directory = await fixtureDirectory();
    const server = startServer(['--dir', directory]);
    await server.request(1, 'initialize', {
      protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'ambercast-stdio-test', version: '1.0.0' },
    });
    const lineCount = server.lines.length;

    server.child.stdin.end();
    server.child.kill('SIGTERM');

    expect(await server.exited).toEqual({ code: 0, signal: null });
    expect(server.lines).toHaveLength(lineCount);
  }, 10_000);
});
