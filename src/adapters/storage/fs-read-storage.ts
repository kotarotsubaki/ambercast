import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import type { ReadStorageAdapter } from '#ports/storage.js';

/*
 * This adapter implements its two reads directly with `node:fs/promises`.
 * It must not import `fs-storage.ts`: the read-only closure rule treats that
 * module as write-capable at file granularity, so even a re-export of only
 * these methods would make every caller reach the prohibited factory module.
 * Duplicating the small read bodies is therefore a hard architectural
 * constraint, not a style preference.
 */

/**
 * Creates read-only storage backed by the host filesystem.
 *
 * @returns A fresh adapter that exposes only UTF-8 text reads and regular
 * file existence probes.
 *
 * @remarks
 * The object contains the read-only `ReadStorageAdapter` surface, rather than
 * a cast or projection of a fuller adapter. This keeps write methods absent at
 * runtime as well as unavailable through the type.
 *
 * Optional snapshots use a direct read so `null` remains reserved for a
 * genuinely missing path; an existence probe would hide inspection failures
 * and observe a separate filesystem version (SPEC-C2-12).
 */
export function createFsReadStorage(): ReadStorageAdapter {
  return {
    async readText(path: string): Promise<string> {
      if (!(await stat(path)).isFile()) {
        throw new Error(`${path} is not a regular file`);
      }

      return readFile(path, 'utf8');
    },
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
    async exists(path: string): Promise<boolean> {
      try {
        return (await stat(path)).isFile();
      } catch {
        return false;
      }
    },
    async listDirectories(dir: string): Promise<readonly string[]> {
      try {
        const entries = await readdir(dir || '.', { withFileTypes: true });
        return entries
          .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.ambercast-tmp-'))
          .map((entry) => entry.name)
          .sort();
      } catch (error: unknown) {
        if (isMissingPathError(error)) {
          return [];
        }

        throw error;
      }
    },
    async realPath(path: string): Promise<string | undefined> {
      try {
        return await realpath(path);
      } catch (error: unknown) {
        if (isMissingPathError(error)) {
          return undefined;
        }
        throw error;
      }
    },
  };
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
