import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const scriptUrl = new URL('../scripts/preview-blocks.mjs', import.meta.url).href;
const fixtures: string[] = [];

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function waitFor(predicate: () => boolean, timeoutMs = 2000, intervalMs = 10): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

// Astro's own non-interactive output shape (confirmed empirically against the installed
// Astro 7.2.10 by spawning it with piped stdio -- the same mode preview-blocks.mjs always
// uses): one real line of SKIP_FORMAT JSON whose `message` field carries Astro's multi-line
// report as escaped `\n`. These builders produce that exact wire format so the fake spawnFn
// below exercises the real unwrapAstroOutput/parseStatus/parseStarterOutput parsing path,
// not a shortcut plain-text shape production code would never actually receive.
function astroLine(message: string): string {
  return JSON.stringify({ message, label: 'SKIP_FORMAT', level: 'info' }) + '\n';
}
const NO_SERVER = astroLine('No dev server is running.');
const freshStart = (pid: number) =>
  astroLine(`Dev server running at http://localhost:4321 (pid ${pid})\n  Stop:   astro dev stop\n  Status: astro dev status\n  Logs:   astro dev logs`);
const alreadyRunning = (pid: number) =>
  astroLine(`Dev server already running at http://localhost:4321 (pid ${pid})\n  Stop:   astro dev stop\n  Status: astro dev status\n  Logs:   astro dev logs`);
const statusRunning = (pid: number) => astroLine(`Dev server running at http://localhost:4321 (pid ${pid}, uptime 3s, background)`);
const stoppedLine = (pid: number) => astroLine(`Stopped dev server (pid ${pid}).`);
const UNREADABLE = astroLine('Something Astro never actually prints.');
const CONFLICTING_STATUS = NO_SERVER + freshStart(1);
const CONFLICTING_STARTER = freshStart(1) + alreadyRunning(2);

type Step = {
  output?: string;
  outputChunks?: string[];
  exitCode?: number | null;
  exitSignal?: NodeJS.Signals | null;
  error?: string;
  throws?: string;
  closeDelayMs?: number;
  emitExitFirst?: boolean;
  recordDestExistsOnCall?: boolean;
};
type Signal = { afterCallIndex: number; delayMs: number; signal: 'SIGINT' | 'SIGTERM' };
type Script = { steps: Step[]; signals?: Signal[] };

