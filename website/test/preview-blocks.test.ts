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

type Mode =
  | 'existing'
  | 'SIGINT'
  | 'SIGTERM'
  | 'nonzero'
  | 'signal-killed'
  | 'unlink-fails'
  | 'unlink-fails-after-stop'
  | 'spawn-error'
  | 'spawn-throws'
  | 'kill-before-daemonize'
  | 'stop-spawn-throws'
  | 'stop-error-event'
  | 'stop-nonzero';

function runPreview(mode: Mode) {
  const root = mkdtempSync(join(tmpdir(), 'ambercast-preview-blocks-'));
  fixtures.push(root);
  const sourcePath = join(root, 'blocks.mdx');
  const destPath = join(root, 'preview-blocks.mdx');
  const markersPath = join(root, 'markers.txt');
  const sourceBytes = Buffer.from([0, 10, 65, 255]);
  writeFileSync(sourcePath, sourceBytes);
  if (mode === 'existing') writeFileSync(destPath, Buffer.from([70, 0, 255]));

  const runner = join(root, 'runner.mjs');
  writeFileSync(runner, `
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { previewBlocks } from ${JSON.stringify(scriptUrl)};
const [mode, sourcePath, destPath, markersPath] = process.argv.slice(2);
const mark = (name) => appendFileSync(markersPath, name + '\\n');
process.on('exit', (code) => mark('process-exit:' + code));
let spawnCount = 0;
const daemonizeModes = ['SIGINT', 'SIGTERM', 'unlink-fails-after-stop', 'stop-spawn-throws', 'stop-error-event', 'stop-nonzero'];
const spawnFn = (cmd, args) => {
  spawnCount += 1;
  if (spawnCount === 2) {
    if (mode === 'stop-spawn-throws') {
      mark('stop-spawn:' + cmd + ' ' + args.join(' '));
      throw new Error('injected stop spawn failure');
    }
    mark('stop-spawn:' + cmd + ' ' + args.join(' '));
    const stopChild = new EventEmitter();
    if (mode === 'stop-error-event') {
      setImmediate(() => { mark('stop-error'); stopChild.emit('error', new Error('injected stop error')); });
    } else if (mode === 'stop-nonzero') {
      setImmediate(() => { mark('stop-exit'); stopChild.emit('exit', 1, null); });
    } else {
      setImmediate(() => { mark('stop-exit'); stopChild.emit('exit', 0, null); });
    }
    return stopChild;
  }
  mark('spawn');
  mark(readFileSync(destPath).equals(readFileSync(sourcePath)) ? 'copy-bytes-match' : 'copy-bytes-differ');
  if (mode === 'spawn-throws') throw new Error('injected spawn failure');
  const child = new EventEmitter();
  child.kill = (signal) => {
    mark('child-kill:' + signal);
    setImmediate(() => { mark('child-exit'); child.emit('exit', null, signal); });
    return true;
  };
  if (mode === 'spawn-error') {
    setImmediate(() => { mark('child-error'); child.emit('error', new Error('injected child error')); });
  } else if (mode === 'nonzero' || mode === 'unlink-fails') {
    setImmediate(() => { mark('child-exit'); child.emit('exit', 7, null); });
  } else if (mode === 'signal-killed') {
    setImmediate(() => { mark('child-exit'); child.emit('exit', null, 'SIGKILL'); });
  } else if (daemonizeModes.includes(mode)) {
    setImmediate(() => { mark('child-exit'); child.emit('exit', 0, null); });
    setTimeout(() => mark('dest-exists-after-daemonize:' + existsSync(destPath)), 15);
    setTimeout(() => process.kill(process.pid, mode === 'SIGTERM' ? 'SIGTERM' : 'SIGINT'), 30);
  } else if (mode === 'kill-before-daemonize') {
    setTimeout(() => process.kill(process.pid, 'SIGINT'), 15);
  }
  return child;
};
const unlinkFn = async (path) => {
  mark('unlink');
  if (mode === 'unlink-fails' || mode === 'unlink-fails-after-stop') throw new Error('injected unlink failure');
  await unlink(path);
};
try { await previewBlocks({ spawnFn, sourcePath, destPath, unlinkFn }); }
catch (error) { mark('error:' + error.message); process.exitCode = 1; }
`);
  const result = spawnSync(process.execPath, [runner, mode, sourcePath, destPath, markersPath], {
    encoding: 'utf8', timeout: 5000,
  });
  if (result.error) throw result.error;
  const markers = existsSync(markersPath) ? readFileSync(markersPath, 'utf8').trim().split('\n') : [];
  return { result, markers, sourcePath, destPath };
}

