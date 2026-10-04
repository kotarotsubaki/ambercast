/**
 * Manage the temporary blocks page used by the local preview server.
 */
import { spawn } from 'node:child_process';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Start a blocks preview and manage its temporary page for the child lifetime.
 *
 * @param {{ spawnFn?: Function, sourcePath?: string, destPath?: string, unlinkFn?: Function }} options - Optional process spawner, source and destination paths, and copy remover for controlled tests.
 * @returns {Promise<void>} Resolves after the preview lifecycle completes.
 * @remarks The authored `.agents/skills/docs-writing/references/blocks.mdx`
 * is copied to the gitignored `website/src/content/docs/preview-blocks.mdx`
 * page for this preview alone. Exclusive creation writes that copy in one
 * filesystem operation. If it fails with `EEXIST`, the existing page remains
 * untouched and no child starts. On success, an `npm run dev` child starts;
 * SIGINT and SIGTERM are forwarded to it. Cleanup observes the child's exit,
 * whether signaled or natural, before deleting the copy. Numeric child exit
 * codes are preserved; a signal-only exit or failed deletion exits nonzero.
 */
export async function previewBlocks({ spawnFn, sourcePath, destPath, unlinkFn } = {}) {
  sourcePath ??= fileURLToPath(new URL('../../.agents/skills/docs-writing/references/blocks.mdx', import.meta.url));
  destPath ??= fileURLToPath(new URL('../src/content/docs/preview-blocks.mdx', import.meta.url));
  spawnFn ??= spawn;
  unlinkFn ??= unlink;

  try {
    await writeFile(destPath, await readFile(sourcePath), { flag: 'wx' });
  } catch (error) {
    if (error.code === 'EEXIST') process.exit(1);
    throw error;
  }

  let child;
  let keepAlive;
  try {
    child = spawnFn('npm', ['run', 'dev'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      stdio: 'inherit',
    });
  } catch (error) {
    clearInterval(keepAlive);
    try {
      await unlinkFn(destPath);
    } catch {
      process.exit(1);
    }
    process.exit(1);
  }
  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
  keepAlive = setInterval(() => {}, 1000);
  const code = await new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve(code === null && signal ? 1 : code));
    child.once('error', (error) => {
      resolve(error.code ?? 1);
    });
  });
  clearInterval(keepAlive);
  try {
    await unlinkFn(destPath);
  } catch {
    process.exit(1);
  }
  process.exit(code ?? 0);
}

// The CLI owns the preview lifecycle and its cleanup.
// Test-only path overrides isolate CLI checks from the authored preview page.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  previewBlocks({
    sourcePath: process.env.AMBERCAST_PREVIEW_SOURCE_PATH,
    destPath: process.env.AMBERCAST_PREVIEW_DEST_PATH,
  });
}