// Each call position is fixed by the production design: 0 = the precondition's `astro dev
// status`, 1 = the starter (`npm run dev -- --background`), 2 = the post-start `astro dev
// status` pid confirmation, 3 = the pre-stop `astro dev status` recheck, 4 = `astro dev
// stop`. A scenario supplies only as many `steps` entries as it expects calls to reach; any
// call beyond that is a production bug this scenario did not anticipate, and is left to hang
// (a harmless, never-settling EventEmitter) rather than guessed at, so an incorrect extra
// call surfaces as a clear markers-array mismatch or spawnSync timeout, never a false pass.
function runPreview(script: Script, options: { existingDest?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ambercast-preview-blocks-'));
  fixtures.push(root);
  const sourcePath = join(root, 'blocks.mdx');
  const destPath = join(root, 'preview-blocks.mdx');
  const markersPath = join(root, 'markers.txt');
  writeFileSync(sourcePath, 'source content');
  if (options.existingDest) writeFileSync(destPath, 'pre-existing content');

  const runner = join(root, 'runner.mjs');
  writeFileSync(
    runner,
    `
import { appendFileSync, existsSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { previewBlocks } from ${JSON.stringify(scriptUrl)};
const [scriptJson, sourcePath, destPath, markersPath] = process.argv.slice(2);
const { steps, signals } = JSON.parse(scriptJson);
const mark = (name) => appendFileSync(markersPath, name + '\\n');
process.on('exit', (code) => mark('process-exit:' + code));
let callIndex = 0;
const spawnFn = (cmd, args) => {
  const i = callIndex++;
  mark('spawn:' + cmd + ' ' + args.join(' '));
  if (steps[i]?.recordDestExistsOnCall) mark('dest-exists-at-call:' + existsSync(destPath));
  for (const sig of (signals ?? []).filter((s) => s.afterCallIndex === i)) {
    setTimeout(() => { mark('signal:' + sig.signal); process.kill(process.pid, sig.signal); }, sig.delayMs);
  }
  const step = steps[i];
  if (!step) { mark('unexpected-call'); return new EventEmitter(); }
  if (step.throws) throw new Error(step.throws);
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = (signal) => { mark('child-kill:' + signal); };
  // emitExitFirst proves runCaptured resolves on 'close', not 'exit': an early, dataless
  // 'exit' (which production code never listens for) is emitted first, then -- only after
  // the real delay below -- the actual output and 'close' arrive. If runCaptured incorrectly
  // resolved on 'exit', it would read empty output at this earlier moment instead.
  if (step.emitExitFirst) { mark('exit-fired-first'); child.emit('exit', step.exitCode === undefined ? null : step.exitCode, step.exitSignal === undefined ? null : step.exitSignal); }
  setTimeout(() => {
    if (step.error) { mark('error'); child.emit('error', new Error(step.error)); return; }
    const chunks = step.outputChunks ?? (step.output ? [step.output] : []);
    for (const chunk of chunks) child.stdout.emit('data', Buffer.from(chunk));
    mark('close');
    child.emit('close', step.exitCode === undefined ? null : step.exitCode, step.exitSignal === undefined ? null : step.exitSignal);
  }, step.closeDelayMs ?? 1);
  return child;
};
const unlinkFn = async (path) => {
  mark('unlink');
  if (globalThis.__unlinkFails) throw new Error('injected unlink failure');
  const { unlink } = await import('node:fs/promises');
  await unlink(path);
};
globalThis.__unlinkFails = ${JSON.stringify(Boolean((script as any).unlinkFails))};
try { await previewBlocks({ spawnFn, sourcePath, destPath, unlinkFn }); }
catch (error) { mark('error:' + error.message); process.exitCode = 1; }
`,
  );
  const result = spawnSync(process.execPath, [runner, JSON.stringify(script), sourcePath, destPath, markersPath], {
    encoding: 'utf8',
    timeout: 5000,
  });
  if (result.error) throw result.error;
  const markers = existsSync(markersPath) ? readFileSync(markersPath, 'utf8').trim().split('\n') : [];
  return { result, markers, sourcePath, destPath };
}

describe('previewBlocks precondition', () => {
  it('exits 1 without spawning or changing an existing destination', () => {
    const { result, markers, destPath } = runPreview({ steps: [] }, { existingDest: true });
    expect(result.status).toBe(1);
    expect(markers).toEqual(['process-exit:1']);
    expect(readFileSync(destPath, 'utf8')).toBe('pre-existing content');
  });

  it('exits 1 with no copy when a server is already running', () => {
    const { result, markers, destPath } = runPreview({ steps: [{ output: statusRunning(99), exitCode: 0 }] });
    expect(result.status).toBe(1);
    expect(markers).toEqual(['spawn:npx astro dev status', 'close', 'process-exit:1']);
    expect(existsSync(destPath)).toBe(false);
  });

  it('exits 1 with no copy when the status check exits nonzero', () => {
    const { result, destPath } = runPreview({ steps: [{ exitCode: 1 }] });
    expect(result.status).toBe(1);
    expect(existsSync(destPath)).toBe(false);
  });

  it('exits 1 with no copy when the status spawn throws synchronously', () => {
    const { result, destPath } = runPreview({ steps: [{ throws: 'boom' }] });
    expect(result.status).toBe(1);
    expect(existsSync(destPath)).toBe(false);
  });

  it('exits 1 with no copy when the status spawn emits an error event', () => {
    const { result, destPath } = runPreview({ steps: [{ error: 'boom' }] });
    expect(result.status).toBe(1);
    expect(existsSync(destPath)).toBe(false);
  });

  it('exits 1 with no copy when the status output matches neither recognized shape', () => {
    const { result, destPath } = runPreview({ steps: [{ output: UNREADABLE, exitCode: 0 }] });
    expect(result.status).toBe(1);
    expect(existsSync(destPath)).toBe(false);
  });

  it('exits 1 with no copy when the status output contains both a no-server and a running line at once', () => {
    const { result, markers, destPath } = runPreview({ steps: [{ output: CONFLICTING_STATUS, exitCode: 0 }] });
    expect(result.status).toBe(1);
    expect(markers.filter((m) => m.startsWith('spawn:'))).toEqual(['spawn:npx astro dev status']);
    expect(existsSync(destPath)).toBe(false);
  });

  it('proceeds past the precondition only once stdio fully closes, even when exit fires first with no data yet', () => {
    const { result, markers } = runPreview({
      steps: [
        { output: NO_SERVER, exitCode: 0, emitExitFirst: true, closeDelayMs: 25 },
        { output: freshStart(1), exitCode: 0 },
        { output: statusRunning(1), exitCode: 0 },
        { output: statusRunning(1), exitCode: 0 },
        { output: stoppedLine(1), exitCode: 0 },
      ],
      signals: [{ afterCallIndex: 2, delayMs: 15, signal: 'SIGINT' }],
    });
    expect(markers).toContain('exit-fired-first');
    expect(result.status).toBe(0);
    expect(markers.filter((m) => m.startsWith('spawn:'))).toEqual([
      'spawn:npx astro dev status',
      'spawn:npm run dev -- --background',
      'spawn:npx astro dev status',
      'spawn:npx astro dev status',
      'spawn:npx astro dev stop',
    ]);
  });
});

describe('previewBlocks happy path', () => {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    it(`owns the started server by pid, stops it, and removes the copy on ${signal}`, () => {
      const { result, markers, destPath } = runPreview({
        steps: [
          { output: NO_SERVER, exitCode: 0 },
          { output: freshStart(555), exitCode: 0 },
          { output: statusRunning(555), exitCode: 0 },
          { output: statusRunning(555), exitCode: 0 },
          { output: stoppedLine(555), exitCode: 0 },
        ],
        signals: [{ afterCallIndex: 2, delayMs: 15, signal }],
      });
      expect(result.status).toBe(0);
      expect(result.signal).toBeNull();
      expect(markers).toEqual([
        'spawn:npx astro dev status',
        'close',
        'spawn:npm run dev -- --background',
        'close',
        'spawn:npx astro dev status',
        'close',
        `signal:${signal}`,
        'spawn:npx astro dev status',
        'close',
        'spawn:npx astro dev stop',
        'close',
        'unlink',
        'process-exit:0',
      ]);
      expect(existsSync(destPath)).toBe(false);
    });
  }

  it('copies the page exclusively before starting, leaving the source untouched', () => {
    const { markers, sourcePath, destPath } = runPreview({
      steps: [
        { output: NO_SERVER, exitCode: 0 },
        { output: freshStart(1), exitCode: 0, recordDestExistsOnCall: true },
        { output: statusRunning(1), exitCode: 0 },
        { output: statusRunning(1), exitCode: 0 },
        { output: stoppedLine(1), exitCode: 0 },
      ],
      signals: [{ afterCallIndex: 2, delayMs: 15, signal: 'SIGINT' }],
    });
    expect(markers).toContain('spawn:npm run dev -- --background');
    expect(markers).toContain('dest-exists-at-call:true');
    expect(readFileSync(sourcePath, 'utf8')).toBe('source content');
    expect(existsSync(destPath)).toBe(false);
  });

  it('never kills the starter when a signal arrives before it exits, and still completes the full sequence', () => {
    const { result, markers } = runPreview({
      steps: [
        { output: NO_SERVER, exitCode: 0 },
        { output: freshStart(7), exitCode: 0, closeDelayMs: 30 },
        { output: statusRunning(7), exitCode: 0 },
        { output: statusRunning(7), exitCode: 0 },
        { output: stoppedLine(7), exitCode: 0 },
      ],
      signals: [{ afterCallIndex: 1, delayMs: 5, signal: 'SIGINT' }],
    });
    expect(result.status).toBe(0);
    expect(markers.filter((m) => m.startsWith('child-kill:'))).toEqual([]);
    expect(markers.filter((m) => m.startsWith('spawn:'))).toEqual([
      'spawn:npx astro dev status',
      'spawn:npm run dev -- --background',
      'spawn:npx astro dev status',
      'spawn:npx astro dev status',
      'spawn:npx astro dev stop',
    ]);
  });

  it('ignores a second signal received during the stop sequence', () => {
    const { result, markers } = runPreview({
      steps: [
        { output: NO_SERVER, exitCode: 0 },
        { output: freshStart(42), exitCode: 0 },
        { output: statusRunning(42), exitCode: 0 },
        { output: statusRunning(42), exitCode: 0, closeDelayMs: 20 },
        { output: stoppedLine(42), exitCode: 0 },
      ],
      signals: [
        { afterCallIndex: 2, delayMs: 5, signal: 'SIGINT' },
        { afterCallIndex: 2, delayMs: 8, signal: 'SIGINT' },
      ],
    });
    expect(result.status).toBe(0);
    expect(markers.filter((m) => m.startsWith('spawn:npx astro dev stop')).length).toBe(1);
    expect(markers.filter((m) => m === 'unlink').length).toBe(1);
  });
});