describe('previewBlocks temporary page lifecycle', () => {
  it('exits 1 without spawning or changing an existing destination', () => {
    const { result, markers, destPath } = runPreview('existing');
    expect(result.status).toBe(1);
    expect(markers).toEqual(['process-exit:1']);
    expect(readFileSync(destPath)).toEqual(Buffer.from([70, 0, 255]));
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    it(`keeps the preview running after Astro daemonizes, then stops the daemon and removes the page on ${signal}`, () => {
      const { result, markers, sourcePath, destPath } = runPreview(signal);
      expect(result.status).toBe(0);
      expect(result.signal).toBeNull();
      expect(markers).toEqual([
        'spawn',
        'copy-bytes-match',
        'child-exit',
        'dest-exists-after-daemonize:true',
        'stop-spawn:npx astro dev stop',
        'stop-exit',
        'unlink',
        'process-exit:0',
      ]);
      expect(readFileSync(sourcePath)).toEqual(Buffer.from([0, 10, 65, 255]));
      expect(existsSync(destPath)).toBe(false);
    });
  }

  it('waits for a still-starting child to actually exit before stopping the daemon when a signal arrives before Astro daemonizes', () => {
    const { result, markers, destPath } = runPreview('kill-before-daemonize');
    expect(result.status).toBe(0);
    expect(markers).toEqual([
      'spawn',
      'copy-bytes-match',
      'child-kill:SIGINT',
      'child-exit',
      'stop-spawn:npx astro dev stop',
      'stop-exit',
      'unlink',
      'process-exit:0',
    ]);
    expect(existsSync(destPath)).toBe(false);
  });

  it('removes the copy after a natural nonzero child exit and exits with that code', () => {
    const { result, markers, destPath } = runPreview('nonzero');
    expect(result.status).toBe(7);
    expect(markers).toEqual(['spawn', 'copy-bytes-match', 'child-exit', 'unlink', 'process-exit:7']);
    expect(existsSync(destPath)).toBe(false);
  });

  it('removes the copy and exits nonzero after a signal-only child exit', () => {
    const { result, markers, destPath } = runPreview('signal-killed');
    expect(result.status).not.toBe(0);
    expect(markers).toEqual(['spawn', 'copy-bytes-match', 'child-exit', 'unlink', `process-exit:${result.status}`]);
    expect(existsSync(destPath)).toBe(false);
  });

  it('runs the real CLI, copies the page, waits through daemonize, stops on SIGINT, and removes the page', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ambercast-preview #cli-'));
    fixtures.push(root);
    const marker = join(root, 'npm-marker');
    const stopMarker = join(root, 'npx-stop-marker');
    const fakeNpm = join(root, 'npm');
    const fakeNpx = join(root, 'npx');
    const cliPath = join(root, 'preview #blocks.mjs');
    const sourcePath = join(root, 'blocks.mdx');
    const destPath = join(root, 'preview-blocks.mdx');
    writeFileSync(cliPath, readFileSync(fileURLToPath(scriptUrl)));
    writeFileSync(sourcePath, Buffer.from([0, 10, 65, 255]));
    writeFileSync(fakeNpm, `#!${process.execPath}\nconst fs = require('node:fs');\nif (process.argv.slice(2).join(' ') !== 'run dev') process.exit(2);\nfs.writeFileSync(${JSON.stringify(marker)}, fs.readFileSync(${JSON.stringify(destPath)}));\n`);
    chmodSync(fakeNpm, 0o755);
    writeFileSync(fakeNpx, `#!${process.execPath}\nconst fs = require('node:fs');\nif (process.argv.slice(2).join(' ') !== 'astro dev stop') process.exit(2);\nfs.writeFileSync(${JSON.stringify(stopMarker)}, '');\n`);
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

    await waitFor(() => existsSync(marker));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(existsSync(destPath)).toBe(true);

    child.kill('SIGINT');
    const [code, signal] = await new Promise<[number | null, NodeJS.Signals | null]>((resolve) => {
      child.once('exit', (code, signal) => resolve([code, signal]));
    });

    expect(stderr).toBe('');
    expect(signal).toBeNull();
    expect(code).toBe(0);
    expect(readFileSync(marker)).toEqual(readFileSync(sourcePath));
    expect(existsSync(stopMarker)).toBe(true);
    expect(existsSync(destPath)).toBe(false);
  }, 10000);

  it('removes the copy and exits nonzero when the child emits error without exit', () => {
    const { result, markers, destPath } = runPreview('spawn-error');
    expect(result.status).toBe(1);
    expect(markers).toContain('unlink');
    expect(existsSync(destPath)).toBe(false);
  }, 10000);

  it('removes the copy when spawning throws synchronously', () => {
    const { result, markers, destPath } = runPreview('spawn-throws');
    expect(result.status).toBe(1);
    expect(markers).toContain('unlink');
    expect(existsSync(destPath)).toBe(false);
  });

  it('exits 1 when copy deletion fails after a nonzero child exit', () => {
    const { result, markers, destPath } = runPreview('unlink-fails');
    expect(result.status).toBe(1);
    expect(markers).toEqual(['spawn', 'copy-bytes-match', 'child-exit', 'unlink', 'process-exit:1']);
    expect(existsSync(destPath)).toBe(true);
  });

  it('exits 1 when copy deletion fails after the daemon stops following a signal', () => {
    const { result, markers, destPath } = runPreview('unlink-fails-after-stop');
    expect(result.status).toBe(1);
    expect(markers).toEqual([
      'spawn',
      'copy-bytes-match',
      'child-exit',
      'dest-exists-after-daemonize:true',
      'stop-spawn:npx astro dev stop',
      'stop-exit',
      'unlink',
      'process-exit:1',
    ]);
    expect(existsSync(destPath)).toBe(true);
  });

  it('still removes the copy but exits nonzero when the stop command throws synchronously', () => {
    const { result, markers, destPath } = runPreview('stop-spawn-throws');
    expect(result.status).toBe(1);
    expect(markers).toEqual([
      'spawn',
      'copy-bytes-match',
      'child-exit',
      'dest-exists-after-daemonize:true',
      'stop-spawn:npx astro dev stop',
      'unlink',
      'process-exit:1',
    ]);
    expect(existsSync(destPath)).toBe(false);
  });

  it('still removes the copy but exits nonzero when the stop command emits an error event', () => {
    const { result, markers, destPath } = runPreview('stop-error-event');
    expect(result.status).toBe(1);
    expect(markers).toEqual([
      'spawn',
      'copy-bytes-match',
      'child-exit',
      'dest-exists-after-daemonize:true',
      'stop-spawn:npx astro dev stop',
      'stop-error',
      'unlink',
      'process-exit:1',
    ]);
    expect(existsSync(destPath)).toBe(false);
  });

  it('still removes the copy but exits nonzero when the stop command exits nonzero', () => {
    const { result, markers, destPath } = runPreview('stop-nonzero');
    expect(result.status).toBe(1);
    expect(markers).toEqual([
      'spawn',
      'copy-bytes-match',
      'child-exit',
      'dest-exists-after-daemonize:true',
      'stop-spawn:npx astro dev stop',
      'stop-exit',
      'unlink',
      'process-exit:1',
    ]);
    expect(existsSync(destPath)).toBe(false);
  });

  it('ignores the temporary destination in website/.gitignore', () => {
    const gitignore = readFileSync(fileURLToPath(new URL('../.gitignore', import.meta.url)), 'utf8');
    expect(gitignore.split(/\r?\n/)).toContain('src/content/docs/preview-blocks.mdx');
  });
});
