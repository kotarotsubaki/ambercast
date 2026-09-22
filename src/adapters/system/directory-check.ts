/**
 * Supplies the filesystem existence-and-directory predicate used by init.
 *
 * This remains a system adapter rather than a `StorageAdapter` operation:
 * `listFiles` treats a missing directory as an empty list and therefore
 * cannot enforce the `--dir` precondition. The adapter uses `stat` directly
 * for that distinct filesystem question.
 */
/**
 * Creates an absolute-path directory predicate.
 *
 * @returns A predicate that accepts an absolute path and resolves `false` for
 * missing paths and paths whose traversal ends at a non-directory.
 * @remarks
 * `stat` follows symbolic links, so a link whose target is a directory resolves
 * `true`. `ENOENT` and `ENOTDIR` are ordinary negative answers; every other
 * failure is rethrown so runtime can preserve an I/O failure instead of
 * misreporting it as an invalid command argument.
 */
export function createDirectoryCheck(): (absolutePath: string) => Promise<boolean> {
  return async (absolutePath): Promise<boolean> => {
    try {
      return (await stat(absolutePath)).isDirectory();
    } catch (error) {
      if (
        error instanceof Error
        && 'code' in error
        && (error.code === 'ENOENT' || error.code === 'ENOTDIR')
      ) {
        return false;
      }
      throw error;
    }
  };
}
import { stat } from 'node:fs/promises';
