/*
 * Adapts ambercast's storage port to the host filesystem at the real I/O
 * boundary.
 *
 * This adapter owns Node-specific paths and filesystem behavior so core and
 * use cases stay deterministic and can receive storage fakes. Unlike
 * core, adapters have no dependency-cruiser external-module allowlist, so this
 * boundary may import `node:fs/promises` and `node:path` when it implements
 * the port.
 */

import { randomBytes } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { FsIoError } from '#core/errors/fs-io-error.js';
import type { StorageAdapter } from '#ports/storage.js';

const maximumTemporaryWriteAttempts = 5;
const maximumLockRetries = 5;
const lockRetryIntervalMs = 100;

async function ensureParentDirectory(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}

/**
 * Replaces a filesystem path with atomic visibility after its payload has
 * been written to a temporary sibling.
 *
 * @param path - Target path whose readers observe either its complete
 * previous content or its complete replacement content.
 * @param write - Writes one caller-specific payload to the supplied temporary
 * path.
 * @returns Resolves after the complete temporary file has replaced `path`.
 * @throws Rethrows the original error reported by the temporary write or
 * replacement.
 *
 * @remarks
 * Callers prepare the target's parent with `ensureParentDirectory` before
 * invoking this helper. A fixed-length, target-basename-independent temporary
 * name avoids exceeding a filesystem component-length limit. Keeping the
 * temporary file in the target directory preserves the same-volume assumption
 * that makes replacement by `rename` atomic.
 *
 * Exclusive creation and fresh-name retries turn concurrent temporary-name
 * collisions into an explicit error rather than overwriting another writer's
 * artifact. Replacement does not use an unlink-then-create gap that could
 * expose partial content.
 *
 * Best-effort cleanup never conceals the original write or replacement error.
 * This protects only operation-reported failures: abrupt process termination
 * can leave an artifact behind. Replacement deliberately has rename semantics,
 * so it does not preserve the overwritten path's inode, permissions,
 * ownership, ACLs, or symlink-following behavior; `StorageAdapter` does not
 * guarantee those properties.
 */
async function writeAtomic(
  path: string,
  write: (tempPath: string) => Promise<void>,
): Promise<void> {
  let lastCollisionError: unknown;

  for (let attempt = 0; attempt < maximumTemporaryWriteAttempts; attempt += 1) {
    const temporaryPath = join(dirname(path), `.ambercast-tmp-${randomBytes(16).toString('hex')}`);

    try {
      await write(temporaryPath);
    } catch (error) {
      if (isTemporaryNameCollision(error)) {
        lastCollisionError = error;
        continue;
      }

      await removeTemporaryFile(temporaryPath);
      throw error;
    }

    try {
      await rename(temporaryPath, path);
      return;
    } catch (error) {
      await removeTemporaryFile(temporaryPath);
      throw error;
    }
  }

  throw lastCollisionError;
}

function isTemporaryNameCollision(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST';
}

async function removeTemporaryFile(path: string): Promise<void> {
  try {
    await rm(path, { force: true });
  } catch {
    // The write or rename error remains the useful failure for callers.
  }
}

function isFilesystemError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new FsIoError('The exclusive storage update was cancelled.', undefined, { cause: signal.reason });
  }
}

async function waitForLockRetry(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, lockRetryIntervalMs));
}

async function rejectSymbolicLink(path: string): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink()) {
      throw new FsIoError('Refusing to update text through a symbolic link.', { path });
    }
  } catch (error) {
    if (isFilesystemError(error, 'ENOENT')) {
      return;
    }
    if (error instanceof FsIoError) {
      throw error;
    }
    throw new FsIoError('The exclusive-update target could not be inspected.', { path }, { cause: error });
  }
}

/*
 * Lock files are ownership records rather than leases. Bounded waiting avoids
 * an indefinite block, while refusing to stale-steal prevents one process from
 * entering another process's critical section.
 */
async function acquireLock(path: string, token: string, signal: AbortSignal | undefined): Promise<void> {
  let lastCollision: unknown;

  for (let attempt = 0; attempt <= maximumLockRetries; attempt += 1) {
    throwIfAborted(signal);
    try {
      await writeFile(path, token, { encoding: 'utf8', flag: 'wx' });
      return;
    } catch (error) {
      if (!isFilesystemError(error, 'EEXIST')) {
        throw new FsIoError('The exclusive-update lock could not be acquired.', { path }, { cause: error });
      }
      lastCollision = error;
      if (attempt < maximumLockRetries) {
        await waitForLockRetry();
      }
    }
  }

  throw new FsIoError(
    `The exclusive-update lock remained held after the bounded retry period; if ambercast isn't running, delete \`${path}\` and rerun.`,
    { path },
    { cause: lastCollision },
  );
}

/*
 * Re-reading the token prevents cleanup from deleting a lock that changed
 * ownership. A release failure is terminal even after an earlier failure,
 * because returning while lock ownership is uncertain would hide the more
 * consequential persistence state.
 */
async function releaseLock(
  path: string,
  token: string,
  primaryFailure: { readonly occurred: boolean; readonly error: unknown },
): Promise<void> {
  try {
    const currentToken = await readFile(path, 'utf8');
    if (currentToken !== token) {
      throw new Error('The exclusive-update lock is no longer owned by this operation.');
    }
    await unlink(path);
  } catch (error) {
    throw new FsIoError(
      'The exclusive-update lock could not be released safely.',
      { path },
      { cause: primaryFailure.occurred ? primaryFailure.error : error },
    );
  }
}

