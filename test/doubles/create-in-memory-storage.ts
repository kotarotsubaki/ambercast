import type { StorageAdapter } from '../../src/ports/storage.js';

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder();

/**
 * Finds the lexical parent without interpreting a path's segments.
 *
 * The storage port leaves normalization to its caller, so this helper uses
 * only the final separator needed to model direct-child directory behavior.
 */
function parentPath(path: string): string {
  const separator = path.lastIndexOf('/');
  return separator < 0 ? '' : path.slice(0, separator);
}

function fileName(path: string): string {
  const separator = path.lastIndexOf('/');
  return separator < 0 ? path : path.slice(separator + 1);
}

/**
 * Materializes all parents of a path while rejecting a file used as a parent.
 *
 * This preserves the real-filesystem distinction between a regular file and
 * a directory without assigning any broader normalization semantics to paths.
 */
function ensureParentDirectories(
  path: string,
  directories: Set<string>,
  files: ReadonlyMap<string, Uint8Array>,
): void {
  const parents: string[] = [];
  let parent = parentPath(path);

  while (parent !== '') {
    parents.push(parent);
    parent = parentPath(parent);
  }

  for (const directory of parents.reverse()) {
    if (files.has(directory)) {
      throw new Error(`Cannot create directory at file path: ${directory}`);
    }

    directories.add(directory);
  }
}

function ensureDirectory(
  directory: string,
  directories: Set<string>,
  files: ReadonlyMap<string, Uint8Array>,
): void {
  if (files.has(directory)) {
    throw new Error(`Cannot create directory at file path: ${directory}`);
  }

  ensureParentDirectories(directory, directories, files);
  directories.add(directory);
}

/**
 * Creates an isolated storage fake that models the port's observable file
 * semantics without touching the host filesystem.
 *
 * Files are stored as bytes so UTF-8 text and binary reads observe the same
 * content. Directory membership is separate from file membership, which keeps
 * the file-only `exists` rule and non-recursive sorted listings explicit.
 * Writes need no temporary-file mechanism: a single `Map.set` call is a
 * synchronous, all-or-nothing state transition in JavaScript's single-threaded
 * execution model, so there is no partial-write window for an interruption to
 * land in. This fake conforms to the atomic-write contract by construction
 * rather than replicating the filesystem adapter's mechanism.
 *
 * @returns A scenario-local storage adapter.
 */
export function createInMemoryStorage(): StorageAdapter {
  const files = new Map<string, Uint8Array>();
  const directories = new Set<string>(['']);
  const exclusiveUpdates = new Map<string, Promise<void>>();

  return {
    async readText(path: string): Promise<string> {
      const content = files.get(path);
      if (content === undefined) {
        throw new Error(`Cannot read non-file path: ${path}`);
      }

      return utf8Decoder.decode(content);
    },
    async readTextSnapshot(path: string): Promise<{ readonly text: string; readonly bytes: Uint8Array }> {
      const content = files.get(path);
      if (content === undefined) {
        throw new Error(`Cannot read non-file path: ${path}`);
      }

      return { text: utf8Decoder.decode(content), bytes: new Uint8Array(content) };
    },
    async readTextSnapshotIfExists(path: string): Promise<{ readonly text: string; readonly bytes: Uint8Array } | null> {
      const content = files.get(path);
      if (content === undefined) {
        if (directories.has(path)) {
          throw new Error(`Cannot read directory path: ${path}`);
        }

        return null;
      }

      return { text: utf8Decoder.decode(content), bytes: new Uint8Array(content) };
    },
    async updateTextExclusive(
      path: string,
      updater: (current: string | null) => string | null | Promise<string | null>,
      signal?: AbortSignal,
    ): Promise<void> {
      const previous = exclusiveUpdates.get(path) ?? Promise.resolve();
      const current = previous.catch(() => undefined).then(async () => {
        signal?.throwIfAborted();
        const stored = files.get(path);
        if (stored === undefined && directories.has(path)) {
          throw new Error(`Cannot update directory path: ${path}`);
        }

        const replacement = await updater(stored === undefined ? null : utf8Decoder.decode(stored));
        if (replacement === null) {
          return;
        }

        signal?.throwIfAborted();
        ensureParentDirectories(path, directories, files);
        files.set(path, utf8Encoder.encode(replacement));
      });

      exclusiveUpdates.set(path, current);
      try {
        await current;
      } finally {
        if (exclusiveUpdates.get(path) === current) {
          exclusiveUpdates.delete(path);
        }
      }
    },
    async writeText(path: string, content: string): Promise<void> {
      ensureParentDirectories(path, directories, files);
      if (directories.has(path)) {
        throw new Error(`Cannot write a directory path: ${path}`);
      }

      files.set(path, utf8Encoder.encode(content));
    },
    async readBinary(path: string): Promise<Uint8Array> {
      const content = files.get(path);
      if (content === undefined) {
        throw new Error(`Cannot read non-file path: ${path}`);
      }

      // Callers must not be able to mutate this fake's stored bytes through a read result.
      return new Uint8Array(content);
    },
    async writeBinary(path: string, content: Uint8Array): Promise<void> {
      ensureParentDirectories(path, directories, files);
      if (directories.has(path)) {
        throw new Error(`Cannot write a directory path: ${path}`);
      }

      // The fake takes ownership of its stored bytes so later caller mutations cannot rewrite a file.
      files.set(path, new Uint8Array(content));
    },
    async exists(path: string): Promise<boolean> {
      return files.has(path);
    },
    async listFiles(dir: string): Promise<readonly string[]> {
      return [...files.keys()]
        .filter((path) => parentPath(path) === dir)
        .map(fileName)
        .sort();
    },
    async ensureDir(dir: string): Promise<void> {
      ensureDirectory(dir, directories, files);
    },
  };
}
