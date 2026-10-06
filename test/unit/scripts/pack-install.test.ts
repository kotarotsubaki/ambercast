/** Tests the pack/install contracts with real temporary files and lockfiles. */
// @ts-expect-error The production ESM script is deliberately untyped JavaScript.
import { TARBALL_SOURCE_PATHS, prepareStaging, detectPackageManager, lockfileHasIntegrity, readPackResult, checkInstalledVersion, main } from '../../../scripts/pack-install.mjs';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const dirs: string[] = [];
function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ambercast-pack-install-unit-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('TARBALL_SOURCE_PATHS', () => {
  it('TEST-B10 includes package files and metadata, and every source path exists', () => {
    const files = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).files as string[];
    for (const path of [...files.filter((path) => path !== 'dist'), 'package.json', 'README.md', 'LICENSE']) expect(TARBALL_SOURCE_PATHS).toContain(path);
    for (const path of TARBALL_SOURCE_PATHS) expect(existsSync(join(root, path))).toBe(true);
  });
});

describe('prepareStaging', () => {
  it('TEST-B3 removes a reused staging directory and recreates it empty', () => {
    const out = freshDir();
    const staging = join(out, '.staging-key-123');
    mkdirSync(staging);
    writeFileSync(join(staging, 'old'), 'stale');
    expect(prepareStaging(out, 'key', 123)).toBe(staging);
    expect(readdirSync(staging)).toEqual([]);
  });
  it('TEST-B3 leaves another key and pid untouched', () => {
    const out = freshDir();
    const other = join(out, '.staging-other-456');
    mkdirSync(other);
    writeFileSync(join(other, 'keep'), 'unchanged');
    const staging = prepareStaging(out, 'key', 123);
    expect(staging).toBe(join(out, '.staging-key-123'));
    expect(readdirSync(staging)).toEqual([]);
    expect(readFileSync(join(other, 'keep'), 'utf8')).toBe('unchanged');
  });
});

describe('detectPackageManager', () => {
  it.each([
    ['both lockfiles', ['pnpm-lock.yaml', 'package-lock.json'], undefined, undefined, true],
    ['yarn.lock', ['yarn.lock'], undefined, undefined, true],
    ['bun.lock', ['bun.lock'], undefined, undefined, true],
    ['bun.lockb', ['bun.lockb'], undefined, undefined, true],
    ['pnpm lockfile', ['pnpm-lock.yaml'], undefined, 'pnpm', false],
    ['npm lockfile', ['package-lock.json'], undefined, 'npm', false],
    ['pnpm declaration', [], 'pnpm@10.12.4', 'pnpm', false],
    ['npm declaration', [], 'npm@11.4.2', 'npm', false],
    ['yarn declaration', [], 'yarn@4.0.0', undefined, true],
    ['no hint', [], undefined, 'npm', false],
  ])('TEST-B7 %s', (_label, lockfiles, packageManager, expected, rejects) => {
    const dir = freshDir();
    writeFileSync(join(dir, 'package.json'), JSON.stringify(packageManager ? { packageManager } : {}));
    for (const name of lockfiles as string[]) writeFileSync(join(dir, name), '');
    if (rejects) {
      let failure: unknown;
      try {
        detectPackageManager(dir);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).not.toBe('not implemented');
    } else expect(detectPackageManager(dir)).toBe(expected);
  });
  it('TEST-B7 explicit --pm wins even when both lockfiles exist', () => {
    const dir = freshDir();
    writeFileSync(join(dir, 'package.json'), '{}');
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
    writeFileSync(join(dir, 'package-lock.json'), '');
    expect(detectPackageManager(dir, 'npm')).toBe('npm');
    expect(detectPackageManager(dir, 'pnpm')).toBe('pnpm');
  });
});

const integrity = 'sha512-testhash';
const npmLock = (packages: Record<string, unknown>) => JSON.stringify({ lockfileVersion: 3, packages });
const pnpmLock = (lines: string) => `lockfileVersion: '9.0'\npackages:\n${lines}`;
describe('lockfileHasIntegrity', () => {
  it.each([
    ['npm match', 'npm', 'ambercast', npmLock({ 'node_modules/ambercast': { integrity } }), true],
    ['npm mismatch', 'npm', 'ambercast', npmLock({ 'node_modules/ambercast': { integrity: 'sha512-other' } }), false],
    ['npm missing', 'npm', 'ambercast', npmLock({}), false],
    ['pnpm two-line match', 'pnpm', 'ambercast', pnpmLock('  ambercast@file:/tmp/a.tgz:\n    resolution: {integrity: sha512-testhash, tarball: file:/tmp/a.tgz}\n'), true],
    ['pnpm other package', 'pnpm', 'ambercast', pnpmLock('  other@file:/tmp/a.tgz:\n    resolution: {integrity: sha512-testhash, tarball: file:/tmp/a.tgz}\n'), false],
    ['pnpm snapshots only', 'pnpm', 'ambercast', "lockfileVersion: '9.0'\npackages: {}\nsnapshots:\n  ambercast@file:/tmp/a.tgz: {}\n", false],
    ['pnpm prefix only', 'pnpm', 'ambercast', pnpmLock('  ambercast@file:/tmp/a.tgz:\n    resolution: {integrity: sha512-testhash-extra, tarball: file:/tmp/a.tgz}\n'), false],
    ['pnpm second path', 'pnpm', 'ambercast', pnpmLock('  ambercast@file:/tmp/a.tgz:\n    resolution: {integrity: sha512-other, tarball: file:/tmp/a.tgz}\n  ambercast@file:/tmp/b.tgz:\n    resolution: {integrity: sha512-testhash, tarball: file:/tmp/b.tgz}\n'), true],
    ['pnpm regex escaped name', 'pnpm', 'a.b', pnpmLock('  axb@file:/tmp/a.tgz:\n    resolution: {integrity: sha512-testhash, tarball: file:/tmp/a.tgz}\n'), false],
    ['pnpm scoped name', 'pnpm', '@scope/pkg', pnpmLock('  @scope/pkg@file:/tmp/a.tgz:\n    resolution: {integrity: sha512-testhash, tarball: file:/tmp/a.tgz}\n'), true],
    ['pnpm missing', 'pnpm', 'ambercast', pnpmLock(''), false],
  ])('TEST-B8 %s', (_label, pm, name, body, expected) => {
    const dir = freshDir();
    writeFileSync(join(dir, pm === 'npm' ? 'package-lock.json' : 'pnpm-lock.yaml'), body);
    expect(lockfileHasIntegrity(dir, pm, name, integrity)).toBe(expected);
  });
});