/**
 * Creates storage backed by the host filesystem.
 *
 * @returns A storage adapter that implements the `StorageAdapter` file
 * contract against Node's filesystem.
 *
 * @remarks
 * Text operations use UTF-8, while binary operations pass bytes
 * through without text encoding. Both write forms prepare missing parent
 * directories before writing, preserving the port's convenience contract
 * without forcing callers to sequence directory creation themselves. Their
 * shared atomic-write helper stages a complete payload before making it
 * visible at the target path.
 *
 * The existence probe returns `false` for every inspection
 * failure, including missing paths, directories, and operating-system errors,
 * so callers can use it safely during discovery. Direct-file listings are
 * non-recursive, contain only lexicographically sorted bare regular-file
 * names, and yield `[]` for empty or missing directories. Directory creation
 * is idempotent, including the port's empty-string root directory.
 */
export function createFsStorage(): StorageAdapter {
  return {
    async readText(path: string): Promise<string> {
      return readFile(path, 'utf8');
    },
    /**
     * @remarks
     * In this `FsStorage` implementation, default `TextDecoder` behavior
     * (`ignoreBOM: false`) strips a leading BOM from `.text`, unlike the
     * commit-time `current` supplied by `updateTextExclusive`. `planInit` uses
     * `decodePreservingBom` on `.bytes` to align its classifications; other
     * snapshot callers, including generate and heal, retain this behavior.
     */
    async readTextSnapshot(path: string): Promise<{ readonly text: string; readonly bytes: Uint8Array }> {
      const bytes = new Uint8Array(await readFile(path));
      return { text: new TextDecoder().decode(bytes), bytes: new Uint8Array(bytes) };
    },
    /**
     * @remarks
     * This `FsStorage` snapshot also uses default `TextDecoder` behavior
     * (`ignoreBOM: false`), so `.text` omits a leading BOM even though
     * `updateTextExclusive` preserves it in commit-time `current`. `planInit`
     * decodes `.bytes` with `decodePreservingBom` for its pre-write decision;
     * generate and heal continue using the existing snapshot behavior.
     */
    async readTextSnapshotIfExists(path: string): Promise<{ readonly text: string; readonly bytes: Uint8Array } | null> {
      try {
        const bytes = new Uint8Array(await readFile(path));
        return { text: new TextDecoder().decode(bytes), bytes: new Uint8Array(bytes) };
      } catch (error) {
        if (isMissingPathError(error)) {
          return null;
        }
        throw error;
      }
    },
    /**
     * @remarks
     * In this `FsStorage` implementation, the updater's `current` comes from
     * `readFile(path, 'utf8')`, which preserves a leading BOM as a literal
     * character; snapshot `.text` instead strips it through default
     * `TextDecoder` behavior (`ignoreBOM: false`). `planInit` uses
     * `decodePreservingBom` on snapshot `.bytes` so pre-write and commit-time
     * classifications agree, without changing generate or heal callers.
     */
    async updateTextExclusive(
      path: string,
      updater: (current: string | null) => string | null | Promise<string | null>,
      signal?: AbortSignal,
    ): Promise<void> {
      /*
       * Consent must merge against the configuration observed while holding a
       * cross-process boundary, otherwise two accepted batches can lose names.
       * A null result is an intentional no-op, not an empty-file write
       * (SPEC-C2-9, SPEC-C2-10).
      */
      await rejectSymbolicLink(path);
      await ensureParentDirectory(path);
      const lockPath = `${path}.lock`;
      const token = `${process.pid}-${randomBytes(8).toString('hex')}`;
      await acquireLock(lockPath, token, signal);

      let primaryFailure: { occurred: boolean; error: unknown } = { occurred: false, error: undefined };
      try {
        let current: string | null;
        try {
          current = await readFile(path, 'utf8');
        } catch (error) {
          if (!isMissingPathError(error)) {
            throw error;
          }
          current = null;
        }

        const replacement = await updater(current);
        if (replacement !== null) {
          throwIfAborted(signal);
          await writeAtomic(path, async (temporaryPath) => {
            await writeFile(temporaryPath, replacement, { encoding: 'utf8', flag: 'wx' });
          });
        }
      } catch (error) {
        primaryFailure = { occurred: true, error };
      } finally {
        await releaseLock(lockPath, token, primaryFailure);
      }

      if (primaryFailure.occurred) {
        throw primaryFailure.error;
      }
    },
    async writeText(path: string, content: string): Promise<void> {
      await ensureParentDirectory(path);
      await writeAtomic(path, async (temporaryPath) => {
        await writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx' });
      });
    },
    async readBinary(path: string): Promise<Uint8Array> {
      return new Uint8Array(await readFile(path));
    },
    async writeBinary(path: string, content: Uint8Array): Promise<void> {
      await ensureParentDirectory(path);
      await writeAtomic(path, async (temporaryPath) => {
        await writeFile(temporaryPath, content, { flag: 'wx' });
      });
    },
    async exists(path: string): Promise<boolean> {
      try {
        return (await stat(path)).isFile();
      } catch {
        return false;
      }
    },
    async listFiles(dir: string): Promise<readonly string[]> {
      try {
        const entries = await readdir(dir || '.', { withFileTypes: true });
        return entries
          .filter((entry) => entry.isFile())
          .map((entry) => entry.name)
          .sort();
      } catch (error: unknown) {
        if (isMissingPathError(error)) {
          return [];
        }

        throw error;
      }
    },
    async ensureDir(dir: string): Promise<void> {
      if (dir !== '') {
        await mkdir(dir, { recursive: true });
      }
    },
  };
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
