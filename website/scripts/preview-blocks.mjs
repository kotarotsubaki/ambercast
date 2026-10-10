/**
 * Manage the temporary blocks page used by the local preview server.
 */
import { spawn } from 'node:child_process';
import { access, open, readFile, unlink } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Normalize Astro CLI output into plain multi-line text.
 *
 * @param {string} output - Captured stdout/stderr text from `runCaptured`.
 * @returns {string} The same content with every JSON-wrapped line replaced
 * by its own `message` field (restoring Astro's embedded `\n` sequences as
 * real newlines), and every other line left unchanged.
 * @remarks Astro's own non-interactive output (confirmed empirically: the
 * same piped-stdio mode this module always uses) is a single real line of
 * `{"message":"...","label":"SKIP_FORMAT","level":"info"}` JSON, whose
 * `message` carries Astro's multi-line report as escaped `\n` characters --
 * two literal bytes, not a real newline, until something decodes the line.
 * Both parsers below need Astro's real multi-line structure to anchor
 * per-line regexes against; this is the one place that structure gets
 * restored, so a line that happens to be plain text (an interactively
 * attached terminal's own human-formatted shape) passes through unchanged
 * rather than being misread as malformed JSON.
 */
function unwrapAstroOutput(output) {
  return output
    .split('\n')
    .map((line) => {
      if (!line.trim()) return line;
      try {
        const parsed = JSON.parse(line);
        if (typeof parsed?.message === 'string') return parsed.message;
      } catch {
        // Not a JSON line (the human-formatted, TTY-attached shape) -- keep it as is.
      }
      return line;
    })
    .join('\n');
}

/**
 * Spawn an Astro CLI subcommand and resolve once its output is complete.
 *
 * @param {Function} spawnFn - Process spawner (overridable for tests).
 * @param {string} cwd - The website package directory.
 * @param {string} cmd - The executable to run (`npm` or `npx`).
 * @param {string[]} args - Arguments for `cmd`.
 * @returns {Promise<{ code: number | null, signal: NodeJS.Signals | null, output: string }>}
 * Resolves once the child's stdio streams finish closing; rejects on a
 * synchronous spawn throw or an `'error'` event.
 * @remarks Every caller below (the precondition status check, the starter,
 * the post-start status check, the pre-stop status recheck) needs to read
 * what Astro itself reported, not just whether the process exited cleanly,
 * so output is captured rather than inherited. It is also mirrored to the
 * real `process.stdout`/`stderr` as it arrives, so a human running `npm run
 * preview:blocks` interactively still sees Astro's own banners live.
 * Resolution waits for `'close'`, not `'exit'`: Node fires `'exit'` as soon
 * as the process terminates, which can race ahead of the pipe finishing
 * delivery of buffered output, while `'close'` is guaranteed to fire only
 * after the stdio streams themselves have finished -- the same `(code,
 * signal)` pair is available on both events, so switching costs nothing.
 * A synchronous spawn throw and an `'error'` event are both failures with
 * no output to read, so both reject instead of resolving with an empty
 * result -- one failure shape callers can branch on, instead of two.
 */
function runCaptured(spawnFn, cwd, cmd, args) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnFn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      reject(error);
      return;
    }
    let output = '';
    child.stdout?.on('data', (chunk) => {
      output += chunk;
      process.stdout.write(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      output += chunk;
      process.stderr.write(chunk);
    });
    child.once('close', (code, signal) => resolve({ code, signal, output }));
    child.once('error', (error) => reject(error));
  });
}

/**
 * Interpret an `astro dev status` result.
 *
 * @param {{ code: number | null, signal: NodeJS.Signals | null, output: string }} result - A `runCaptured` result for the `astro dev status` subcommand.
 * @returns {{ ok: boolean, running: boolean, pid: number | null }} `ok` is
 * `false` for a nonzero or signalled exit, or for normalized output
 * matching neither recognized shape exactly once; `running`/`pid` only
 * carry meaning when `ok` is `true`.
 * @remarks Astro reports exactly one of two line shapes (confirmed
 * interactively against the installed Astro 7.2.10, after
 * `unwrapAstroOutput` restores its real line structure): a line reading
 * exactly `"No dev server is running."`, or a line starting
 * `"Dev server running at <url> (pid <N>"` with arbitrary trailing fields
 * (e.g. `", uptime 11s, background)"`) before its closing paren. Both
 * regexes anchor to the whole line (`^...$`, multiline), and this function
 * requires exactly one match of exactly one of the two shapes -- a buffer
 * with neither, or with both (a contradiction that should never happen but
 * must never be silently resolved by guessing), is `ok: false`. Every
 * caller below (the startup precondition, the post-start pid confirmation,
 * and the pre-stop pid recheck) depends on this distinction never being
 * guessed.
 */
