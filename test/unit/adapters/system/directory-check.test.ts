import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDirectoryCheck } from '#adapters/system/directory-check.js';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ambercast-directory-check-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('createDirectoryCheck()', () => {
  it('returns true for an existing directory', async () => {
    const directory = await temporaryDirectory();
    await expect(createDirectoryCheck()(directory)).resolves.toBe(true);
  });

  it('returns false for an existing regular file', async () => {
    const directory = await temporaryDirectory();
    const file = join(directory, 'file');
    await writeFile(file, 'file');
    await expect(createDirectoryCheck()(file)).resolves.toBe(false);
  });

  it('returns false for an absent path', async () => {
    const directory = await temporaryDirectory();
    await expect(createDirectoryCheck()(join(directory, 'absent'))).resolves.toBe(false);
  });

  it('returns false when a regular file is the path parent', async () => {
    const directory = await temporaryDirectory();
    const parent = join(directory, 'file-parent');
    await writeFile(parent, 'file');
    await expect(createDirectoryCheck()(join(parent, 'child'))).resolves.toBe(false);
  });

  it('follows a symbolic link to a directory', async () => {
    const directory = await temporaryDirectory();
    const target = join(directory, 'target');
    const link = join(directory, 'link');
    await mkdir(target);
    await symlink(target, link);
    await expect(createDirectoryCheck()(link)).resolves.toBe(true);
  });
});
