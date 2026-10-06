#!/usr/bin/env node
// Pack a checkout for verification in another project before an npm release.
// This standalone maintainer script keeps that downstream check independent of
// the published package and its release schedule.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Limit the dirty-tree guard to known shipped files and build inputs. Keep this
// list explicit: coverage is checked against the package files and known inputs,
// not inferred from future build configuration changes.
export const TARBALL_SOURCE_PATHS = [
  'bin',
  'skills',
  'src',
  'package.json',
  'package-lock.json',
  'tsdown.config.js',
  'tsconfig.json',
  'README.md',
  'LICENSE',
];

// Return a fresh staging path for this key and process. Remove an exact-name
// remnant before reuse because a signal may have left it behind; staging paths
// for other processes remain untouched so one run cannot erase another's work.
export function prepareStaging(outDir, key, pid) {
  const staging = join(outDir, `.staging-${key}-${pid}`);
  if (existsSync(staging)) {
    rmSync(staging, { recursive: true, force: true });
  }
  mkdirSync(staging, { recursive: true });
  return staging;
}

// Select npm or pnpm for the target project, with an explicit override taking
// precedence over lockfiles. Conflicting or unsupported lockfiles and package
// manager declarations must fail instead of silently choosing a different tool;
// absent hints select npm. This selection precedes any target-project mutation.
export function detectPackageManager(projectDir, pmOverride) {
  const hasLockfile = (name) => existsSync(join(projectDir, name));

  if (pmOverride) {
    if (pmOverride === 'npm' || pmOverride === 'pnpm') {
      return pmOverride;
    }
    throw new Error(`Unsupported package manager: ${pmOverride}`);
  }

  const hasPnpm = hasLockfile('pnpm-lock.yaml');
  const hasNpm = hasLockfile('package-lock.json');
  const hasUnsupported = hasLockfile('yarn.lock') || hasLockfile('bun.lock') || hasLockfile('bun.lockb');

  if (hasPnpm && hasNpm) {
    throw new Error('Both pnpm-lock.yaml and package-lock.json present; use --pm to specify');
  }

  if (hasUnsupported) {
    throw new Error('Unsupported lockfile detected');
  }

  if (hasPnpm) {
    return 'pnpm';
  }

  if (hasNpm) {
    return 'npm';
  }

  const pkgPath = join(projectDir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  if (pkg.packageManager) {
    if (pkg.packageManager.startsWith('pnpm@')) {
      return 'pnpm';
    }
    if (pkg.packageManager.startsWith('npm@')) {
      return 'npm';
    }
    throw new Error(`Unsupported package manager declaration: ${pkg.packageManager}`);
  }

  return 'npm';
}

// Return whether the selected manager's lockfile records this package's exact
// tarball integrity. npm uses its package entry; pnpm requires a literal-name
// file key and the following resolution line, parsed line by line rather than
// as YAML. Escape the name in the key regex and match the full integrity value.
// Any matching pnpm key suffices because integrity hashes the content, even
// when several file paths refer to it. A missing or partial match cannot certify
// an install, even when the package manager command itself succeeded.
export function lockfileHasIntegrity(projectDir, pm, name, integrity) {
  if (pm === 'npm') {
    const lockPath = join(projectDir, 'package-lock.json');
    if (!existsSync(lockPath)) {
      return false;
    }
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    const pkgPath = `node_modules/${name}`;
    const pkg = lock.packages?.[pkgPath];
    return pkg?.integrity === integrity;
  }

  const lockPath = join(projectDir, 'pnpm-lock.yaml');
  if (!existsSync(lockPath)) {
    return false;
  }
  const content = readFileSync(lockPath, 'utf8');

  // Escape name for regex (handles scoped names like @scope/pkg)
  const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedName = escapeRegex(name);
  const keyRegex = new RegExp(`^  ${escapedName}@file:.+:$`);
  const integrityRegex = new RegExp(`integrity: ${escapeRegex(integrity)}[,}]`);

  const lines = content.split('\n');
  const packagesStart = lines.findIndex((line) => /^packages:\s*$/.test(line));
  if (packagesStart === -1) return false;
  let packagesEnd = packagesStart + 1;
  while (packagesEnd < lines.length && (lines[packagesEnd].trim() === '' || /^\s/.test(lines[packagesEnd]))) {
    packagesEnd++;
  }
  for (let i = packagesStart + 1; i < packagesEnd; i++) {
    if (keyRegex.test(lines[i])) {
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        if (nextLine.startsWith('    resolution:') && integrityRegex.test(nextLine)) {
          return true;
        }
      }
    }
  }

  return false;
}

