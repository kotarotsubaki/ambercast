import { readFile, stat } from 'node:fs/promises';
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
 */
export function createFsReadStorage(): ReadStorageAdapter {
  return {
    async readText(path: string): Promise<string> {
      if (!(await stat(path)).isFile()) {
        throw new Error(`${path} is not a regular file`);
      }

      return readFile(path, 'utf8');
    },
    async readTextSnapshotIfExists(_path: string): Promise<{ readonly text: string; readonly bytes: Uint8Array } | null> {
      /*
       * The eventual implementation performs one binary read and derives text
       * from that detached buffer. It handles only a missing path as an
       * optional snapshot: using `exists()` first would convert permissions,
       * directories, and other inspection failures into an indistinguishable
       * absence, which would make force-generation unsafe (SPEC-C2-12).
       */
      throw new Error('not implemented');
    },
    async exists(path: string): Promise<boolean> {
      try {
        return (await stat(path)).isFile();
      } catch {
        return false;
      }
    },
  };
}