describe('previewBlocks starter failures', () => {
  it('deletes the copy and exits 1 on a nonzero starter exit', () => {
    const { result, markers, destPath } = runPreview({
      steps: [{ output: NO_SERVER, exitCode: 0 }, { exitCode: 7 }],
    });
    expect(result.status).toBe(1);
    expect(markers).toContain('unlink');
    expect(markers.filter((m) => m.startsWith('spawn:'))).toEqual(['spawn:npx astro dev status', 'spawn:npm run dev -- --background']);
    expect(existsSync(destPath)).toBe(false);
  });

  it('deletes the copy and exits 1 when the starter exits by signal', () => {
    const { result, destPath } = runPreview({
      steps: [{ output: NO_SERVER, exitCode: 0 }, { exitCode: null, exitSignal: 'SIGKILL' }],
    });
    expect(result.status).not.toBe(0);
    expect(existsSync(destPath)).toBe(false);
  });

  it('deletes the copy and exits 1 when the starter spawn throws synchronously', () => {
    const { result, markers, destPath } = runPreview({
      steps: [{ output: NO_SERVER, exitCode: 0 }, { throws: 'boom' }],
    });
    expect(result.status).toBe(1);
    expect(markers).toContain('unlink');
    expect(existsSync(destPath)).toBe(false);
  });

  it('deletes the copy and exits 1 when the starter spawn emits an error event', () => {
    const { result, destPath } = runPreview({
      steps: [{ output: NO_SERVER, exitCode: 0 }, { error: 'boom' }],
    });
    expect(result.status).toBe(1);
    expect(existsSync(destPath)).toBe(false);
  });

  it('deletes the copy and exits 1, with no stop attempted, when the starter reports an already-running server', () => {
    const { result, markers, destPath } = runPreview({
      steps: [{ output: NO_SERVER, exitCode: 0 }, { output: alreadyRunning(9), exitCode: 0 }],
    });
    expect(result.status).toBe(1);
    expect(markers.filter((m) => m.startsWith('spawn:'))).toEqual(['spawn:npx astro dev status', 'spawn:npm run dev -- --background']);
    expect(markers).toContain('unlink');
    expect(existsSync(destPath)).toBe(false);
  });

  it('deletes the copy and exits 1, with no stop attempted, when the starter output carries both a fresh-start and an already-running line', () => {
    const { result, markers, destPath } = runPreview({
      steps: [{ output: NO_SERVER, exitCode: 0 }, { output: CONFLICTING_STARTER, exitCode: 0 }],
    });
    expect(result.status).toBe(1);
    expect(markers.filter((m) => m.startsWith('spawn:'))).toEqual(['spawn:npx astro dev status', 'spawn:npm run dev -- --background']);
    expect(markers).toContain('unlink');
    expect(existsSync(destPath)).toBe(false);
  });
});

