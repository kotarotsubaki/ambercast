import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const scriptUrl = new URL('../scripts/preview-blocks.mjs', import.meta.url).href;
const fixtures: string[] = [];

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

function runPreview(mode: 'existing' | 'SIGINT' | 'SIGTERM' | 'nonzero' | 'unlink-fails' | 'unlink-fails-zero' | 'spawn-error' | 'spawn-throws') {
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
import { appendFileSync, readFileSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { previewBlocks } from ${JSON.stringify(scriptUrl)};
const [mode, sourcePath, destPath, markersPath] = process.argv.slice(2);
const mark = (name) => appendFileSync(markersPath, name + '\\n');
process.on('exit', (code) => mark('process-exit:' + code));
const spawnFn = () => {
  mark('spawn');
  mark(readFileSync(destPath).equals(readFileSync(sourcePath)) ? 'copy-bytes-match' : 'copy-bytes-differ');
  if (mode === 'spawn-throws') throw new Error('injected spawn failure');
  const child = new EventEmitter();
  if (mode === 'spawn-error') setImmediate(() => { mark('child-error'); child.emit('error', new Error('injected child error')); });
  child.kill = (signal) => {
    mark('child-kill:' + signal);
    setImmediate(() => { mark('child-exit'); child.emit('exit', 0, signal); });
    return true;
  };
  if (mode === 'nonzero' || mode === 'unlink-fails' || mode === 'unlink-fails-zero') {
    setImmediate(() => { mark('child-exit'); child.emit('exit', mode === 'unlink-fails-zero' ? 0 : 7, null); });
  } else if (mode === 'SIGINT' || mode === 'SIGTERM') {
    setTimeout(() => process.kill(process.pid, mode), 30);
  }
  return child;
};
const unlinkFn = async (path) => {
  mark('unlink');
  if (mode.startsWith('unlink-fails')) throw new Error('injected unlink failure');
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
    it(`copies bytes, forwards ${signal}, waits for child exit, then removes the page`, () => {
      const { result, markers, sourcePath, destPath } = runPreview(signal);
      expect(result.status).toBe(0);
      expect(result.signal).toBeNull();
      expect(markers).toEqual(['spawn', 'copy-bytes-match', `child-kill:${signal}`, 'child-exit', 'unlink', 'process-exit:0']);
      expect(readFileSync(sourcePath)).toEqual(Buffer.from([0, 10, 65, 255]));
      expect(existsSync(destPath)).toBe(false);
    });
  }

  it('removes the copy after a natural nonzero child exit and exits with that code', () => {
    const { result, markers, destPath } = runPreview('nonzero');
    expect(result.status).toBe(7);
    expect(markers).toEqual(['spawn', 'copy-bytes-match', 'child-exit', 'unlink', 'process-exit:7']);
    expect(existsSync(destPath)).toBe(false);
  });

  it('runs the real CLI, copies the page, starts npm run dev, and removes the page', () => {
    const root = mkdtempSync(join(tmpdir(), 'ambercast-preview-cli-'));
    fixtures.push(root);
    const marker = join(root, 'npm-marker');
    const fakeNpm = join(root, 'npm');
    const sourcePath = join(root, 'blocks.mdx');
    const destPath = join(root, 'preview-blocks.mdx');
    writeFileSync(sourcePath, Buffer.from([0, 10, 65, 255]));
    writeFileSync(fakeNpm, `#!${process.execPath}\nconst fs = require('node:fs');\nif (process.argv.slice(2).join(' ') !== 'run dev') process.exit(2);\nfs.writeFileSync(${JSON.stringify(marker)}, fs.readFileSync(${JSON.stringify(destPath)}));\n`);
    chmodSync(fakeNpm, 0o755);
    const result = spawnSync(process.execPath, [fileURLToPath(scriptUrl)], {
      encoding: 'utf8', timeout: 5000,
      env: {
        ...process.env,
        PATH: `${root}:${process.env.PATH ?? ''}`,
        AMBERCAST_PREVIEW_SOURCE_PATH: sourcePath,
        AMBERCAST_PREVIEW_DEST_PATH: destPath,
      },
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(readFileSync(marker)).toEqual(readFileSync(sourcePath));
    expect(existsSync(destPath)).toBe(false);
  });

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

  for (const mode of ['unlink-fails', 'unlink-fails-zero'] as const) {
    it(`exits 1 when copy deletion fails after ${mode} child exit`, () => {
      const { result, markers, destPath } = runPreview(mode);
      expect(result.status).toBe(1);
      expect(markers).toEqual(['spawn', 'copy-bytes-match', 'child-exit', 'unlink', 'process-exit:1']);
      expect(existsSync(destPath)).toBe(true);
    });
  }

  it('ignores the temporary destination in website/.gitignore', () => {
    const gitignore = readFileSync(fileURLToPath(new URL('../.gitignore', import.meta.url)), 'utf8');
    expect(gitignore.split(/\r?\n/)).toContain('src/content/docs/preview-blocks.mdx');
  });
});