// Validate npm pack's single-result JSON before trusting any path or metadata.
// Require nonempty name, version, filename and sha512 integrity; the filename
// must be a safe basename naming a regular file directly in staging whose
// computed hash matches. Return { name, version, integrity, tarball }, or throw
// "unexpected npm pack output" before promotion, leaving the existing key intact.
export function readPackResult(stdout, stagingDir) {
  let result;
  try {
    result = JSON.parse(stdout);
  } catch {
    throw new Error('unexpected npm pack output');
  }

  if (!Array.isArray(result) || result.length !== 1) {
    throw new Error('unexpected npm pack output');
  }

  const packResult = result[0];
  if (packResult === null || typeof packResult !== 'object' || Array.isArray(packResult)) {
    throw new Error('unexpected npm pack output');
  }

  if (!packResult.name || typeof packResult.name !== 'string') {
    throw new Error('unexpected npm pack output');
  }
  if (!packResult.version || typeof packResult.version !== 'string') {
    throw new Error('unexpected npm pack output');
  }
  if (!packResult.filename || typeof packResult.filename !== 'string') {
    throw new Error('unexpected npm pack output');
  }
  if (!packResult.integrity || typeof packResult.integrity !== 'string' || !packResult.integrity.startsWith('sha512-')) {
    throw new Error('unexpected npm pack output');
  }

  const filename = packResult.filename;
  if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    throw new Error('unexpected npm pack output');
  }

  const tarballPath = join(stagingDir, filename);
  if (!existsSync(tarballPath)) {
    throw new Error('unexpected npm pack output');
  }
  try {
    const stat = lstatSync(tarballPath);
    if (!stat.isFile()) {
      throw new Error('unexpected npm pack output');
    }
  } catch {
    throw new Error('unexpected npm pack output');
  }

  let actualHash;
  try {
    actualHash = `sha512-${createHash('sha512').update(readFileSync(tarballPath)).digest('base64')}`;
  } catch {
    throw new Error('unexpected npm pack output');
  }
  if (actualHash !== packResult.integrity) {
    throw new Error('unexpected npm pack output');
  }

  return {
    name: packResult.name,
    version: packResult.version,
    integrity: packResult.integrity,
    tarball: tarballPath,
  };
}

// Run the fixed installed bin's --version command and require stdout to equal
// `ambercast v<expectedVersion>\n` byte for byte. A nonzero bin exit fails
// verification in its own right; the default 30-second limit separately stops
// a hung CLI. timeoutMs makes that limit testable without a long wait.
export function checkInstalledVersion(binPath, expectedVersion, timeoutMs = 30000) {
  // Invoke Node shebangs directly so a short timeout measures the CLI itself,
  // without spending most of it starting /usr/bin/env under test load.
  let shebang;
  try {
    shebang = readFileSync(binPath, 'utf8').split('\n', 1)[0];
  } catch (error) {
    throw new Error(`failed (${error.code || 'unknown'})`);
  }
  const nodeBin = shebang === '#!/usr/bin/env node';
  const result = spawnSync(nodeBin ? process.execPath : binPath, nodeBin ? [binPath, '--version'] : ['--version'], {
    encoding: 'utf8',
    timeout: timeoutMs,
  });

  if (result.signal) {
    throw new Error(`failed (${result.signal})`);
  }
  if (result.error) {
    throw new Error(`failed (${result.error.code || 'unknown'})`);
  }
  if (result.status !== 0) {
    throw new Error(`failed (${result.status})`);
  }

  const expected = `ambercast v${expectedVersion}\n`;
  if (result.stdout !== expected) {
    throw new Error(`expected "${expected.replace(/\n$/, '')}", got "${result.stdout.replace(/\n$/, '')}"`);
  }

  return true;
}