describe('previewBlocks post-start pid confirmation failures', () => {
  it('deletes the copy and exits 1, with no stop attempted, on a post-start pid mismatch', () => {
    const { result, markers, destPath } = runPreview({
      steps: [{ output: NO_SERVER, exitCode: 0 }, { output: freshStart(1), exitCode: 0 }, { output: statusRunning(2), exitCode: 0 }],
    });
    expect(result.status).toBe(1);
    expect(markers.filter((m) => m.startsWith('spawn:'))).toEqual([
      'spawn:npx astro dev status',
      'spawn:npm run dev -- --background',
      'spawn:npx astro dev status',
    ]);
    expect(markers).toContain('unlink');
    expect(existsSync(destPath)).toBe(false);
  });

  it('deletes the copy and exits 1 when the post-start status is unreadable', () => {
    const { result, destPath } = runPreview({
      steps: [{ output: NO_SERVER, exitCode: 0 }, { output: freshStart(1), exitCode: 0 }, { exitCode: 1 }],
    });
    expect(result.status).toBe(1);
    expect(existsSync(destPath)).toBe(false);
  });

  it('deletes the copy and exits 1 when the post-start status spawn itself throws', () => {
    const { result, markers, destPath } = runPreview({
      steps: [{ output: NO_SERVER, exitCode: 0 }, { output: freshStart(1), exitCode: 0 }, { throws: 'boom' }],
    });
    expect(result.status).toBe(1);
    expect(markers).toContain('unlink');
    expect(existsSync(destPath)).toBe(false);
  });
});

