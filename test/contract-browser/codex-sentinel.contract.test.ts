import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createCodexSentinel, type CodexSentinel, type CodexSentinelOptions } from './support/codex-sentinel.js';

const executeFile = promisify(execFile);

describe('codex sentinel proposal option', () => {
  let originalTmpdir: string | undefined;
  let dedicatedTmpdir: string;
  const sentinels: CodexSentinel[] = [];

  beforeAll(async () => {
    originalTmpdir = process.env.TMPDIR;
    dedicatedTmpdir = await mkdtemp(join(tmpdir(), 'ambercast-sentinel-contract-'));
    process.env.TMPDIR = dedicatedTmpdir;
  });

  afterEach(async () => {
    await Promise.all(sentinels.splice(0).map((sentinel) => sentinel.cleanup()));
  });

  async function sentinelDirectories(): Promise<string[]> {
    const entries = await readdir(dedicatedTmpdir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('ambercast-codex-sentinel-'))
      .map((entry) => entry.name)
      .sort();
  }

  afterAll(async () => {
    try {
      expect(await sentinelDirectories()).toEqual([]);
    } finally {
      if (originalTmpdir === undefined) {
        delete process.env.TMPDIR;
      } else {
        process.env.TMPDIR = originalTmpdir;
      }
      await rm(dedicatedTmpdir, { recursive: true, force: true });
    }
  });

  async function trackSentinel(creation: Promise<CodexSentinel>): Promise<CodexSentinel> {
    const sentinel = await creation;
    sentinels.push(sentinel);
    return sentinel;
  }

  async function proposalBytes(sentinel: CodexSentinel): Promise<Buffer> {
    const outputPath = join(sentinel.pathEntry, 'proposal.json');
    await executeFile(join(sentinel.pathEntry, 'codex'), ['exec', '-o', outputPath]);
    return readFile(outputPath);
  }

  // TEST-17 / SPEC-10: proposal customization preserves the default byte contract.
  it('preserves the exact default proposal bytes with no options', async () => {
    const sentinel = await trackSentinel(createCodexSentinel());
    const bytes = await proposalBytes(sentinel);
    expect(Buffer.compare(bytes, Buffer.from('{"proposal":{"outcome":"found","role":"button","name":"Submit"}}'))).toBe(0);
  });

  it('emits the custom proposal with outcome, role, and name in order', async () => {
    const sentinel = await trackSentinel(createCodexSentinel({ proposal: { role: 'button', name: 'Send' } }));
    const bytes = await proposalBytes(sentinel);
    expect(Buffer.compare(bytes, Buffer.from('{"proposal":{"outcome":"found","role":"button","name":"Send"}}'))).toBe(0);
  });

  it('round-trips quotes, backslashes, newlines, and backticks in a proposal name', async () => {
    const name = 'Sa"y\\it\n`now`';
    const sentinel = await trackSentinel(createCodexSentinel({ proposal: { role: 'button', name } }));
    const bytes = await proposalBytes(sentinel);
    expect(JSON.parse(bytes.toString('utf8')).proposal.name).toBe(name);
  });

  const invalidCases: {
    label: string;
    options: CodexSentinelOptions;
    error: typeof RangeError | typeof TypeError;
  }[] = [
    { label: 'an uppercase role', options: { proposal: { role: 'Button', name: 'Send' } }, error: RangeError },
    { label: 'a whitespace-only name', options: { proposal: { role: 'button', name: '  ' } }, error: RangeError },
    { label: 'missing role and name', options: { proposal: {} } as CodexSentinelOptions, error: TypeError },
    { label: 'a non-string name', options: { proposal: { role: 'button', name: 1 as unknown as string } }, error: TypeError },
    { label: 'null options', options: null as unknown as CodexSentinelOptions, error: TypeError },
  ];

  it.each(invalidCases)('rejects $label at creation without filesystem litter', async ({ options, error }) => {
    const before = await sentinelDirectories();
    try {
      await expect(trackSentinel(createCodexSentinel(options))).rejects.toBeInstanceOf(error);
    } finally {
      const after = await sentinelDirectories();
      expect(after.length - before.length).toBe(0);
      expect(after).toEqual(before);
    }
  });

  it('trims surrounding whitespace from the emitted name', async () => {
    const sentinel = await trackSentinel(createCodexSentinel({ proposal: { role: 'button', name: '  Send ' } }));
    const bytes = await proposalBytes(sentinel);
    expect(Buffer.compare(bytes, Buffer.from('{"proposal":{"outcome":"found","role":"button","name":"Send"}}'))).toBe(0);
  });
});
