import * as fsPromises from 'node:fs/promises';
import { chmod, lstat, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createFsStorage } from '../../../../src/adapters/storage/fs-storage.js';
import { FsIoError } from '../../../../src/core/errors/fs-io-error.js';
import { registerStorageContract } from '../../../contracts/storage.contract.js';
import { SharedFakeFs } from '../../../support/shared-fake-fs.js';

const originalFsPromises = vi.hoisted(() => ({
  lstat: undefined as typeof fsPromises.lstat | undefined,
  mkdir: undefined as typeof fsPromises.mkdir | undefined,
  readFile: undefined as typeof fsPromises.readFile | undefined,
  rename: undefined as typeof fsPromises.rename | undefined,
  rm: undefined as typeof fsPromises.rm | undefined,
  unlink: undefined as typeof fsPromises.unlink | undefined,
  writeFile: undefined as typeof fsPromises.writeFile | undefined,
}));

// Node's ESM namespace exports are non-configurable, so `vi.spyOn` cannot
// intercept them here. The load-time mock retains the real operations while
// making the two atomic-write calls observable to this test.
vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  originalFsPromises.lstat = original.lstat;
  originalFsPromises.mkdir = original.mkdir;
  originalFsPromises.readFile = original.readFile;
  originalFsPromises.rename = original.rename;
  originalFsPromises.rm = original.rm;
  originalFsPromises.unlink = original.unlink;
  originalFsPromises.writeFile = original.writeFile;

  return {
    ...original,
    lstat: vi.fn(original.lstat),
    mkdir: vi.fn(original.mkdir),
    readFile: vi.fn(original.readFile),
    rename: vi.fn(original.rename),
    rm: vi.fn(original.rm),
    unlink: vi.fn(original.unlink),
    writeFile: vi.fn(original.writeFile),
  };
});

let contractRoot: string | undefined;
let contractWorkingDirectory: string | undefined;

async function withIsolatedStorage(
  assertion: (storage: ReturnType<typeof createFsStorage>) => Promise<void>,
): Promise<void> {
  const workingDirectory = process.cwd();
  const root = await mkdtemp(join(tmpdir(), 'ambercast-fs-storage-'));

  try {
    process.chdir(root);
    await assertion(createFsStorage());
  } finally {
    process.chdir(workingDirectory);
    await rm(root, { force: true, recursive: true });
  }
}

function isSymbolicLinkPermissionError(error: unknown): error is { readonly code: 'EACCES' | 'EPERM' } {
  if (error === null || typeof error !== 'object' || !('code' in error)) {
    return false;
  }

  return error.code === 'EACCES' || error.code === 'EPERM';
}

function errorCode(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object' || !('code' in error)) {
    return undefined;
  }

  return typeof error.code === 'string' ? error.code : undefined;
}

interface AtomicWriteCase {
  readonly name: string;
  readonly targetPath: string;
  write(storage: ReturnType<typeof createFsStorage>, path: string): Promise<void>;
}

const atomicWriteCases: readonly AtomicWriteCase[] = [
  {
    name: 'text',
    targetPath: 'nested/dir/atomic-text.txt',
    async write(storage, path): Promise<void> {
      await storage.writeText(path, 'atomic text');
    },
  },
  {
    name: 'binary',
    targetPath: 'atomic-binary.bin',
    async write(storage, path): Promise<void> {
      await storage.writeBinary(path, new Uint8Array([0, 1, 255]));
    },
  },
];

interface SymlinkReplacementWriteCase {
  readonly name: string;
  write(storage: ReturnType<typeof createFsStorage>, path: string): Promise<void>;
  assertContent(storage: ReturnType<typeof createFsStorage>, path: string): Promise<void>;
}

const symlinkReplacementWriteCases: readonly SymlinkReplacementWriteCase[] = [
  {
    name: 'text',
    async write(storage, path): Promise<void> {
      await storage.writeText(path, 'symlink replacement text');
    },
    async assertContent(storage, path): Promise<void> {
      await expect(storage.readText(path)).resolves.toBe('symlink replacement text');
    },
  },
  {
    name: 'binary',
    async write(storage, path): Promise<void> {
      await storage.writeBinary(path, new Uint8Array([4, 8, 15, 16, 23, 42]));
    },
    async assertContent(storage, path): Promise<void> {
      await expect(storage.readBinary(path)).resolves.toEqual(new Uint8Array([4, 8, 15, 16, 23, 42]));
    },
  },
];

