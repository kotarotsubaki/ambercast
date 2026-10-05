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
 * untouched and no child starts. Astro 7's dev server always detaches into a
 * persistent background daemon (managed by its own `stop`/`status`/`logs`
 * subcommands) once it has confirmed startup, regardless of flags; the
 * `npm run dev` child therefore exits with code 0 almost immediately even
 * though the actual dev server keeps running under a different, untracked
 * PID. Treating that natural code-0 exit as "the user ended the preview"
 * deleted the temporary page and returned control within a fraction of a
 * second of starting, before anyone could view it, while orphaning the
 * detached daemon. A code-0, signal-less child exit is therefore read as
 * "Astro finished daemonizing" and the preview keeps running: cleanup now
 * waits for this process's own SIGINT/SIGTERM, which is the user's actual
 * request to end the preview, and only then asks Astro to stop its daemon
 * before removing the page. If the child is still starting up when that
 * signal arrives, it is killed directly as a best-effort fallback, and the
 * daemon is asked to stop only once that kill's own exit is observed — a
 * daemon spawned concurrently with the kill cannot be waited for from here,
 * but at least the wrapper never races its own two child processes. The
 * stop command's wait has no timeout, matching this file's existing,
 * previously-reviewed precedent of waiting unboundedly on a child's exit
 * after signaling it; a stop command that never exits leaves the wrapper
 * and the temporary page in place rather than guessing at an outcome.
 * `process.on` (not `once`) plus an idempotency guard keep a second Ctrl-C
 * during the stop sequence from falling through to Node's default SIGINT
 * handling, which would otherwise abort cleanup and leave the page
 * undeleted. A stop command that fails (throws, errors, or exits nonzero)
 * does not block cleanup — the page is still removed, since the user asked
 * to end the preview regardless — but is reported as a nonzero exit so the
 * failure is visible rather than silently swallowed. Numeric child exit
 * codes are preserved for a genuine failure exit; a signal-only exit or
 * failed deletion exits nonzero.
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

  const cwd = fileURLToPath(new URL('..', import.meta.url));
  let child;
  try {
    child = spawnFn('npm', ['run', 'dev'], { cwd, stdio: 'inherit' });
  } catch (error) {
    try {
      await unlinkFn(destPath);
    } catch {
      process.exit(1);
    }
    process.exit(1);
  }

  const keepAlive = setInterval(() => {}, 1000);

  let childSettled = false;
  const childOutcome = new Promise((resolve) => {
    child.once('exit', (code, signal) => {
      childSettled = true;
      resolve({ kind: 'exit', code, signal });
    });
    child.once('error', (error) => {
      childSettled = true;
      resolve({ kind: 'error', error });
    });
  });

  let signalHandled = false;
  const wrapperSignal = new Promise((resolve) => {
    const onSignal = (signal) => {
      if (signalHandled) return;
      signalHandled = true;
      if (!childSettled) child.kill(signal);
      resolve(signal);
    };
    process.on('SIGINT', () => onSignal('SIGINT'));
    process.on('SIGTERM', () => onSignal('SIGTERM'));
  });

  const first = await Promise.race([childOutcome, wrapperSignal]);

  let exitCode;
  if (typeof first === 'string') {
    if (!childSettled) await childOutcome;
    exitCode = (await stopDaemon(spawnFn, cwd)) ? 0 : 1;
  } else if (first.kind === 'error') {
    exitCode = first.error.code ?? 1;
  } else if (first.code === 0 && !first.signal) {
    await wrapperSignal;
    exitCode = (await stopDaemon(spawnFn, cwd)) ? 0 : 1;
  } else {
    exitCode = first.code === null && first.signal ? 1 : first.code;
  }

  clearInterval(keepAlive);
  try {
    await unlinkFn(destPath);
  } catch {
    process.exit(1);
  }
  process.exit(exitCode ?? 0);
}

/**
 * Ask Astro's background dev server to stop and wait for that to finish.
 *
 * @param {Function} spawnFn - Process spawner (overridable for tests).
 * @param {string} cwd - The website package directory.
 * @returns {Promise<boolean>} Resolves `true` only if the stop command ran
 * and exited with code 0 and no signal; `false` for a synchronous spawn
 * failure, an `'error'` event, a nonzero exit, or a signal-only exit.
 * @remarks `astro dev stop` is the only interface back to the detached
 * daemon started under `npm run dev`; there is no handle on that process
 * from here. It exits 0 even when no daemon is running (confirmed against
 * the installed Astro version), so a 0 exit here is read as "the daemon is
 * not left running," not merely "something was running and got stopped."
 */
async function stopDaemon(spawnFn, cwd) {
  let stopChild;
  try {
    stopChild = spawnFn('npx', ['astro', 'dev', 'stop'], { cwd, stdio: 'inherit' });
  } catch {
    return false;
  }
  return new Promise((resolve) => {
    stopChild.once('exit', (code, signal) => resolve(code === 0 && !signal));
    stopChild.once('error', () => resolve(false));
  });
}

// The CLI owns the preview lifecycle and its cleanup.
// Test-only path overrides isolate CLI checks from the authored preview page.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  previewBlocks({
    sourcePath: process.env.AMBERCAST_PREVIEW_SOURCE_PATH,
    destPath: process.env.AMBERCAST_PREVIEW_DEST_PATH,
  });
}
