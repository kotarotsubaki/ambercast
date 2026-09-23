import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { runMcpCommand } from '#runtime/mcp-command.js';

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
});

describe('runtime/mcp-command', () => {
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
    expect(io.errors()).toBe('');
    expect(io.output()).toBe('');
  });
});