function stringPath(path: unknown): string {
  expect(path).toBeTypeOf('string');

  if (typeof path !== 'string') {
    throw new Error('Expected the filesystem operation to receive a string path.');
  }

  return path;
}

function temporaryWritePaths(calls: readonly (readonly unknown[])[], targetPath: string): readonly string[] {
  expect(calls).not.toHaveLength(0);

  const paths = calls.map(([path]) => stringPath(path));
  expect(paths).not.toContain(targetPath);

  for (const temporaryPath of paths) {
    expect(dirname(temporaryPath)).toBe(dirname(targetPath));
  }

  return paths;
}

function hasExclusiveCreateFlag(options: unknown): boolean {
  return typeof options === 'object' && options !== null && 'flag' in options && options.flag === 'wx';
}

function createFilesystemError(code: string, message: string): Error & { readonly code: string } {
  return Object.assign(new Error(message), { code });
}

function resetAtomicWriteMocks(): void {
  vi.mocked(fsPromises.writeFile).mockReset();
  vi.mocked(fsPromises.rename).mockReset();
  vi.mocked(fsPromises.rm).mockReset();
}

function requireOriginal<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`Expected the mocked filesystem module to retain its original ${name} implementation.`);
  }

  return value;
}

function installSharedFake(fake: SharedFakeFs): () => void {
  vi.mocked(fsPromises.lstat).mockReset().mockImplementation(fake.lstat as typeof fsPromises.lstat);
  vi.mocked(fsPromises.mkdir).mockReset().mockImplementation(async () => undefined);
  vi.mocked(fsPromises.readFile).mockReset().mockImplementation(fake.readFile as typeof fsPromises.readFile);
  vi.mocked(fsPromises.rename).mockReset().mockImplementation(fake.rename as typeof fsPromises.rename);
  vi.mocked(fsPromises.rm).mockReset().mockImplementation(fake.rm as typeof fsPromises.rm);
  vi.mocked(fsPromises.unlink).mockReset().mockImplementation(fake.unlink as typeof fsPromises.unlink);
  vi.mocked(fsPromises.writeFile).mockReset().mockImplementation(fake.writeFile as typeof fsPromises.writeFile);

  return () => {
    vi.mocked(fsPromises.lstat).mockReset().mockImplementation(requireOriginal(originalFsPromises.lstat, 'lstat'));
    vi.mocked(fsPromises.mkdir).mockReset().mockImplementation(requireOriginal(originalFsPromises.mkdir, 'mkdir'));
    vi.mocked(fsPromises.readFile).mockReset().mockImplementation(requireOriginal(originalFsPromises.readFile, 'readFile'));
    vi.mocked(fsPromises.rename).mockReset().mockImplementation(requireOriginal(originalFsPromises.rename, 'rename'));
    vi.mocked(fsPromises.rm).mockReset().mockImplementation(requireOriginal(originalFsPromises.rm, 'rm'));
    vi.mocked(fsPromises.unlink).mockReset().mockImplementation(requireOriginal(originalFsPromises.unlink, 'unlink'));
    vi.mocked(fsPromises.writeFile).mockReset().mockImplementation(requireOriginal(originalFsPromises.writeFile, 'writeFile'));
  };
}

async function waitForCheckpoint(
  entered: Promise<void>,
  operation: Promise<void>,
  message: string,
): Promise<void> {
  await Promise.race([
    entered,
    operation.then(
      () => {
        throw new Error(message);
      },
      (error: unknown) => {
        throw error;
      },
    ),
  ]);
}

registerStorageContract({
  async createStorage() {
    contractWorkingDirectory = process.cwd();
    contractRoot = await mkdtemp(join(tmpdir(), 'ambercast-fs-storage-contract-'));
    process.chdir(contractRoot);

    return createFsStorage();
  },
  async dispose() {
    const root = contractRoot;
    const workingDirectory = contractWorkingDirectory;

    contractRoot = undefined;
    contractWorkingDirectory = undefined;

    try {
      if (workingDirectory !== undefined) {
        process.chdir(workingDirectory);
      }
    } finally {
      if (root !== undefined) {
        await rm(root, { force: true, recursive: true });
      }
    }
  },
});