function packFixture() {
  const dir = freshDir();
  const filename = 'ambercast-1.2.3.tgz';
  const bytes = Buffer.from('real tarball bytes');
  writeFileSync(join(dir, filename), bytes);
  const hash = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  return { dir, filename, hash, result: { name: 'ambercast', version: '1.2.3', filename, integrity: hash } };
}
describe('readPackResult', () => {
  it.each([
    ['empty array', () => '[]'],
    ['two elements', (result: object) => JSON.stringify([result, result])],
    ['missing integrity', (result: Record<string, string>) => JSON.stringify([{ ...result, integrity: undefined }])],
    ['sha1 integrity', (result: Record<string, string>) => JSON.stringify([{ ...result, integrity: 'sha1-abc' }])],
    ['mismatched tarball hash', (result: Record<string, string>) => JSON.stringify([{ ...result, integrity: 'sha512-wrong' }])],
  ])('TEST-B3 rejects %s', (_label, stdout) => {
    const fixture = packFixture();
    expect(() => readPackResult(stdout(fixture.result), fixture.dir)).toThrow('unexpected npm pack output');
  });
  it('TEST-B3 returns verified metadata and staged tarball path', () => {
    const { dir, filename, hash, result } = packFixture();
    expect(readPackResult(JSON.stringify([result]), dir)).toEqual({ name: 'ambercast', version: '1.2.3', integrity: hash, tarball: join(dir, filename) });
  });
  it.each(['../x.tgz', 'sub/x.tgz', 'missing.tgz'])('TEST-B12 rejects filename %s', (filename) => {
    const fixture = packFixture();
    expect(() => readPackResult(JSON.stringify([{ ...fixture.result, filename }]), fixture.dir)).toThrow('unexpected npm pack output');
  });
  it('TEST-B12 rejects a staged directory named as the tarball', () => {
    const fixture = packFixture();
    const filename = 'a-directory.tgz';
    mkdirSync(join(fixture.dir, filename));
    expect(() => readPackResult(JSON.stringify([{ ...fixture.result, filename }]), fixture.dir)).toThrow('unexpected npm pack output');
  });
});

describe('checkInstalledVersion', () => {
  it('TEST-B12 stops a hung executable in about one second', async () => {
    const dir = freshDir();
    const bin = join(dir, 'ambercast');
    const started = join(dir, 'started');
    const finished = join(dir, 'finished');
    writeFileSync(bin, `#!/usr/bin/env node\nconst fs = require('node:fs');\nfs.writeFileSync(${JSON.stringify(started)}, 'started');\nsetTimeout(() => { fs.writeFileSync(${JSON.stringify(finished)}, 'done'); process.stdout.write('ambercast v1.2.3\\n'); }, 60000);\n`);
    chmodSync(bin, 0o755);
    const start = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await expect(Promise.race([
        Promise.resolve().then(() => checkInstalledVersion(bin, '1.2.3', 200)),
        new Promise((resolve) => { timer = setTimeout(() => resolve('still running'), 1000); }),
      ])).rejects.toThrow();
      expect(Date.now() - start).toBeGreaterThanOrEqual(150);
      expect(Date.now() - start).toBeLessThan(1000);
      expect(existsSync(started)).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(existsSync(finished)).toBe(false);
    } finally {
      if (timer) clearTimeout(timer);
    }
  });
});

describe('main (argv parsing)', () => {
  it.each([
    ['no subcommand', []],
    ['unknown subcommand', ['bogus']],
    ['unknown flag', ['pack', '--unknown']],
    ['missing --out-dir value', ['pack', '--out-dir']],
    ['duplicate --out-dir', ['pack', '--out-dir', 'a', '--out-dir', 'b']],
    ['pack extra', ['pack', 'extra']],
    ['install extra', ['install', 'a', 'b']],
    ['pack --pm', ['pack', '--pm', 'npm']],
    ['install --allow-dirty', ['install', 'x', '--allow-dirty']],
    ['invalid --pm', ['install', 'x', '--pm', 'yarn']],
    ['missing install project', ['install']],
  ])('TEST-B9 %s returns usage error', async (_label, argv) => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await expect(main(argv, 'linux')).resolves.toBe(2);
    expect(stderr.mock.calls.map(([chunk]) => String(chunk)).join('')).toMatch(/usage:/i);
    expect(stdout).not.toHaveBeenCalled();
  });
  it('TEST-B9 rejects Windows before parsing with only the platform message', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await expect(main(['bogus'], 'win32')).resolves.toBe(2);
    expect(stderr.mock.calls.map(([chunk]) => String(chunk)).join('')).toBe('pack-install: Windows is not supported\n');
    expect(stdout).not.toHaveBeenCalled();
  });
  it.todo('TEST-B9 GAP: relative --out-dir resolves against cwd; no specified path output for direct main calls');
});
