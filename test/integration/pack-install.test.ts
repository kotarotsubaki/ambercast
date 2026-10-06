import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const source = fileURLToPath(new URL('../../scripts/pack-install.mjs', import.meta.url));
const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
let pnpmVersion: string | undefined;
try {
  pnpmVersion = execFileSync('pnpm', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
} catch {
  pnpmVersion = undefined;
}

interface Fixture {
  root: string;
  repo: string;
  script: string;
  out: string;
  consumer: string;
  env: NodeJS.ProcessEnv;
  sha: string;
}

interface Result { status: number; stdout: string; stderr: string }
const roots: string[] = [];

function invoke(file: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Result {
  const result = spawnSync(file, args, { cwd, env, encoding: 'utf8' });
  if (result.error) throw result.error;
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function git(f: Fixture, args: string[]): string {
  return execFileSync(realGit, args, { cwd: f.repo, env: f.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function run(f: Fixture, args: string[], options: { script?: string; cwd?: string; env?: NodeJS.ProcessEnv } = {}): Result {
  return invoke(process.execPath, [options.script ?? f.script, ...args], options.cwd ?? f.repo, options.env ?? f.env);
}

function pack(f: Fixture, flags: string[] = []): Result {
  return run(f, ['pack', '--out-dir', f.out, ...flags]);
}

function install(f: Fixture, flags: string[] = []): Result {
  return run(f, ['install', f.consumer, '--out-dir', f.out, ...flags]);
}

function manifestPath(f: Fixture, dirty = false): string {
  return join(f.out, `${f.sha}${dirty ? '-dirty' : ''}`, 'manifest.json');
}

interface Manifest {
  schemaVersion: number;
  name: string;
  version: string;
  sha: string;
  dirty: boolean;
  dirtyPaths: string[];
  tarball: string;
  integrity: string;
}

function manifest(f: Fixture): Manifest {
  return JSON.parse(readFileSync(manifestPath(f), 'utf8'));
}

function succeeds(result: Result): void {
  expect(result.status, result.stderr).toBe(0);
}

function fails(result: Result, diagnostic: string | RegExp): void {
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(diagnostic);
}

async function fixture(): Promise<Fixture> {
  // A separate committed repository makes shipped-path status and HEAD observable.
  const root = await realpath(await mkdtemp(join(tmpdir(), 'ambercast-pack-install-')));
  roots.push(root);
  const f: Fixture = {
    root, repo: root, script: join(root, 'scripts', 'pack-install.mjs'),
    out: join(root, 'out'), consumer: join(root, 'consumer'), sha: '',
    env: {
      ...process.env, GIT_CONFIG_GLOBAL: '/dev/null',
      npm_config_cache: join(root, 'npm-cache'), npm_config_store_dir: join(root, 'pnpm-store'),
      npm_config_update_notifier: 'false', npm_config_manage_package_manager_versions: 'false',
    },
  };
  await mkdir(join(root, 'bin'));
  await mkdir(join(root, 'scripts'));
  await mkdir(f.consumer);
  await writeFile(join(root, 'package.json'), JSON.stringify({
    name: 'ambercast', version: '0.0.0-fixture', bin: { ambercast: 'bin/ambercast.js' },
    files: ['bin', 'dist'], scripts: { build: 'node build.mjs' },
  }, null, 2) + '\n');
  await writeFile(join(root, 'build.mjs'), "import { mkdirSync, writeFileSync } from 'node:fs';\nmkdirSync('dist', { recursive: true });\nwriteFileSync('dist/built.txt', 'built\\n');\n");
  await writeFile(join(root, 'bin/ambercast.js'), "#!/usr/bin/env node\nconsole.log('ambercast v0.0.0-fixture');\n");
  await chmod(join(root, 'bin/ambercast.js'), 0o755);
  await writeFile(join(root, 'README.md'), 'Fixture README\n');
  await writeFile(join(root, 'LICENSE'), 'Fixture license\n');
  await copyFile(source, f.script);
  await writeFile(join(f.consumer, 'package.json'), JSON.stringify({ name: 'consumer', private: true }, null, 2) + '\n');
  git(f, ['init', '-q']);
  git(f, ['add', '--', 'package.json', 'build.mjs', 'bin/ambercast.js', 'README.md', 'LICENSE', 'scripts/pack-install.mjs']);
  git(f, ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture']);
  f.sha = git(f, ['rev-parse', 'HEAD']);
  return f;
}

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
    expect(existsSync(root)).toBe(false);
  }
});

describe('pack-install integration (real git + npm/pnpm fixture)', () => {
  it('TEST-B1: clean pack has canonical manifest, built tarball and exact stdout; repack replaces it', async () => {
    const f = await fixture();
    const result = pack(f);
    succeeds(result);
    const m = manifest(f);
    const path = manifestPath(f);
    expect(m).toMatchObject({ schemaVersion: 1, name: 'ambercast', version: '0.0.0-fixture', sha: f.sha, dirty: false, dirtyPaths: [] });
    expect(m.tarball).toBe(join(f.out, f.sha, m.tarball.split('/').at(-1) as string));
    expect(existsSync(m.tarball)).toBe(true);
    const integrity = `sha512-${createHash('sha512').update(readFileSync(m.tarball)).digest('base64')}`;
    expect(m.integrity).toBe(integrity);
    expect(readFileSync(path, 'utf8')).toBe(JSON.stringify({
      schemaVersion: 1, name: 'ambercast', version: '0.0.0-fixture', sha: f.sha,
      dirty: false, dirtyPaths: [], tarball: m.tarball, integrity,
    }, null, 2) + '\n');
    expect(execFileSync('tar', ['-tf', m.tarball], { cwd: f.repo, env: f.env, encoding: 'utf8' }).split('\n')).toContain('package/dist/built.txt');
    expect(result.stdout).toBe([
      `pack-install: packed ambercast@0.0.0-fixture from ${f.sha} (clean)`,
      `tarball: ${m.tarball}`, `manifest: ${path}`, 'install:',
      `  node ${f.script} install <project-dir> --manifest ${path}`,
      `  npm install --save-dev ${m.tarball}`, `  pnpm add --save-dev ${m.tarball}`, '',
    ].join('\n'));
    expect(readdirSync(f.out).filter((x) => x.startsWith('.staging-'))).toEqual([]);
    await writeFile(path, 'replace me\n');
    succeeds(pack(f));
    expect(readFileSync(path, 'utf8')).not.toBe('replace me\n');
    expect(readdirSync(f.out).filter((x) => x.startsWith('.staging-'))).toEqual([]);
  }, 60000);

  it.each([
    ['tracked bin', async (f: Fixture) => writeFile(join(f.repo, 'bin/ambercast.js'), '// changed\n'), ['bin/ambercast.js']],
    ['untracked src', async (f: Fixture) => { await mkdir(join(f.repo, 'src')); await writeFile(join(f.repo, 'src/new.ts'), 'export {};\n'); }, ['src/new.ts']],
    ['renamed shipped file', async (f: Fixture) => { git(f, ['mv', 'README.md', 'bin/cli.js']); }, ['README.md', 'bin/cli.js']],
  ] as const)('TEST-B2: rejects %s before creating out-dir', async (_name, mutate, paths) => {
    const f = await fixture();
    await mutate(f);
    const result = pack(f);
    expect(result.status).toBe(1);
    for (const path of paths) expect(result.stderr).toContain(path);
    expect(result.stderr).toContain('--allow-dirty');
    expect(existsSync(f.out)).toBe(false);
  }, 60000);

  it('TEST-B2: untracked paths outside shipped sources are clean', async () => {
    const f = await fixture();
    await mkdir(join(f.repo, 'test'));
    await writeFile(join(f.repo, 'notes.txt'), 'note\n');
    await writeFile(join(f.repo, 'test/x.txt'), 'test\n');
    succeeds(pack(f));
    expect(manifest(f)).toMatchObject({ dirty: false, dirtyPaths: [] });
  }, 60000);

  it('TEST-B2: allow-dirty warns and uses only a dirty key', async () => {
    const f = await fixture();
    await writeFile(join(f.repo, 'bin/ambercast.js'), '// changed\n');
    const result = pack(f, ['--allow-dirty']);
    succeeds(result);
    expect(result.stderr.split('\n')[0]).toBe(`WARNING: uncommitted changes in shipped paths; the tarball does not match ${f.sha}`);
    expect(result.stderr).toContain('bin/ambercast.js');
    expect(JSON.parse(readFileSync(manifestPath(f, true), 'utf8'))).toMatchObject({ dirty: true, dirtyPaths: ['bin/ambercast.js'] });
    expect(existsSync(join(f.out, f.sha))).toBe(false);
  }, 60000);

  it('TEST-B3: first build failure leaves no staging or final key', async () => {
    const f = await fixture();
    await writeFile(join(f.repo, 'build.mjs'), 'process.exit(1);\n');
    const result = pack(f);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/npm run build failed|build failed/i);
    expect(existsSync(join(f.out, f.sha))).toBe(false);
    if (existsSync(f.out)) expect(readdirSync(f.out).filter((x) => x.startsWith('.staging-'))).toEqual([]);
  }, 60000);

  it('TEST-B3: later build failure preserves the old manifest', async () => {
    const f = await fixture();
    succeeds(pack(f));
    const before = readFileSync(manifestPath(f));
    await writeFile(join(f.repo, 'build.mjs'), 'process.exit(1);\n');
    expect(pack(f).status).toBe(1);
    expect(readFileSync(manifestPath(f))).toEqual(before);
    expect(readdirSync(f.out).filter((x) => x.startsWith('.staging-'))).toEqual([]);
  }, 60000);

  it('TEST-B3: a non-git script directory fails with not a git checkout', async () => {
    const f = await fixture();
    const plain = join(f.root, 'plain');
    await mkdir(join(plain, 'scripts'), { recursive: true });
    const script = join(plain, 'scripts/pack-install.mjs');
    await copyFile(source, script);
    fails(run(f, ['pack', '--out-dir', f.out], { script, cwd: plain }), 'pack-install: not a git checkout');
  }, 60000);

  it('TEST-B3: install discovery from a non-git script directory fails with not a git checkout', async () => {
    const f = await fixture();
    const plain = join(f.root, 'plain');
    await mkdir(join(plain, 'scripts'), { recursive: true });
    const script = join(plain, 'scripts/pack-install.mjs');
    await copyFile(source, script);
    fails(run(f, ['install', f.consumer, '--out-dir', f.out], { script, cwd: plain }), 'pack-install: not a git checkout');
  }, 60000);

  it('TEST-B4: npm install verifies dependency, lockfile and executable; discovery and repetition work', async () => {
    const f = await fixture();
    succeeds(pack(f));
    const m = manifest(f);
    const result = install(f, ['--manifest', manifestPath(f)]);
    succeeds(result);
    expect(result.stdout).toBe(`pack-install: OK ambercast v0.0.0-fixture from ${f.sha} (clean) installed with npm into ${f.consumer}\n`);
    expect(JSON.parse(readFileSync(join(f.consumer, 'package.json'), 'utf8')).devDependencies.ambercast).toMatch(/^file:/);
    expect(JSON.parse(readFileSync(join(f.consumer, 'package-lock.json'), 'utf8')).packages['node_modules/ambercast'].integrity).toBe(m.integrity);
    expect(execFileSync(join(f.consumer, 'node_modules/.bin/ambercast'), ['--version'], { cwd: f.consumer, env: f.env, encoding: 'utf8' })).toBe('ambercast v0.0.0-fixture\n');
    succeeds(install(f));
    succeeds(install(f, ['--manifest', manifestPath(f)]));
  }, 60000);

  it.skipIf(!pnpmVersion)('TEST-B5: explicit pnpm install checks lockfile (skipped: pnpm not available)', async () => {
    const f = await fixture();
    succeeds(pack(f));
    const result = install(f, ['--manifest', manifestPath(f), '--pm', 'pnpm']);
    succeeds(result);
    expect(result.stdout).toContain('installed with pnpm');
    expect(readFileSync(join(f.consumer, 'pnpm-lock.yaml'), 'utf8')).toContain(`integrity: ${manifest(f).integrity}`);
  }, 60000);

  it.skipIf(!pnpmVersion)('TEST-B5: packageManager selects pnpm without --pm (skipped: pnpm not available)', async () => {
    const f = await fixture();
    succeeds(pack(f));
    await writeFile(join(f.consumer, 'package.json'), JSON.stringify({ name: 'consumer', private: true, packageManager: `pnpm@${pnpmVersion}` }) + '\n');
    const result = install(f, ['--manifest', manifestPath(f)]);
    succeeds(result);
    expect(result.stdout).toContain('installed with pnpm');
    expect(readFileSync(join(f.consumer, 'pnpm-lock.yaml'), 'utf8')).toContain(`integrity: ${manifest(f).integrity}`);
  }, 60000);

  it('TEST-B6: changed tarball fails integrity validation', async () => {
    const f = await fixture();
    succeeds(pack(f));
    appendFileSync(manifest(f).tarball, 'x');
    fails(install(f, ['--manifest', manifestPath(f)]), /integrity|does not match/i);
  }, 60000);

  it('TEST-B6: unpacked HEAD requires pack first', async () => {
    const f = await fixture();
    fails(install(f), 'run pack first');
  }, 60000);

  it.each([['missing', null], ['malformed', '{'], ['array', '[]']])('TEST-B6: %s consumer package.json fails before package manager launch', async (_name, content) => {
    const f = await fixture();
    succeeds(pack(f));
    if (content === null) await rm(join(f.consumer, 'package.json'));
    else await writeFile(join(f.consumer, 'package.json'), content);
    fails(install(f, ['--manifest', manifestPath(f)]), 'is not a readable JSON object');
    for (const path of ['node_modules', 'package-lock.json', 'pnpm-lock.yaml']) expect(existsSync(join(f.consumer, path))).toBe(false);
  }, 60000);

  it('TEST-B6: npm install command failure is reported', async () => {
    const f = await fixture();
    succeeds(pack(f));
    const shims = join(f.root, 'shims');
    await mkdir(shims);
    const shim = join(shims, 'npm');
    await writeFile(shim, '#!/bin/sh\nexit 7\n');
    await chmod(shim, 0o755);
    f.env.PATH = `${shims}${delimiter}${f.env.PATH ?? ''}`;
    fails(install(f, ['--manifest', manifestPath(f)]), /pack-install: npm install failed \(\d+\)/);
  }, 60000);

  it('TEST-B6: installed CLI version mismatch shows expected and actual', async () => {
    const f = await fixture();
    await writeFile(join(f.repo, 'bin/ambercast.js'), "#!/usr/bin/env node\nconsole.log('ambercast v9.9.9');\n");
    git(f, ['add', '--', 'bin/ambercast.js']);
    git(f, ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'different bin']);
    f.sha = git(f, ['rev-parse', 'HEAD']);
    succeeds(pack(f));
    const result = install(f, ['--manifest', manifestPath(f)]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('0.0.0-fixture');
    expect(result.stderr).toContain('9.9.9');
  }, 60000);

  it('TEST-B6: installed CLI non-zero exit is reported as a command failure', async () => {
    const f = await fixture();
    await writeFile(join(f.repo, 'bin/ambercast.js'), '#!/usr/bin/env node\nprocess.exit(7);\n');
    git(f, ['add', '--', 'bin/ambercast.js']);
    git(f, ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'failing bin']);
    f.sha = git(f, ['rev-parse', 'HEAD']);
    succeeds(pack(f));
    fails(install(f, ['--manifest', manifestPath(f)]), /pack-install: .*ambercast.* failed \(7\)/);
  }, 60000);

  it('TEST-B6: pnpm missing on PATH fails', async () => {
    const f = await fixture();
    succeeds(pack(f));
    const limited = join(f.root, 'limited-path');
    await mkdir(limited);
    fails(run(f, ['install', f.consumer, '--manifest', manifestPath(f), '--pm', 'pnpm'], { env: { ...f.env, PATH: limited } }), 'pnpm not found on PATH');
  }, 60000);

  it.each([
    ['schemaVersion', (m: Record<string, unknown>) => { m.schemaVersion = 2; }],
    ['name', (m: Record<string, unknown>) => { m.name = ''; }],
    ['version', (m: Record<string, unknown>) => { delete m.version; }],
    ['sha', (m: Record<string, unknown>) => { m.sha = (m.sha as string).toUpperCase(); }],
    ['dirty', (m: Record<string, unknown>) => { m.dirty = 'no'; }],
    ['dirtyPaths', (m: Record<string, unknown>) => { m.dirtyPaths = ['bin/ambercast.js']; }],
    ['integrity', (m: Record<string, unknown>) => { m.integrity = (m.integrity as string).replace(/^sha512-/, 'sha1-'); }],
    ['tarball', (m: Record<string, unknown>) => { m.tarball = 'relative.tgz'; }],
  ] as const)('TEST-B6: corrupted %s manifest field fails', async (_field, corrupt) => {
    const f = await fixture();
    succeeds(pack(f));
    const m = manifest(f);
    corrupt(m as unknown as Record<string, unknown>);
    await writeFile(manifestPath(f), JSON.stringify(m) + '\n');
    expect(install(f, ['--manifest', manifestPath(f)]).status).toBe(1);
  }, 60000);

  it('TEST-B6: extra manifest field is ignored', async () => {
    const f = await fixture();
    succeeds(pack(f));
    await writeFile(manifestPath(f), JSON.stringify({ ...manifest(f), futureField: true }) + '\n');
    succeeds(install(f, ['--manifest', manifestPath(f)]));
  }, 60000);

  it('TEST-B9: pre-realpath script path invokes main and reports usage', async () => {
    const raw = await mkdtemp(join(tmpdir(), 'ambercast-pack-install-'));
    roots.push(raw);
    const script = join(raw, 'pack-install.mjs');
    await copyFile(source, script);
    const f = await fixture();
    const result = run(f, ['bogus'], { script });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/usage/i);
  }, 60000);

  it('TEST-B9: relative --out-dir resolves against child cwd', async () => {
    const f = await fixture();
    succeeds(run(f, ['pack', '--out-dir', 'rel-out']));
    const path = join(f.repo, 'rel-out', f.sha, 'manifest.json');
    expect(existsSync(path)).toBe(true);
    expect(existsSync(JSON.parse(readFileSync(path, 'utf8')).tarball)).toBe(true);
  }, 60000);

  it('TEST-B12: failed git status aborts without creating out-dir', async () => {
    const f = await fixture();
    const shims = join(f.root, 'shims');
    await mkdir(shims);
    const shim = join(shims, 'git');
    await writeFile(shim, `#!/bin/sh\nif [ "$1" = "status" ]; then exit 128; fi\nexec '${realGit}' "$@"\n`);
    await chmod(shim, 0o755);
    fails(run(f, ['pack', '--out-dir', f.out], { env: { ...f.env, PATH: `${shims}${delimiter}${f.env.PATH ?? ''}` } }), 'git status failed (128)');
    expect(existsSync(f.out)).toBe(false);
  }, 60000);
});