describe('createFsStorage()', () => {
  it.each(atomicWriteCases)('writes $name content to a temporary path before renaming it to the target', async ({ targetPath, write }) => {
    await withIsolatedStorage(async (storage) => {
      const writeFileMock = vi.mocked(fsPromises.writeFile);
      const renameMock = vi.mocked(fsPromises.rename);
      resetAtomicWriteMocks();

      try {
        await write(storage, targetPath);

        const temporaryWrite = writeFileMock.mock.calls[0];
        expect(temporaryWrite).toBeDefined();

        if (temporaryWrite === undefined) {
          throw new Error('Expected writeFile to receive a temporary path.');
        }

        const temporaryPaths = temporaryWritePaths(writeFileMock.mock.calls, targetPath);
        const [temporaryPath] = temporaryWrite;
        expect(temporaryPaths).toContain(stringPath(temporaryPath));
        expect(renameMock).toHaveBeenCalledWith(temporaryPath, targetPath);

        const temporaryWriteOrder = writeFileMock.mock.invocationCallOrder[writeFileMock.mock.calls.indexOf(temporaryWrite)];
        const matchingRenameCallIndex = renameMock.mock.calls.findIndex(([sourcePath, destinationPath]) => {
          return sourcePath === temporaryPath && destinationPath === targetPath;
        });
        const renameOrder = renameMock.mock.invocationCallOrder[matchingRenameCallIndex];

        expect(temporaryWriteOrder).toBeDefined();
        expect(matchingRenameCallIndex).toBeGreaterThanOrEqual(0);
        expect(renameOrder).toBeDefined();

        if (temporaryWriteOrder === undefined || renameOrder === undefined) {
          throw new Error('Expected the temporary write and its target rename to have recorded call order.');
        }

        expect(renameOrder).toBeGreaterThan(temporaryWriteOrder);
      } finally {
        resetAtomicWriteMocks();
      }
    });
  });

  it.each(atomicWriteCases)('waits for the temporary $name write to settle before renaming it to the target', async ({ targetPath, write }) => {
    await withIsolatedStorage(async (storage) => {
      const writeFileMock = vi.mocked(fsPromises.writeFile);
      const renameMock = vi.mocked(fsPromises.rename);
      let resolveTemporaryWrite: (() => void) | undefined;

      resetAtomicWriteMocks();
      writeFileMock.mockImplementationOnce(async (...arguments_) => {
        await new Promise<void>((resolve) => {
          resolveTemporaryWrite = resolve;
        });

        const originalWriteFile = originalFsPromises.writeFile;
        if (originalWriteFile === undefined) {
          throw new Error('Expected the mocked filesystem module to retain its original writeFile implementation.');
        }

        await originalWriteFile(...arguments_);
      });

      try {
        const writing = write(storage, targetPath);
        void writing.catch(() => undefined);

        await vi.waitFor(() => {
          expect(writeFileMock).toHaveBeenCalledTimes(1);
        });
        expect(renameMock).not.toHaveBeenCalled();

        if (resolveTemporaryWrite === undefined) {
          throw new Error('Expected the temporary write to remain pending until this test resolves it.');
        }

        resolveTemporaryWrite();
        await expect(writing).resolves.toBeUndefined();

        const [temporaryPath] = temporaryWritePaths(writeFileMock.mock.calls, targetPath);
        expect(renameMock).toHaveBeenCalledWith(temporaryPath, targetPath);
      } finally {
        resetAtomicWriteMocks();
      }
    });
  });

  it.each(atomicWriteCases)('retries a $name write with a fresh exclusively-created temporary path after an EEXIST collision', async ({ targetPath, write }) => {
    await withIsolatedStorage(async (storage) => {
      const writeFileMock = vi.mocked(fsPromises.writeFile);
      const renameMock = vi.mocked(fsPromises.rename);
      const collisionError = createFilesystemError('EEXIST', 'temporary file already exists');

      resetAtomicWriteMocks();
      writeFileMock.mockRejectedValueOnce(collisionError);

      try {
        await expect(write(storage, targetPath)).resolves.toBeUndefined();

        const paths = temporaryWritePaths(writeFileMock.mock.calls, targetPath);
        expect(paths).toHaveLength(2);
        expect(new Set(paths).size).toBe(2);
        expect(writeFileMock.mock.calls.every(([, , options]) => hasExclusiveCreateFlag(options))).toBe(true);
        expect(renameMock).toHaveBeenCalledWith(paths[1], targetPath);
      } finally {
        resetAtomicWriteMocks();
      }
    });
  });

  it.each(atomicWriteCases)('rejects a $name write after bounded EEXIST collisions without removing another writer\'s temporary path', async ({ targetPath, write }) => {
    await withIsolatedStorage(async (storage) => {
      const writeFileMock = vi.mocked(fsPromises.writeFile);
      const renameMock = vi.mocked(fsPromises.rename);
      const rmMock = vi.mocked(fsPromises.rm);
      const collisionError = createFilesystemError('EEXIST', 'temporary file already exists');

      resetAtomicWriteMocks();
      writeFileMock.mockRejectedValue(collisionError);

      try {
        await expect(write(storage, targetPath)).rejects.toBe(collisionError);

        const paths = temporaryWritePaths(writeFileMock.mock.calls, targetPath);
        expect(paths.length).toBeGreaterThan(1);
        expect(paths.length).toBeLessThanOrEqual(5);
        expect(new Set(paths).size).toBe(paths.length);
        expect(writeFileMock.mock.calls.every(([, , options]) => hasExclusiveCreateFlag(options))).toBe(true);
        expect(renameMock).not.toHaveBeenCalled();
        expect(rmMock).not.toHaveBeenCalled();
      } finally {
        resetAtomicWriteMocks();
      }
    });
  });

  it.each(atomicWriteCases)('removes the $name temporary file and preserves a non-collision temporary-write error', async ({ targetPath, write }) => {
    await withIsolatedStorage(async (storage) => {
      const writeFileMock = vi.mocked(fsPromises.writeFile);
      const renameMock = vi.mocked(fsPromises.rename);
      const rmMock = vi.mocked(fsPromises.rm);
      const writeError = createFilesystemError('EACCES', 'temporary file is not writable');
      const cleanupError = new Error('cleanup failed');

      resetAtomicWriteMocks();
      writeFileMock.mockRejectedValueOnce(writeError);
      rmMock.mockRejectedValueOnce(cleanupError);

      try {
        await expect(write(storage, targetPath)).rejects.toBe(writeError);

        const [temporaryPath] = temporaryWritePaths(writeFileMock.mock.calls, targetPath);
        expect(renameMock).not.toHaveBeenCalled();
        expect(rmMock).toHaveBeenCalledWith(temporaryPath, { force: true });
      } finally {
        resetAtomicWriteMocks();
      }
    });
  });

  it.each(atomicWriteCases)('removes the $name temporary file and preserves the rename error', async ({ targetPath, write }) => {
    await withIsolatedStorage(async (storage) => {
      const writeFileMock = vi.mocked(fsPromises.writeFile);
      const renameMock = vi.mocked(fsPromises.rename);
      const rmMock = vi.mocked(fsPromises.rm);
      const renameError = new Error('rename failed');

      resetAtomicWriteMocks();
      renameMock.mockRejectedValueOnce(renameError);

      try {
        await expect(write(storage, targetPath)).rejects.toBe(renameError);

        const [temporaryPath] = temporaryWritePaths(writeFileMock.mock.calls, targetPath);
        expect(rmMock).toHaveBeenCalledWith(temporaryPath, { force: true });
      } finally {
        resetAtomicWriteMocks();
      }
    });
  });

  it.each(atomicWriteCases)('preserves the $name rename error when temporary-file cleanup also fails', async ({ targetPath, write }) => {
    await withIsolatedStorage(async (storage) => {
      const writeFileMock = vi.mocked(fsPromises.writeFile);
      const renameMock = vi.mocked(fsPromises.rename);
      const rmMock = vi.mocked(fsPromises.rm);
      const renameError = new Error('rename failed');
      const cleanupError = new Error('cleanup failed');

      resetAtomicWriteMocks();
      renameMock.mockRejectedValueOnce(renameError);
      rmMock.mockRejectedValueOnce(cleanupError);

      try {
        await expect(write(storage, targetPath)).rejects.toBe(renameError);

        const [temporaryPath] = temporaryWritePaths(writeFileMock.mock.calls, targetPath);
        expect(rmMock).toHaveBeenCalledWith(temporaryPath, { force: true });
      } finally {
        resetAtomicWriteMocks();
      }
    });
  });

  it('treats the empty path as the isolated root for directory preparation and listing', async () => {
    await withIsolatedStorage(async (storage) => {
      await expect(storage.ensureDir('')).resolves.toBeUndefined();
      await storage.writeText('root.txt', 'root file');

      await expect(storage.listFiles('')).resolves.toEqual(['root.txt']);
    });
  });

  it('round-trips a Unicode filename', async () => {
    await withIsolatedStorage(async (storage) => {
      const filename = '結果-世界-🌏.txt';

      await storage.writeText(filename, 'Unicode filename content');

      await expect(storage.readText(filename)).resolves.toBe('Unicode filename content');
    });
  });

  it('distinguishes successful empty text from a missing file', async () => {
    await withIsolatedStorage(async (storage) => {
      await storage.writeText('empty.txt', '');

      await expect(storage.readText('empty.txt')).resolves.toBe('');
    });
  });

  it('does not report or list a dangling symbolic link as a regular file', async (context) => {
    await withIsolatedStorage(async (storage) => {
      try {
        await symlink('missing-target.txt', 'dangling-link.txt');
      } catch (error) {
        if (isSymbolicLinkPermissionError(error)) {
          context.skip(`Symbolic links require unavailable filesystem permission (${error.code}).`);
        }

        throw error;
      }

      await expect(storage.exists('dangling-link.txt')).resolves.toBe(false);
      await expect(storage.listFiles('')).resolves.toEqual([]);
    });
  });

  it.for(symlinkReplacementWriteCases)('replaces live and dangling file symbolic links when writing $name content', async ({ write, assertContent }, context) => {
    await withIsolatedStorage(async (storage) => {
      const liveTargetPath = 'live-target.txt';
      const liveLinkPath = 'live-link.txt';
      const danglingTargetPath = 'missing-target.txt';
      const danglingLinkPath = 'dangling-link.txt';

      await writeFile(liveTargetPath, 'original target content', 'utf8');

      try {
        await symlink(liveTargetPath, liveLinkPath, 'file');
        await symlink(danglingTargetPath, danglingLinkPath, 'file');
      } catch (error) {
        if (isSymbolicLinkPermissionError(error)) {
          context.skip(`Symbolic links require unavailable filesystem permission (${error.code}).`);
        }

        throw error;
      }

      await write(storage, liveLinkPath);

      expect((await lstat(liveLinkPath)).isSymbolicLink()).toBe(false);
      await assertContent(storage, liveLinkPath);
      await expect(storage.readText(liveTargetPath)).resolves.toBe('original target content');

      await write(storage, danglingLinkPath);

      expect((await lstat(danglingLinkPath)).isSymbolicLink()).toBe(false);
      await assertContent(storage, danglingLinkPath);
      await expect(lstat(danglingTargetPath)).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });

  it('rejects file and directory name conflicts', async () => {
    await withIsolatedStorage(async (storage) => {
      await mkdir('directory');
      await writeFile('file.txt', 'existing file', 'utf8');

      await expect(storage.writeText('directory', 'cannot replace a directory')).rejects.toBeInstanceOf(Error);
      await expect(storage.ensureDir('file.txt')).rejects.toBeInstanceOf(Error);
    });
  });

  it('resolves false rather than rejecting when a path has a file component', async () => {
    await withIsolatedStorage(async (storage) => {
      await writeFile('not-a-directory', 'file component', 'utf8');

      await expect(storage.exists('not-a-directory/child.txt')).resolves.toBe(false);
    });
  });

  it('rethrows ENOTDIR when listing below a regular file', async () => {
    await withIsolatedStorage(async (storage) => {
      await writeFile('not-a-directory', 'file component', 'utf8');

      let thrown: unknown;
      try {
        await storage.listFiles(join('not-a-directory', 'child.txt'));
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(Error);
      expect(errorCode(thrown)).toBe('ENOTDIR');
    });
  });

  it('rethrows non-missing directory-listing errors when permissions are enforced', async (context) => {
    await withIsolatedStorage(async (storage) => {
      const restrictedDirectory = 'restricted-directory';
      await mkdir(restrictedDirectory);

      try {
        await chmod(restrictedDirectory, 0o000);

        let directListingError: unknown;
        try {
          await readdir(restrictedDirectory);
        } catch (error) {
          directListingError = error;
        }

        if (directListingError === undefined) {
          context.skip('Directory permissions are not enforced; cannot exercise listing error propagation.');
          return;
        }

        if (errorCode(directListingError) === 'EACCES') {
          let thrown: unknown;
          try {
            await storage.listFiles(restrictedDirectory);
          } catch (error) {
            thrown = error;
          }

          expect(thrown).toBeInstanceOf(Error);
          expect(errorCode(thrown)).toBe('EACCES');
          return;
        }

        await expect(storage.listFiles(restrictedDirectory)).rejects.toBeInstanceOf(Error);
      } finally {
        await chmod(restrictedDirectory, 0o700);
      }
    });
  });

  it('rejects an exclusive update through a symbolic-link target before opening its lock', async () => {
    const fake = new SharedFakeFs();
    fake.setSymbolicLink('/shared/config.json');
    const restore = installSharedFake(fake);
    try {
      await expect(createFsStorage().updateTextExclusive('/shared/config.json', () => '{"ok":true}\n'))
        .rejects.toBeInstanceOf(FsIoError);
      expect(fake.calls.filter((call) => call.operation === 'writeFile')).toEqual([]);
    } finally {
      restore();
    }
  });

  it('serializes two independently-created adapters through the lock before either merge can lose a name', async () => {
    const fake = new SharedFakeFs();
    fake.setText('/shared/config.json', '{"names":[]}');
    const restore = installSharedFake(fake);
    try {
      const first = createFsStorage();
      const second = createFsStorage();
      const firstUpdate = first.updateTextExclusive('/shared/config.json', (current) => `${current}A`);
      const secondUpdate = second.updateTextExclusive('/shared/config.json', (current) => `${current}B`);

      await expect(Promise.all([firstUpdate, secondUpdate])).resolves.toEqual([undefined, undefined]);
      expect(fake.text('/shared/config.json')).toContain('A');
      expect(fake.text('/shared/config.json')).toContain('B');
    } finally {
      restore();
    }
  });

  it('creates a missing parent directory before acquiring an exclusive-update lock', async () => {
    await withIsolatedStorage(async (storage) => {
      const targetPath = 'nested/config/consent.json';
      const lockPath = `${targetPath}.lock`;

      await expect(storage.updateTextExclusive(targetPath, (current) => {
        expect(current).toBeNull();
        return '{"accepted":true}\n';
      })).resolves.toBeUndefined();

      expect(vi.mocked(fsPromises.writeFile)).toHaveBeenCalledWith(
        lockPath,
        expect.any(String),
        { encoding: 'utf8', flag: 'wx' },
      );
      await expect(storage.readText(targetPath)).resolves.toBe('{"accepted":true}\n');
    });
  });

  it('checks cancellation immediately before the first lock-acquisition attempt', async () => {
    const fake = new SharedFakeFs();
    fake.setText('/shared/config.json', '{"names":[]}');
    const controller = new AbortController();
    const restore = installSharedFake(fake);
    try {
      controller.abort(new Error('stop before acquire'));
      await expect(createFsStorage().updateTextExclusive('/shared/config.json', () => '{"names":["A"]}', controller.signal))
        .rejects.toBeInstanceOf(FsIoError);
      expect(fake.calls.filter((call) => call.operation === 'writeFile')).toEqual([]);
    } finally {
      restore();
    }
  });

  it('checks a signal that becomes aborted immediately before a later lock-acquisition attempt', async () => {
    const targetPath = '/shared/config.json';
    const lockPath = `${targetPath}.lock`;
    const foreignToken = 'foreign-process-0123456789abcdef';
    const fake = new SharedFakeFs();
    fake.setText(targetPath, '{"names":[]}');
    fake.setText(lockPath, foreignToken);
    const firstAttempt = fake.pauseNext('writeFile', lockPath, 'before');
    const controller = new AbortController();
    const restore = installSharedFake(fake);
    const updating = createFsStorage().updateTextExclusive(
      targetPath,
      () => '{"names":["A"]}',
      controller.signal,
    );
    void updating.catch(() => undefined);

    try {
      await waitForCheckpoint(
        firstAttempt.entered,
        updating,
        'Expected the first lock-acquisition attempt to begin before the update settled.',
      );
      controller.abort(new Error('stop before retry'));
      firstAttempt.release();

      await expect(updating).rejects.toBeInstanceOf(FsIoError);

      const lockAttempts = fake.calls.filter((call) => (
        call.operation === 'writeFile' && call.path === lockPath && call.phase === 'before'
      ));
      expect(lockAttempts).toHaveLength(1);
      expect(fake.text(lockPath)).toBe(foreignToken);
      expect(fake.calls.filter((call) => call.operation === 'unlink')).toEqual([]);
    } finally {
      firstAttempt.release();
      await updating.catch(() => undefined);
      restore();
    }
  });

  it('reports the settled delete-and-rerun remediation after all six lock acquisitions are exhausted', async () => {
    const targetPath = '/shared/config.json';
    const lockPath = `${targetPath}.lock`;
    const fake = new SharedFakeFs();
    fake.setText(targetPath, '{"names":[]}');
    fake.setText(lockPath, 'foreign-process-0123456789abcdef');
    const restore = installSharedFake(fake);
    vi.useFakeTimers();

    try {
      const updating = createFsStorage().updateTextExclusive(targetPath, () => '{"names":["A"]}');
      const settled = updating.then(
        () => undefined,
        (error: unknown) => error,
      );
      await vi.runAllTimersAsync();

      await expect(settled).resolves.toMatchObject({
        message: `The exclusive-update lock remained held after the bounded retry period; if ambercast isn't running, delete \`${lockPath}\` and rerun.`,
        details: { path: lockPath },
      });
      expect(fake.calls.filter((call) => call.operation === 'writeFile' && call.path === lockPath)).toHaveLength(6);
    } finally {
      vi.useRealTimers();
      restore();
    }
  });

  it('checks cancellation immediately before starting the atomic target write', async () => {
    const targetPath = '/shared/config.json';
    const lockPath = `${targetPath}.lock`;
    const originalText = '{"names":[]}';
    const fake = new SharedFakeFs();
    fake.setText(targetPath, originalText);
    const controller = new AbortController();
    const restore = installSharedFake(fake);

    try {
      await expect(createFsStorage().updateTextExclusive(
        targetPath,
        () => {
          controller.abort(new Error('stop before write'));
          return '{"names":["A"]}';
        },
        controller.signal,
      )).rejects.toBeInstanceOf(FsIoError);

      expect(fake.text(targetPath)).toBe(originalText);
      expect(fake.calls.filter((call) => (
        call.operation === 'writeFile' && call.path !== lockPath
      ))).toEqual([]);
      expect(fake.calls.filter((call) => call.operation === 'rename')).toEqual([]);
      expect(fake.has(lockPath)).toBe(false);
    } finally {
      restore();
    }
  });

  it('does not admit cancellation after the atomic target write has started', async () => {
    const targetPath = '/shared/config.json';
    const lockPath = `${targetPath}.lock`;
    const replacement = '{"names":["A"]}';
    const fake = new SharedFakeFs();
    fake.setText(targetPath, '{"names":[]}');
    const controller = new AbortController();
    const restore = installSharedFake(fake);
    const writeFileMock = vi.mocked(fsPromises.writeFile);
    writeFileMock.mockImplementation(async (...arguments_) => {
      const path = stringPath(arguments_[0]);
      await fake.writeFile(path, arguments_[1], arguments_[2]);
      if (path !== lockPath) {
        controller.abort(new Error('stop after write started'));
      }
    });

    try {
      await expect(createFsStorage().updateTextExclusive(
        targetPath,
        () => replacement,
        controller.signal,
      )).resolves.toBeUndefined();

      expect(controller.signal.aborted).toBe(true);
      expect(fake.text(targetPath)).toBe(replacement);
      expect(fake.calls.some((call) => call.operation === 'rename')).toBe(true);
      expect(fake.has(lockPath)).toBe(false);
    } finally {
      restore();
    }
  });

  it('never unlinks a foreign-token lock while a competing adapter owns it', async () => {
    const targetPath = '/shared/config.json';
    const lockPath = `${targetPath}.lock`;
    const fake = new SharedFakeFs();
    fake.setText(targetPath, '{"names":[]}');
    const firstRead = fake.pauseNext('readFile', targetPath, 'after');
    const restore = installSharedFake(fake);
    const owner = createFsStorage();
    const contender = createFsStorage();
    const ownerUpdate = owner.updateTextExclusive(targetPath, (current) => `${current}A`);
    void ownerUpdate.catch(() => undefined);
    vi.useFakeTimers();

    try {
      await waitForCheckpoint(
        firstRead.entered,
        ownerUpdate,
        'Expected the lock owner to pause after reading under its acquired lock.',
      );
      const ownerToken = fake.text(lockPath);
      expect(ownerToken).toMatch(new RegExp(`^${process.pid}-[0-9a-f]{16}$`, 'u'));
      const callsBeforeContender = fake.calls.length;

      const contenderUpdate = contender.updateTextExclusive(targetPath, (current) => `${current}B`);
      void contenderUpdate.catch(() => undefined);
      await vi.advanceTimersByTimeAsync(500);
      await expect(contenderUpdate).rejects.toBeInstanceOf(FsIoError);

      const contenderRetries = fake.calls.slice(callsBeforeContender).filter((call) => (
        call.operation === 'writeFile' && call.path === lockPath && call.phase === 'before'
      ));
      expect(contenderRetries).toHaveLength(6);
      expect(fake.text(lockPath)).toBe(ownerToken);
      expect(fake.calls.filter((call) => call.operation === 'unlink' && call.path === lockPath)).toEqual([]);

      firstRead.release();
      await expect(ownerUpdate).resolves.toBeUndefined();
      expect(fake.has(lockPath)).toBe(false);
    } finally {
      vi.useRealTimers();
      firstRead.release();
      await ownerUpdate.catch(() => undefined);
      restore();
    }
  });

  it('does not start an atomic target write when the exclusive updater returns null', async () => {
    const fake = new SharedFakeFs();
    fake.setText('/shared/config.json', '{"names":[]}');
    const restore = installSharedFake(fake);
    try {
      await expect(createFsStorage().updateTextExclusive('/shared/config.json', () => null)).resolves.toBeUndefined();
      expect(fake.text('/shared/config.json')).toBe('{"names":[]}');
      expect(fake.calls.filter((call) => call.operation === 'rename')).toEqual([]);
    } finally {
      restore();
    }
  });

  it('makes a release failure terminal after a successful primary update', async () => {
    const fake = new SharedFakeFs();
    fake.setText('/shared/config.json', '{}');
    const restore = installSharedFake(fake);
    try {
      const unlink = vi.mocked(fsPromises.unlink).mockRejectedValueOnce(createFilesystemError('EACCES', 'release denied'));
      await expect(createFsStorage().updateTextExclusive('/shared/config.json', () => '{"ok":true}')).rejects.toBeInstanceOf(FsIoError);
      expect(unlink).toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('makes a release failure supersede a primary failure with the primary error as cause', async () => {
    const fake = new SharedFakeFs();
    fake.setText('/shared/config.json', '{}');
    const primary = new Error('updater failed');
    const restore = installSharedFake(fake);
    try {
      vi.mocked(fsPromises.unlink).mockRejectedValueOnce(createFilesystemError('EACCES', 'release denied'));
      let thrown: unknown;
      try {
        await createFsStorage().updateTextExclusive('/shared/config.json', () => { throw primary; });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(FsIoError);
      expect(thrown instanceof FsIoError ? thrown.cause : undefined).toBe(primary);
    } finally {
      restore();
    }
  });

  it('preserves a primary failure unchanged when release succeeds', async () => {
    const fake = new SharedFakeFs();
    fake.setText('/shared/config.json', '{}');
    const primary = new Error('updater failed');
    const restore = installSharedFake(fake);
    try {
      await expect(createFsStorage().updateTextExclusive('/shared/config.json', () => { throw primary; })).rejects.toBe(primary);
    } finally {
      restore();
    }
  });
});