// Drive pack and install without exiting the process, so callers can assert
// diagnostics and exit codes directly. Reject Windows before parsing arguments;
// return 2 for usage or platform errors, 1 for operational or verification
// failures, and 0 only after the requested operation is verified. External
// command failures must stop later steps, and untrusted output is validated
// before it can select a file or certify an installed package. For pack, inspect
// shipped-path changes before building or creating output; refuse them unless
// explicitly allowed. Keep an existing successful key through build, pack, and
// staging failures, replacing it only after the new archive and manifest are
// ready. The delete-then-rename promotion has a narrow failure window in which
// the old key can be lost. Successful pack reports the archive, manifest, and
// checkout-local install command on stdout. For install, validate the manifest
// and archive before running a package manager, then verify the bin and lockfile
// before reporting success. Package-manager changes to the target package.json
// and lockfile persist on both success and later failure; no rollback is attempted.
export async function main(argv, platform = process.platform) {
  // SPEC-B1: Reject Windows before parsing
  if (platform === 'win32') {
    process.stderr.write('pack-install: Windows is not supported\n');
    return 2;
  }

  const args = argv.slice();
  let subcommand = null;
  let packFlags = {};
  let installFlags = {};
  let positional = [];

  // Track seen flags for duplicate detection
  const seenFlags = new Set();

  while (args.length > 0) {
    const arg = args.shift();

    if (arg.startsWith('--')) {
      const flag = arg;
      if (seenFlags.has(flag)) {
        return usageError(`duplicate flag: ${flag}`);
      }
      seenFlags.add(flag);

      if (flag === '--out-dir') {
        if (args.length === 0) {
          return usageError('missing value for --out-dir');
        }
        const value = args.shift();
        if (subcommand === 'pack') {
          packFlags.outDir = value;
        } else if (subcommand === 'install') {
          installFlags.outDir = value;
        } else {
          return usageError(`flag ${flag} does not belong to this subcommand`);
        }
        seenFlags.add('--out-dir');
      } else if (flag === '--manifest') {
        if (subcommand !== 'install') {
          return usageError(`flag ${flag} does not belong to this subcommand`);
        }
        if (args.length === 0) {
          return usageError('missing value for --manifest');
        }
        installFlags.manifest = args.shift();
        seenFlags.add('--manifest');
      } else if (flag === '--pm') {
        if (subcommand !== 'install') {
          return usageError(`flag ${flag} does not belong to this subcommand`);
        }
        if (args.length === 0) {
          return usageError('missing value for --pm');
        }
        const pmValue = args.shift();
        if (pmValue !== 'npm' && pmValue !== 'pnpm') {
          return usageError(`invalid value for --pm: ${pmValue}`);
        }
        installFlags.pm = pmValue;
        seenFlags.add('--pm');
      } else if (flag === '--allow-dirty') {
        if (subcommand === 'pack') {
          packFlags.allowDirty = true;
        } else if (subcommand === 'install') {
          return usageError(`flag ${flag} does not belong to this subcommand`);
        } else {
          return usageError(`flag ${flag} does not belong to this subcommand`);
        }
      } else {
        return usageError(`unknown flag: ${flag}`);
      }
    } else if (!subcommand) {
      subcommand = arg;
      if (subcommand !== 'pack' && subcommand !== 'install') {
        return usageError(`unknown subcommand: ${subcommand}`);
      }
    } else {
      positional.push(arg);
    }
  }

  if (!subcommand) {
    return usageError('missing subcommand');
  }

  if (subcommand === 'pack' && positional.length > 0) {
    return usageError('too many arguments for pack');
  }
  if (subcommand === 'install') {
    if (positional.length === 0) {
      return usageError('missing <project-dir> for install');
    }
    if (positional.length > 1) {
      return usageError('too many arguments for install');
    }
  }

  if (subcommand === 'pack') {
    return await packCommand(packFlags);
  } else {
    return await installCommand(positional[0], installFlags);
  }
}