function parseStatus(result) {
  if (result.code !== 0 || result.signal) return { ok: false, running: false, pid: null };
  const text = unwrapAstroOutput(result.output);
  const noServerLines = text.match(/^No dev server is running\.?$/gm) ?? [];
  const runningLines = text.match(/^Dev server running at \S+ \(pid (\d+)[^)]*\)$/gm) ?? [];
  if (noServerLines.length === 1 && runningLines.length === 0) {
    return { ok: true, running: false, pid: null };
  }
  if (runningLines.length === 1 && noServerLines.length === 0) {
    const match = /\(pid (\d+)/.exec(runningLines[0]);
    return { ok: true, running: true, pid: Number(match[1]) };
  }
  return { ok: false, running: false, pid: null };
}

/**
 * Interpret `npm run dev -- --background`'s own start report.
 *
 * @param {{ code: number | null, signal: NodeJS.Signals | null, output: string }} result - A `runCaptured` result for the starter.
 * @returns {{ freshStart: boolean, pid: number | null }} `freshStart` is
 * `true` only for Astro's own new-server report, matched exactly once with
 * no conflicting "already running" line present; `pid` only carries
 * meaning together with it.
 * @remarks Confirmed interactively against the installed Astro 7.2.10,
 * after `unwrapAstroOutput` restores its real line structure: exiting 0,
 * Astro's first report line reads exactly either
 * `"Dev server running at <url> (pid <N>)"` for a server this invocation
 * actually started, or `"Dev server already running at <url> (pid <N>)"`
 * when one was already up before this invocation ran -- both anchored to
 * the whole line, so neither can be confused with the status command's own
 * differently-shaped running report (which this function never receives).
 * `freshStart` requires exactly one fresh-start line and zero
 * already-running lines; adopting a daemon this invocation did not start
 * would let a later stop command shut down a server someone else is using.
 * A nonzero exit or a signalled exit is never a fresh start, regardless of
 * what its output happens to contain.
 */
function parseStarterOutput(result) {
  if (result.code !== 0 || result.signal) return { freshStart: false, pid: null };
  const text = unwrapAstroOutput(result.output);
  const freshLines = text.match(/^Dev server running at \S+ \(pid (\d+)\)$/gm) ?? [];
  const alreadyLines = text.match(/^Dev server already running at \S+ \(pid (\d+)\)$/gm) ?? [];
  if (freshLines.length === 1 && alreadyLines.length === 0) {
    const match = /\(pid (\d+)\)$/.exec(freshLines[0]);
    return { freshStart: true, pid: Number(match[1]) };
  }
  return { freshStart: false, pid: null };
}

/**
 * Check whether a path exists.
 *
 * @param {string} path - The path to check.
 * @returns {Promise<boolean>} `true` if `access` succeeds, `false` otherwise.
 */
async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Stop Astro's background dev server and wait for that to finish.
 *
 * @param {Function} spawnFn - Process spawner (overridable for tests).
 * @param {string} cwd - The website package directory.
 * @returns {Promise<boolean>} `true` only for a clean, signal-less, code-0
 * exit of `astro dev stop`; `false` for a spawn throw, an `'error'` event,
 * a nonzero exit, or a signal-only exit.
 * @remarks `astro dev stop` is the only interface back to the detached
 * daemon started under `npm run dev -- --background`; there is no handle on
 * that process from here. The wait has no timeout, matching this module's
 * existing precedent elsewhere of waiting unboundedly on a child's exit
 * after signaling it -- a stop command that never exits leaves the wrapper
 * and the temporary page in place rather than guessing at an outcome.
 */
async function stopDaemon(spawnFn, cwd) {
  try {
    const result = await runCaptured(spawnFn, cwd, 'npx', ['astro', 'dev', 'stop']);
    return result.code === 0 && !result.signal;
  } catch {
    return false;
  }
}

