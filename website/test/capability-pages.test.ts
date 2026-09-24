import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { plannedPageSlugs, readCapabilityPages } from '../scripts/lib/capability-pages.mjs';
import mapping from '../src/data/capability-pages.json';

const tempDirs: string[] = [];
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function mappingFile(value: unknown) {
  const dir = await mkdtemp(join(tmpdir(), 'ambercast-capability-pages-'));
  tempDirs.push(dir);
  const path = join(dir, 'capability-pages.json');
  await writeFile(path, JSON.stringify(value));
  return path;
}

describe('readCapabilityPages', () => {
  it.each([
    ['a string', 'x'],
    ['an empty array', []],
    ['an array of numbers', [1, 2]],
    ['an array containing an empty string', ['']],
  ])('rejects capabilities.view containing %s', async (_case, view) => {
    const path = await mappingFile({ capabilities: { view }, unlisted: {} });
    const message = 'capability-pages.json: capabilities.view must be a non-empty array of non-empty strings';
    await expect(readCapabilityPages(path)).rejects.toThrow(new RegExp(`^${escapeRegExp(message)}$`));
  });

  it('returns a valid mapping unchanged', async () => {
    const path = await mappingFile(mapping);
    await expect(readCapabilityPages(path)).resolves.toStrictEqual(mapping);
  });
});

describe('plannedPageSlugs', () => {
  it('returns the sorted six-page union, deduplicating the shared baseline/restore page', () => {
    expect(plannedPageSlugs(mapping)).toEqual([
      'agents/mcp-server',
      'reference/cli/baseline-restore',
      'reference/cli/mcp',
      'reference/cli/review',
      'reference/mcp-tools',
    ]);
  });

  it('deduplicates repeated values within one capability as well as across capabilities', () => {
    expect(plannedPageSlugs({ capabilities: { a: ['z', 'z'], b: ['z', 'a'] }, unlisted: { a: {} } })).toEqual(['a', 'z']);
  });
});