describe('previewBlocks pre-stop recheck and stop failures', () => {
  it('deletes the copy and exits 1, with no stop attempted, when the pre-stop recheck shows a different pid', () => {
    const { result, markers, destPath } = runPreview({
      steps: [
        { output: NO_SERVER, exitCode: 0 },
        { output: freshStart(11), exitCode: 0 },
        { output: statusRunning(11), exitCode: 0 },
        { output: statusRunning(12), exitCode: 0 },
      ],
      signals: [{ afterCallIndex: 2, delayMs: 10, signal: 'SIGINT' }],
    });
    expect(result.status).toBe(1);
    expect(markers.filter((m) => m.startsWith('spawn:'))).toEqual([
      'spawn:npx astro dev status',
      'spawn:npm run dev -- --background',
      'spawn:npx astro dev status',
      'spawn:npx astro dev status',
    ]);
    expect(markers).toContain('unlink');
    expect(existsSync(destPath)).toBe(false);
  });

  it('deletes the copy and exits 1, with no stop attempted, when the pre-stop recheck shows no server running', () => {
    const { result, markers, destPath } = runPreview({
      steps: [
        { output: NO_SERVER, exitCode: 0 },
        { output: freshStart(11), exitCode: 0 },
        { output: statusRunning(11), exitCode: 0 },
        { output: NO_SERVER, exitCode: 0 },
      ],
      signals: [{ afterCallIndex: 2, delayMs: 10, signal: 'SIGINT' }],
    });
    expect(result.status).toBe(1);
    expect(markers).toContain('unlink');
    expect(existsSync(destPath)).toBe(false);
  });

  it('deletes the copy and exits 1 when the pre-stop recheck itself fails to run', () => {
    const { result, destPath } = runPreview({
      steps: [
        { output: NO_SERVER, exitCode: 0 },
        { output: freshStart(11), exitCode: 0 },
        { output: statusRunning(11), exitCode: 0 },
        { throws: 'boom' },
      ],
      signals: [{ afterCallIndex: 2, delayMs: 10, signal: 'SIGINT' }],
    });
    expect(result.status).toBe(1);
    expect(existsSync(destPath)).toBe(false);
  });

  it('still deletes the copy but exits nonzero when the stop command throws synchronously', () => {
    const { result, markers, destPath } = runPreview({
      steps: [
        { output: NO_SERVER, exitCode: 0 },
        { output: freshStart(11), exitCode: 0 },
        { output: statusRunning(11), exitCode: 0 },
        { output: statusRunning(11), exitCode: 0 },
        { throws: 'boom' },
      ],
      signals: [{ afterCallIndex: 2, delayMs: 10, signal: 'SIGINT' }],
    });
    expect(result.status).toBe(1);
    expect(markers).toContain('unlink');
    expect(existsSync(destPath)).toBe(false);
  });

  it('still deletes the copy but exits nonzero when the stop command emits an error event', () => {
    const { result, markers, destPath } = runPreview({
      steps: [
        { output: NO_SERVER, exitCode: 0 },
        { output: freshStart(11), exitCode: 0 },
        { output: statusRunning(11), exitCode: 0 },
        { output: statusRunning(11), exitCode: 0 },
        { error: 'boom' },
      ],
      signals: [{ afterCallIndex: 2, delayMs: 10, signal: 'SIGINT' }],
    });
    expect(result.status).toBe(1);
    expect(markers).toContain('unlink');
    expect(existsSync(destPath)).toBe(false);
  });

  it('still deletes the copy but exits nonzero when the stop command exits nonzero', () => {
    const { result, markers, destPath } = runPreview({
      steps: [
        { output: NO_SERVER, exitCode: 0 },
        { output: freshStart(11), exitCode: 0 },
        { output: statusRunning(11), exitCode: 0 },
        { output: statusRunning(11), exitCode: 0 },
        { exitCode: 1 },
      ],
      signals: [{ afterCallIndex: 2, delayMs: 10, signal: 'SIGINT' }],
    });
    expect(result.status).toBe(1);
    expect(markers).toContain('unlink');
    expect(existsSync(destPath)).toBe(false);
  });

  it('still deletes the copy but exits nonzero when the stop command exits by signal only', () => {
    const { result, markers, destPath } = runPreview({
      steps: [
        { output: NO_SERVER, exitCode: 0 },
        { output: freshStart(11), exitCode: 0 },
        { output: statusRunning(11), exitCode: 0 },
        { output: statusRunning(11), exitCode: 0 },
        { exitCode: null, exitSignal: 'SIGKILL' },
      ],
      signals: [{ afterCallIndex: 2, delayMs: 10, signal: 'SIGINT' }],
    });
    expect(result.status).toBe(1);
    expect(markers).toContain('unlink');
    expect(existsSync(destPath)).toBe(false);
  });

  it('exits 1 with the copy left in place when the stop succeeds but deletion fails', () => {
    const { result, markers, destPath } = runPreview({
      steps: [
        { output: NO_SERVER, exitCode: 0 },
        { output: freshStart(11), exitCode: 0 },
        { output: statusRunning(11), exitCode: 0 },
        { output: statusRunning(11), exitCode: 0 },
        { output: stoppedLine(11), exitCode: 0 },
      ],
      signals: [{ afterCallIndex: 2, delayMs: 10, signal: 'SIGINT' }],
      unlinkFails: true,
    } as Script & { unlinkFails: boolean });
    expect(result.status).toBe(1);
    expect(markers).toContain('unlink');
    expect(existsSync(destPath)).toBe(true);
  });
});