/**
 * Start a blocks preview and own the background dev server for its lifetime.
 *
 * @param {{ spawnFn?: Function, sourcePath?: string, destPath?: string, unlinkFn?: Function, openFn?: Function }} options - Optional process spawner, source and destination paths, copy remover, and exclusive-file-opener for controlled tests.
 * @returns {Promise<void>} Resolves only via `process.exit`; it never returns normally.
 * @remarks Ownership of the background dev server is established only by
 * Astro's own explicit new-server report plus an immediate status
 * confirmation of the same pid -- never inferred from an exit code alone.
 * The starter is never killed under any circumstance (confirmed
 * interactively: `astro dev --background` always exits promptly once it
 * has confirmed the daemon actually started, so there is no long-running
 * foreground child to wait out or kill); a signal arriving before that is
 * only recorded for later, never acted on immediately.
 *
 * Signal handlers are registered before the page is copied, not after:
 * a signal arriving while the copy is in flight must still be honored
 * once the sequence reaches a point that checks for one, instead of
 * falling through to Node's default handling, which would abort with a
 * half-finished or orphaned copy and nothing cleaned up. The copy itself
 * is an exclusive create followed by a separate write and close, so a
 * failure after a successful create (unlike a failed create, which never
 * touches the filesystem) still triggers cleanup. Once a pid is
 * owned, deletion is attempted regardless of whether a stop was
 * warranted or why an attempted stop did not succeed -- the only clean
 * (0) exit is a successful stop (when one was warranted) followed by a
 * successful deletion. The `handled` idempotency guard keeps a second
 * signal during the stop sequence from falling through to Node's default
 * SIGINT/SIGTERM handling, which would otherwise abort cleanup before the
 * page is removed.
 */
export async function previewBlocks({ spawnFn, sourcePath, destPath, unlinkFn, openFn } = {}) {
  sourcePath ??= fileURLToPath(new URL('../../.agents/skills/docs-writing/references/blocks.mdx', import.meta.url));
  destPath ??= fileURLToPath(new URL('../src/content/docs/preview-blocks.mdx', import.meta.url));
  spawnFn ??= spawn;
  unlinkFn ??= unlink;
  openFn ??= open;
  const cwd = fileURLToPath(new URL('..', import.meta.url));

  if (await pathExists(destPath)) process.exit(1);

  let precheck;
  try {
    precheck = parseStatus(await runCaptured(spawnFn, cwd, 'npx', ['astro', 'dev', 'status']));
  } catch {
    process.exit(1);
  }
  if (!precheck.ok || precheck.running) process.exit(1);

  const deleteCopy = async () => {
    try {
      await unlinkFn(destPath);
      return true;
    } catch {
      return false;
    }
  };

  let handled = false;
  let resolveSignal;
  const signalPromise = new Promise((resolve) => {
    resolveSignal = resolve;
  });
  const onSignal = () => {
    if (handled) return;
    handled = true;
    resolveSignal();
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  let handle;
  try {
    handle = await openFn(destPath, 'wx');
  } catch {
    process.exit(1);
  }
  try {
    await handle.writeFile(await readFile(sourcePath));
    await handle.close();
  } catch {
    await handle.close().catch(() => {});
    await deleteCopy();
    process.exit(1);
  }

  let starterResult;
  try {
    starterResult = await runCaptured(spawnFn, cwd, 'npm', ['run', 'dev', '--', '--background']);
  } catch {
    await deleteCopy();
    process.exit(1);
  }

  const { freshStart, pid } = parseStarterOutput(starterResult);
  if (!freshStart) {
    await deleteCopy();
    process.exit(1);
  }

  let afterStart;
  try {
    afterStart = parseStatus(await runCaptured(spawnFn, cwd, 'npx', ['astro', 'dev', 'status']));
  } catch {
    afterStart = { ok: false, running: false, pid: null };
  }
  if (!afterStart.ok || !afterStart.running || afterStart.pid !== pid) {
    await deleteCopy();
    process.exit(1);
  }

  const ownedPid = pid;
  const keepAlive = setInterval(() => {}, 1000);
  await signalPromise;
  clearInterval(keepAlive);

  let recheck;
  try {
    recheck = parseStatus(await runCaptured(spawnFn, cwd, 'npx', ['astro', 'dev', 'status']));
  } catch {
    recheck = { ok: false, running: false, pid: null };
  }

  let stopped = false;
  if (recheck.ok && recheck.running && recheck.pid === ownedPid) {
    stopped = await stopDaemon(spawnFn, cwd);
  }
  const deleted = await deleteCopy();
  process.exit(stopped && deleted ? 0 : 1);
}

// The CLI owns the preview lifecycle and its cleanup.
// Test-only path overrides isolate CLI checks from the authored preview page.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  previewBlocks({
    sourcePath: process.env.AMBERCAST_PREVIEW_SOURCE_PATH,
    destPath: process.env.AMBERCAST_PREVIEW_DEST_PATH,
  });
}