function usageError(message) {
  process.stderr.write(`pack-install: ${message}\n`);
  process.stderr.write(`usage: node pack-install.mjs pack [--out-dir <dir>] [--allow-dirty]\n`);
  process.stderr.write(`       node pack-install.mjs install <project-dir> [--manifest <path>] [--out-dir <dir>] [--pm npm|pnpm]\n`);
  return 2;
}

function processFailure(result) {
  if (result.signal) return result.signal;
  if (result.error) return result.error.code || 'unknown';
  if (result.status !== 0) return result.status;
  return null;
}

function forwardOutput(result) {
  if (result.stdout) process.stderr.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

async function packCommand(flags) {
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const outDir = flags.outDir ? resolve(flags.outDir) : join(homedir(), '.cache', 'ambercast-pack');

  // SPEC-B2 ①: Get HEAD
  // Require checkout metadata at this script root; git otherwise walks upward
  // and can accidentally use an unrelated parent checkout's HEAD.
  if (!existsSync(join(repoRoot, '.git'))) {
    process.stderr.write('pack-install: not a git checkout\n');
    return 1;
  }
  let sha;
  try {
    sha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('invalid HEAD');
  } catch {
    process.stderr.write('pack-install: not a git checkout\n');
    return 1;
  }

  // SPEC-B2 ②: Check for dirty paths
  let statusOutput;
  try {
    statusOutput = execFileSync('git', [
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
      '--',
      ...TARBALL_SOURCE_PATHS,
    ], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
  } catch (error) {
    process.stderr.write(`pack-install: git status failed (${error.status ?? 'unknown'})\n`);
    return 1;
  }

  const dirtyPaths = [];
  if (statusOutput) {
    // With -z, a rename or copy has one extra NUL field for the old path.
    const parts = statusOutput.split('\0');
    for (let i = 0; i < parts.length && parts[i]; i++) {
      const part = parts[i];
      dirtyPaths.push(part.slice(3));
      if (part[0] === 'R' || part[1] === 'R' || part[0] === 'C' || part[1] === 'C') {
        dirtyPaths.push(parts[++i]);
      }
    }
  }

  const isDirty = dirtyPaths.length > 0;
  const key = isDirty ? `${sha}-dirty` : sha;

  if (isDirty && !flags.allowDirty) {
    process.stderr.write(`pack-install: uncommitted changes in shipped paths:\n`);
    for (const path of dirtyPaths.sort()) {
      process.stderr.write(`  ${path}\n`);
    }
    process.stderr.write(`use --allow-dirty to proceed\n`);
    return 1;
  }
  if (isDirty) {
    process.stderr.write(`WARNING: uncommitted changes in shipped paths; the tarball does not match ${sha}\n`);
    for (const path of dirtyPaths.sort()) process.stderr.write(`  ${path}\n`);
  }

  // SPEC-B2 ③: Run build (output to stderr)
  const buildResult = spawnSync('npm', ['run', 'build'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  forwardOutput(buildResult);
  const buildFailure = processFailure(buildResult);
  if (buildFailure !== null) {
    process.stderr.write(`pack-install: npm run build failed (${buildFailure})\n`);
    return 1;
  }

  // SPEC-B2 ④: Create out-dir and staging
  let staging;
  try {
    mkdirSync(outDir, { recursive: true });
    staging = prepareStaging(outDir, key, process.pid);

    // SPEC-B2 ④: Run npm pack
    const packResult = spawnSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', staging], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (packResult.stderr) process.stderr.write(packResult.stderr);
    const packFailure = processFailure(packResult);
    if (packFailure !== null) {
      process.stderr.write(`pack-install: npm pack failed (${packFailure})\n`);
      return 1;
    }

    // SPEC-B2 ⑤: Validate pack output and complete staging before promotion.
    const packed = readPackResult(packResult.stdout, staging);
    const finalDir = join(outDir, key);
    const finalTarball = join(finalDir, basename(packed.tarball));
    const manifestPath = join(finalDir, 'manifest.json');
    const manifest = {
      schemaVersion: 1,
      name: packed.name,
      version: packed.version,
      sha,
      dirty: isDirty,
      dirtyPaths: isDirty ? dirtyPaths.sort() : [],
      tarball: finalTarball,
      integrity: packed.integrity,
    };
    writeFileSync(join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

    // SPEC-B2 ⑥: Promote the complete staged directory.
    if (existsSync(finalDir)) rmSync(finalDir, { recursive: true, force: true });
    renameSync(staging, finalDir);
    staging = null;

    // SPEC-B2 ⑦: Output success
    const status = isDirty ? 'dirty' : 'clean';
    process.stdout.write(`pack-install: packed ${packed.name}@${packed.version} from ${sha} (${status})\n`);
    process.stdout.write(`tarball: ${finalTarball}\n`);
    process.stdout.write(`manifest: ${manifestPath}\n`);
    process.stdout.write(`install:\n`);
    const scriptPath = fileURLToPath(import.meta.url);
    process.stdout.write(`  node ${scriptPath} install <project-dir> --manifest ${manifestPath}\n`);
    process.stdout.write(`  npm install --save-dev ${finalTarball}\n`);
    process.stdout.write(`  pnpm add --save-dev ${finalTarball}\n`);

    return 0;
  } catch (error) {
    process.stderr.write(`pack-install: ${error.message}\n`);
    return 1;
  } finally {
    if (staging) {
      try {
        rmSync(staging, { recursive: true, force: true });
      } catch (error) {
        process.stderr.write(`pack-install: staging cleanup failed (${error.code || 'unknown'})\n`);
      }
    }
  }
}

async function installCommand(projectDir, flags) {
  const outDir = flags.outDir ? resolve(flags.outDir) : join(homedir(), '.cache', 'ambercast-pack');
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));

  const resolvedProjectDir = resolve(projectDir);

  const pkgPath = join(resolvedProjectDir, 'package.json');
  if (!existsSync(pkgPath)) {
    process.stderr.write(`pack-install: ${resolvedProjectDir} is not a readable JSON object\n`);
    return 1;
  }

  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch {
    process.stderr.write(`pack-install: ${resolvedProjectDir} is not a readable JSON object\n`);
    return 1;
  }

  if (typeof pkg !== 'object' || pkg === null || Array.isArray(pkg)) {
    process.stderr.write(`pack-install: ${resolvedProjectDir} is not a readable JSON object\n`);
    return 1;
  }

  let manifestPath;
  let sha;
  if (flags.manifest) {
    manifestPath = resolve(flags.manifest);
  } else {
    try {
      sha = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: repoRoot,
        encoding: 'utf8',
      }).trim();
    } catch {
      process.stderr.write('pack-install: not a git checkout\n');
      return 1;
    }
    manifestPath = join(outDir, sha, 'manifest.json');
  }

  if (!existsSync(manifestPath)) {
    process.stderr.write(flags.manifest
      ? `pack-install: manifest does not exist: ${manifestPath}\n`
      : `pack-install: no tarball for ${sha}; run pack first\n`);
    return 1;
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    process.stderr.write('pack-install: manifest is not valid JSON\n');
    return 1;
  }

  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    process.stderr.write('pack-install: manifest is not valid JSON\n');
    return 1;
  }

  if (manifest.schemaVersion !== 1) {
    process.stderr.write('pack-install: manifest schemaVersion must be 1\n');
    return 1;
  }

  if (!manifest.name || typeof manifest.name !== 'string') {
    process.stderr.write('pack-install: manifest name must be a non-empty string\n');
    return 1;
  }

  if (!manifest.version || typeof manifest.version !== 'string') {
    process.stderr.write('pack-install: manifest version must be a non-empty string\n');
    return 1;
  }

  if (!manifest.sha || typeof manifest.sha !== 'string' || !/^[0-9a-f]{40}$/.test(manifest.sha)) {
    process.stderr.write('pack-install: manifest sha must be 40 lowercase hex chars\n');
    return 1;
  }

  if (typeof manifest.dirty !== 'boolean') {
    process.stderr.write('pack-install: manifest dirty must be a boolean\n');
    return 1;
  }

  if (!Array.isArray(manifest.dirtyPaths) || manifest.dirtyPaths.some((path) => typeof path !== 'string') || (!manifest.dirty && manifest.dirtyPaths.length !== 0)) {
    process.stderr.write('pack-install: manifest dirtyPaths must be an empty array when dirty is false\n');
    return 1;
  }

  if (!manifest.integrity || typeof manifest.integrity !== 'string' || !manifest.integrity.startsWith('sha512-')) {
    process.stderr.write('pack-install: manifest integrity must start with sha512-\n');
    return 1;
  }

  if (!manifest.tarball || typeof manifest.tarball !== 'string' || !isAbsolute(manifest.tarball)) {
    process.stderr.write('pack-install: manifest tarball must be an absolute path\n');
    return 1;
  }

  const resolvedTarball = resolve(manifest.tarball);
  if (!existsSync(resolvedTarball)) {
    process.stderr.write(`pack-install: tarball does not exist: ${resolvedTarball}\n`);
    return 1;
  }

  let actualIntegrity;
  try {
    actualIntegrity = `sha512-${createHash('sha512').update(readFileSync(resolvedTarball)).digest('base64')}`;
  } catch (error) {
    process.stderr.write(`pack-install: tarball read failed (${error.code || 'unknown'})\n`);
    return 1;
  }
  if (actualIntegrity !== manifest.integrity) {
    process.stderr.write('pack-install: tarball does not match manifest integrity\n');
    return 1;
  }

  let pm = flags.pm;
  if (!pm) {
    try {
      pm = detectPackageManager(resolvedProjectDir, null);
    } catch (error) {
      process.stderr.write(`pack-install: ${error.message}\n`);
      return 1;
    }
  } else {
    if (pm !== 'npm' && pm !== 'pnpm') {
      process.stderr.write(`pack-install: Unsupported package manager: ${pm}\n`);
      return 1;
    }
  }

  try {
    execFileSync('which', [pm], { encoding: 'utf8' });
  } catch {
    process.stderr.write(`pack-install: ${pm} not found on PATH\n`);
    return 1;
  }

  const installResult = spawnSync(pm, pm === 'npm'
    ? ['install', '--save-dev', '--no-audit', '--no-fund', resolvedTarball]
    : ['add', '--save-dev', resolvedTarball], {
    cwd: resolvedProjectDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  forwardOutput(installResult);
  const installFailure = processFailure(installResult);
  if (installFailure !== null) {
    process.stderr.write(`pack-install: ${pm} install failed (${installFailure})\n`);
    return 1;
  }

  const binPath = join(resolvedProjectDir, 'node_modules', '.bin', 'ambercast');
  try {
    checkInstalledVersion(binPath, manifest.version);
  } catch (error) {
    process.stderr.write(`pack-install: ${binPath} ${error.message}\n`);
    return 1;
  }

  let integrityMatches;
  try {
    integrityMatches = lockfileHasIntegrity(resolvedProjectDir, pm, manifest.name, manifest.integrity);
  } catch (error) {
    process.stderr.write(`pack-install: lockfile read failed (${error.code || error.message})\n`);
    return 1;
  }
  if (!integrityMatches) {
    process.stderr.write('pack-install: installed package does not match the tarball\n');
    return 1;
  }

  const status = manifest.dirty ? 'dirty' : 'clean';
  process.stdout.write(`pack-install: OK ${manifest.name} v${manifest.version} from ${manifest.sha} (${status}) installed with ${pm} into ${resolvedProjectDir}\n`);

  return 0;
}

// Compare canonical paths: macOS can spell a temporary script's argv path
// under /var while import.meta.url resolves the same file under /private/var.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = await main(process.argv.slice(2));
}