describe('previewBlocks real CLI integration', () => {
  it('runs the real CLI through status -> start -> status -> signal -> status -> stop -> delete -> exit 0', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ambercast-preview #cli-'));
    fixtures.push(root);
    const cliPath = join(root, 'preview #blocks.mjs');
    const sourcePath = join(root, 'blocks.mdx');
    const destPath = join(root, 'preview-blocks.mdx');
    const flagPath = join(root, 'server-running-flag');
    writeFileSync(cliPath, readFileSync(fileURLToPath(scriptUrl)));
    writeFileSync(sourcePath, 'source content');

    const fakeNpm = join(root, 'npm');
    writeFileSync(
      fakeNpm,
      `#!${process.execPath}\nconst fs = require('node:fs');\nconst args = process.argv.slice(2).join(' ');\nif (args !== 'run dev -- --background') process.exit(2);\nfs.writeFileSync(${JSON.stringify(flagPath)}, '42');\nconsole.log(JSON.stringify({ message: 'Dev server running at http://localhost:4321 (pid 42)\\n  Stop:   astro dev stop\\n  Status: astro dev status\\n  Logs:   astro dev logs', label: 'SKIP_FORMAT', level: 'info' }));\n`,
    );
    chmodSync(fakeNpm, 0o755);

    const fakeNpx = join(root, 'npx');
    writeFileSync(
      fakeNpx,
      `#!${process.execPath}\nconst fs = require('node:fs');\nconst args = process.argv.slice(2).join(' ');\nif (args === 'astro dev status') {\n  if (fs.existsSync(${JSON.stringify(flagPath)})) console.log(JSON.stringify({ message: 'Dev server running at http://localhost:4321 (pid 42, uptime 1s, background)', label: 'SKIP_FORMAT', level: 'info' }));\n  else console.log(JSON.stringify({ message: 'No dev server is running.', label: 'SKIP_FORMAT', level: 'info' }));\n} else if (args === 'astro dev stop') {\n  fs.unlinkSync(${JSON.stringify(flagPath)});\n  console.log(JSON.stringify({ message: 'Stopped dev server (pid 42).', label: 'SKIP_FORMAT', level: 'info' }));\n} else {\n  process.exit(2);\n}\n`,
    );
    chmodSync(fakeNpx, 0o755);

    const child = spawn(process.execPath, [realpathSync(cliPath)], {
      env: {
        ...process.env,
        PATH: `${root}:${process.env.PATH ?? ''}`,
        AMBERCAST_PREVIEW_SOURCE_PATH: sourcePath,
        AMBERCAST_PREVIEW_DEST_PATH: destPath,
      },
    });
    let stderr = '';
    child.stderr?.on('data', (chunk) => { stderr += chunk; });

    await waitFor(() => existsSync(flagPath));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(existsSync(destPath)).toBe(true);

    child.kill('SIGINT');
    const [code, signal] = await new Promise<[number | null, NodeJS.Signals | null]>((resolve) => {
      child.once('exit', (code, signal) => resolve([code, signal]));
    });

    expect(stderr).toBe('');
    expect(signal).toBeNull();
    expect(code).toBe(0);
    expect(existsSync(flagPath)).toBe(false);
    expect(existsSync(destPath)).toBe(false);
  }, 10000);
});

describe('previewBlocks temporary destination', () => {
  it('ignores the temporary destination in website/.gitignore', () => {
    const gitignore = readFileSync(fileURLToPath(new URL('../.gitignore', import.meta.url)), 'utf8');
    expect(gitignore.split(/\r?\n/)).toContain('src/content/docs/preview-blocks.mdx');
  });
});
