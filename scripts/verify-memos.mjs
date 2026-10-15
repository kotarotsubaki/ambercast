#!/usr/bin/env node
/**
 * verify-memos.mjs — CLI entry for the Memos verification harness
 *
 * Owns the process lifecycle: argv, signals, stage sequencing, final pass/fail reporting.
 * Delegates all mechanism to the library (memos-harness.mjs).
 */

import * as fs from 'node:fs';
import { realpathSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import {
  MEMOS_IMAGE, MEMOS_VERSION, HOST, PORT, ADMIN_USERNAME, TIMEOUTS, HarnessError,
  createExec, createDockerRunner, assertPortFree, createRunRoot, redact, buildChildEnv,
  generateAdminPassword, waitReady, bootstrapAdmin, secretEnvName, buildProjectPackageJson,
  summarizeAiCalls, createTeardown, reapStale, runProcess,
} from './lib/memos-harness.mjs';

const PROMPT = 'tests/ambercast/memos-sign-in-create-memo.test.md';
const PLAN = PROMPT.replace('.test.md', '.ambercast.plan.json');
const GROUNDING = PROMPT.replace('.test.md', '.ambercast.grounding.json');
const CONFIG = 'ambercast.config.json';
const FIXTURE_FILES = [CONFIG, PROMPT, PLAN, GROUNDING];
const REGENERATE = 'npm run verify:memos -- --regenerate (real AI provider, local only)';

/**
 * Parses verification, regeneration or cleanup options without resource creation.
 * @param argv - Arguments excluding the executable and script name.
 * @returns Options for manifest, allowDirty, keep, regenerate, ai and clean.
 * @throws A usage error for unknown/duplicate flags, missing values, positional
 * arguments, invalid providers or incompatible combinations. Cleanup is exclusive;
 * ai requires regenerate, and allowDirty cannot accompany an explicit manifest.
 * @remarks This is the sole owner of argument meaning; pack-install retains
 * responsibility for the tarball's dirty-state policy.
 */
export function parseArgs(argv) {
  const options = { manifest: undefined, ai: undefined, allowDirty: false, keep: false, regenerate: false, clean: false };
  const keys = { '--manifest': 'manifest', '--ai': 'ai', '--allow-dirty': 'allowDirty', '--keep': 'keep', '--regenerate': 'regenerate', '--clean': 'clean' };
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!Object.hasOwn(keys, flag) || seen.has(flag)) throw new Error(`invalid argument: ${flag}`);
    seen.add(flag);
    if (flag === '--manifest' || flag === '--ai') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`missing value: ${flag}`);
      options[keys[flag]] = value;
    } else options[keys[flag]] = true;
  }
  if ((options.clean && seen.size !== 1) || (options.ai && !options.regenerate)
    || (options.ai && !['claude', 'codex'].includes(options.ai)) || (options.allowDirty && options.manifest)) {
    throw new Error('incompatible arguments');
  }
  return options;
}

/**
 * Verifies a pinned Memos smoke replay, regenerates its fixture, or reaps stale resources.
 * @param argv - CLI arguments excluding the executable and script name.
 * @param platform - Host platform; Windows is rejected before parsing arguments.
 * @param deps - Injectable resource, filesystem, process, clock and output dependencies.
 * @param signals - SIGINT/SIGTERM event source, defaulting to process.
 * @returns Exit code 0 for success, 1 for verification/precondition failure, 2 for
 * usage/unsupported platform, 130 for SIGINT or 143 for SIGTERM; never calls process.exit.
 * @remarks Reject usage before side effects. Preflight orders daemon, fixture,
 * stale reaping, port, manifest, image and browser-version checks before creating
 * a run root or container. pack-install owns tarball identity and installation;
 * the isolated project probes its own Chromium before container startup.
 * A single step wrapper owns stage attribution and stage completion timing.
 * Capture the final ordinary replay JSON even on nonzero exit before judging its
 * failure; AI totals never come from generate or resolve. Every output string is
 * redacted, and the final verdict is emitted once, after cleanup/residual checks.
 * Cleanup mode emits only its cleaned-count line; usage/Windows emits no stdout.
 *
 * Register cleanup before ambiguous container creation and run it once with a
 * fresh signal/budget after child termination handling. --keep applies only to
 * nonsignal completion, reports only created resources, and stores credentials
 * privately; cleanup failures append to the original reason without hiding it.
 * Signal handlers bind their signal names separately. The first signal pins both
 * its exit code and the current stage; later signals do nothing, allowing teardown
 * to finish. Abort immediately except during SPEC-13's fixture-publication window.
 * There, record the signal, finish the in-flight rename, check interruption after
 * each rename and stop advancing, then abort outside the critical section.
 * Already published files are not rolled back and their names remain diagnostic evidence.
 *
 * Normal verification copies fixtures without modification and has no AI path.
 * Regeneration clears consent names, then runs generate before any password or
 * container exists (2026-10-11 revision) so consent's TTY check and redaction
 * never collide: generate inherits stdin/stderr and forwards only its captured
 * stdout to the harness sink. Only after generate validates exactly one
 * consented name does a password get generated and an instance start; resolve
 * then captures and redacts both of its streams, resets Memos and replays
 * without resolution. Every judge child gets an explicit mode after
 * parent-environment isolation: full for normal acceptance, disclosure-only
 * solely for a nonzero replay with an available report.
 * Only a successfully resolved full judge permits fixture publication under its
 * lock, in config/plan/grounding order via private temporary files and renames.
 * Partial publication names affected files and is recoverable by full regeneration;
 * a later ordinary check is not guaranteed to detect every partial combination.
 */
export async function main(argv, platform = process.platform, deps = createDeps(), signals = process) {
  if (platform === 'win32') {
    deps.stderr.write('verify-memos: Windows is not supported\n');
    return 2;
  }
  let options;
  try { options = parseArgs(argv); } catch {
    deps.stderr.write('verify-memos.mjs [--manifest <path>] [--allow-dirty] [--keep] [--regenerate [--ai claude|codex]] | --clean\n');
    return 2;
  }
  const abort = new AbortController();
  const td = createTeardown();
  let currentStage = 'preflight', signalStage, sigExit = null, publishing = false;
  let root, password, secretName, manifest, manifestPath, failure, containerRegistered = false;
  let aiCalls = 'n/a';
  const published = [];
  const fixture = join(deps.repoRoot, 'test/verification/memos/fixture');
  const lockPath = join(fixture, '.lock');
  const message = error => error instanceof Error ? error.message : String(error);
  const safe = text => password ? redact(String(text), password) : String(text);
  const out = text => deps.stdout.write(safe(text));
  const err = text => deps.stderr.write(safe(text));
  const interrupted = () => { if (sigExit !== null) throw new Error('interrupted'); };
  const handlers = Object.fromEntries(['SIGINT', 'SIGTERM'].map(name => [name, () => {
    if (sigExit !== null) return;
    sigExit = name === 'SIGINT' ? 130 : 143;
    signalStage = currentStage;
    if (!publishing) abort.abort();
  }]));
  for (const [name, handler] of Object.entries(handlers)) signals.on(name, handler);

  // One boundary assigns failures; explicit announce=false suppresses repeated
  // preflight substeps, while every other call -- including a stage name used
  // more than once, such as fixture's copy/generate/publish steps or
  // container/ready/bootstrap's two regenerate cycles -- prints its own ok line.
  async function step(stage, fn, announce = true, cleanup = false) {
    currentStage = stage;
    const start = deps.clock.now();
    try {
      if (!cleanup) interrupted();
      const value = await fn();
      if (!cleanup) interrupted();
      if (announce && !options.clean) {
        out(`verify-memos: ${stage} ok (${Math.max(0, Math.round(deps.clock.now() - start))} ms)\n`);
      }
      return value;
    } catch (error) {
      throw error instanceof HarnessError ? error : new HarnessError(stage, message(error));
    }
  }
  const dockerOptions = () => ({ signal: abort.signal, timeoutMs: TIMEOUTS.docker });
  const freshOptions = () => ({ signal: new AbortController().signal, timeoutMs: TIMEOUTS.docker });
  // The reaper owns discovery policy; this adapter supplies the active lifecycle budget.
  const staleRunner = Object.fromEntries(['listContainers', 'inspectCreated', 'removeContainer'].map(method =>
    [method, async (...args) => {
      interrupted();
      const value = await deps.runner[method](...args, dockerOptions());
      interrupted();
      return value;
    }]));
  async function child(command, args, cwd, timeoutMs, secrets = {}, extra = {}) {
    const result = await deps.runProcess(command, args, {
      cwd, env: buildChildEnv(process.env, secrets), timeoutMs, signal: abort.signal, ...extra,
    });
    if (extra.stdio !== 'generate' && extra.stdio !== 'resolve') {
      if (result.stdout) err(result.stdout);
      if (result.stderr) err(result.stderr);
    }
    interrupted();
    return result;
  }
  const exitReason = result => `exit=${result.status}${result.signal ? ` signal=${result.signal}` : ''}`;
  function requireSuccess(result, advice = '') {
    if (result.status !== 0) throw new Error(`${exitReason(result)}${result.stderr ? ` ${result.stderr}` : ''}${advice ? `; ${advice}` : ''}`);
  }
  // A disclosure-only judge failure is only a confirmed leak when the judge
  // child actually ran assertNoSecretDisclosure and found one
  // (`judgeSmokeReport: N violation(s)`). A storage read failure
  // (`judgeSmokeReport: cannot read ...`) or any other judge crash/timeout
  // before it ever reached that check is a failed inspection, not a
  // confirmed leak, and must not be reported as one.
  function classifyJudgeFailure(message) {
    if (/judgeSmokeReport: cannot read /.test(message)) return `judge inspection failed: ${message}`;
    if (/judgeSmokeReport: \d+ violation/.test(message)) return `secret disclosed: ${message}`;
    return `judge inspection failed: ${message}`;
  }
  function withLock(fn) {
    try { fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx', mode: 0o600 }); }
    catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      throw new Error(`fixture is locked by pid ${fs.readFileSync(lockPath, 'utf8')}`);
    }
    try { return fn(); } finally { fs.unlinkSync(lockPath); }
  }
  function readConsent() {
    const config = JSON.parse(fs.readFileSync(join(root.projectDir, CONFIG), 'utf8'));
    const allow = config.secrets?.allow;
    if (!Array.isArray(allow) || allow.length !== 1 || typeof allow[0] !== 'string' || !allow[0] || allow[0] === '*') {
      throw new Error('secrets.allow must contain exactly one non-wildcard name');
    }
    return allow[0];
  }
  const secrets = () => ({ [secretEnvName(secretName)]: password });
  const ambercast = () => join(root.projectDir, 'node_modules/.bin/ambercast');
  async function startInstance() {
    await step('container', async () => {
      if (!containerRegistered) {
        td.defer('container', () => deps.runner.removeContainer(root.containerName, freshOptions()));
        containerRegistered = true;
      }
      await deps.runner.startContainer({ runId: root.runId, name: root.containerName, data: root.dataDir,
        uid: deps.uid, gid: deps.gid }, dockerOptions());
    });
    await step('ready', () => waitReady({ fetch: deps.fetch, runner: deps.runner, name: root.containerName,
      clock: deps.clock, signal: abort.signal }));
    await step('bootstrap', () => bootstrapAdmin({ fetch: deps.fetch, password, signal: abort.signal }));
  }
  async function judge(mode) {
    const result = await child(join(deps.repoRoot, 'node_modules/.bin/vitest'),
      ['run', '--config', 'vitest.config.verification.ts', 'test/verification/memos/smoke-judge.verification.test.ts'],
      deps.repoRoot, TIMEOUTS.judge, {
        AMBERCAST_VERIFY_MEMOS_MODE: mode,
        AMBERCAST_VERIFY_MEMOS_REPORT: join(root.runRoot, 'report.json'),
        AMBERCAST_VERIFY_MEMOS_ARTIFACT_ROOTS: JSON.stringify([
          join(root.projectDir, 'tests/ambercast/.runs'), join(root.projectDir, PLAN), join(root.projectDir, GROUNDING),
        ]),
        AMBERCAST_VERIFY_MEMOS_SECRETS: JSON.stringify({ [secretName]: password }),
      });
    requireSuccess(result);
  }

  try {
    await step('preflight', () => deps.runner.checkDaemon(dockerOptions()), false);
    if (options.clean) {
      const counts = await step('preflight', () => reapStale({ runner: staleRunner, tmpRoot: deps.tmpRoot, lockPath }));
      out(`verify-memos: cleaned containers=${counts.containers} dirs=${counts.dirs}\n`);
    } else {
      await step('preflight', () => {
        for (const file of options.regenerate ? [CONFIG, PROMPT] : FIXTURE_FILES) {
          if (!fs.existsSync(join(fixture, file))) {
            throw new Error(`missing fixture ${file}; ${file === CONFIG || file === PROMPT
              ? 'git checkout -- test/verification/memos/fixture' : REGENERATE}`);
          }
        }
      }, false);
      await step('preflight', () => reapStale({ runner: staleRunner, tmpRoot: deps.tmpRoot, lockPath }), false);
      await step('port', () => deps.assertPortFree(PORT, HOST));
      await step('pack', async () => {
        if (options.manifest) manifestPath = resolve(process.cwd(), options.manifest);
        else {
          const result = await child('node', [join(deps.repoRoot, 'scripts/pack-install.mjs'), 'pack',
            ...(options.allowDirty ? ['--allow-dirty'] : [])], deps.repoRoot, TIMEOUTS.pack);
          requireSuccess(result);
          const lines = result.stdout.split(/\r?\n/).filter(line => line.startsWith('manifest: '));
          if (lines.length !== 1 || !lines[0].slice(10)) throw new Error('expected exactly one manifest: <path> line');
          manifestPath = lines[0].slice(10);
        }
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (typeof manifest?.sha !== 'string' || !manifest.sha) throw new Error('manifest.sha is missing');
      });
      let version;
      await step('preflight', async () => {
        if (!(await deps.runner.hasImage(MEMOS_IMAGE, dockerOptions()))) {
          interrupted();
          await deps.runner.pullImage(MEMOS_IMAGE, { ...dockerOptions(), timeoutMs: TIMEOUTS.pull });
        }
        interrupted();
        version = deps.readPlaywrightVersion();
        if (typeof version !== 'string' || !version.trim()) throw new Error('playwright-core version is empty');
      });
      await step('install', async () => {
        root = createRunRoot(deps.tmpRoot, deps.randomBytes);
        td.defer('runRoot', () => fs.rmSync(root.runRoot, { recursive: true, force: true }));
        fs.writeFileSync(join(root.projectDir, 'package.json'), JSON.stringify(buildProjectPackageJson(version), null, 2) + '\n');
        const result = await child('node', [join(deps.repoRoot, 'scripts/pack-install.mjs'), 'install', root.projectDir,
          '--manifest', manifestPath, '--pm', 'npm'], root.projectDir, TIMEOUTS.pack);
        requireSuccess(result);
      });
      await step('chromium', async () => {
        const result = await child('node', ['--input-type=module', '-e',
          "import { chromium } from 'playwright-core'; const browser = await chromium.launch({headless:true}); await browser.close();"],
        root.projectDir, 30000);
        requireSuccess(result, 'npx playwright-core install chromium');
      });
      await step('fixture', async () => {
        withLock(() => {
          for (const file of options.regenerate ? [CONFIG, PROMPT] : FIXTURE_FILES) {
            const destination = join(root.projectDir, file);
            fs.mkdirSync(dirname(destination), { recursive: true });
            fs.copyFileSync(join(fixture, file), destination);
          }
          if (options.regenerate) {
            const config = JSON.parse(fs.readFileSync(join(root.projectDir, CONFIG), 'utf8'));
            config.secrets = { ...config.secrets, allow: [] };
            fs.writeFileSync(join(root.projectDir, CONFIG), JSON.stringify(config, null, 2) + '\n');
          }
        });
        if (!options.regenerate) {
          secretName = readConsent();
          const result = await child(ambercast(), ['check', '--json'], root.projectDir, TIMEOUTS.replay);
          if (result.status !== 0) {
            let details = '';
            try {
              const rows = JSON.parse(result.stdout).results;
              details = rows.filter(row => !['fresh', 'fresh-without-grounding', 'listed', 'skipped'].includes(row.status))
                .map(row => `${row.status}${row.reason ? ` ${row.reason}` : ''}`).join('; ');
            } catch { /* Exit evidence remains authoritative when check has no usable rows. */ }
            throw new Error(`${exitReason(result)}${details ? ` ${details}` : ''}; ${REGENERATE}`);
          }
        }
      });
      if (options.regenerate) {
        // generate runs before any password or container exists (SPEC-13,
        // 2026-10-11 revision): consent needs a real stdin/stderr, and no
        // secret can leak through generate's output at this point.
        await step('fixture', async () => {
          const result = await child(ambercast(), ['generate', PROMPT, ...(options.ai ? ['--ai', options.ai] : [])],
            root.projectDir, TIMEOUTS.generate, {}, {
              stdio: 'generate', onStderrChunk: chunk => err(chunk),
            });
          requireSuccess(result);
          secretName = readConsent();
        });
      }
      password = generateAdminPassword(deps.randomBytes);
      await startInstance();
      if (options.regenerate) {
        await step('replay', async () => {
          const result = await child(ambercast(), ['run', '--resolve', '--update-cache', '--json', PROMPT,
            ...(options.ai ? ['--ai', options.ai] : [])], root.projectDir, TIMEOUTS.resolve, secrets(), {
              stdio: 'resolve', password, onStderrChunk: chunk => err(chunk),
            });
          requireSuccess(result);
          try { JSON.parse(result.stdout); } catch { throw new Error('non-json stdout'); }
          fs.writeFileSync(join(root.runRoot, 'resolve-report.json'), result.stdout);
          await deps.runner.removeContainer(root.containerName, dockerOptions());
          interrupted();
          // Deleting and immediately re-mounting the same host bind-mount
          // path races macOS/OrbStack's virtualized filesystem layer and can
          // crash Memos with SQLITE_CANTOPEN on restart, so this remounts on
          // a fresh path instead. Exclusive creation (no {recursive: true})
          // fails instead of silently reusing a leftover data-reset/ left by
          // an earlier, aborted reset.
          const resetDataDir = join(root.runRoot, 'data-reset');
          fs.mkdirSync(resetDataDir);
          fs.rmSync(root.dataDir, { recursive: true, force: true });
          root.dataDir = resetDataDir;
          interrupted();
        }, false);
        await startInstance();
      }
      await step('replay', async () => {
        const result = await child(ambercast(), ['run', '--json', '--no-color', PROMPT], root.projectDir, TIMEOUTS.replay, secrets());
        if (result.status === null) throw new Error(exitReason(result));
        let report;
        try { report = JSON.parse(result.stdout); } catch {
          aiCalls = 'unknown';
          throw new Error('non-json stdout');
        }
        try { aiCalls = summarizeAiCalls(report); } catch { aiCalls = 'unknown'; }
        fs.writeFileSync(join(root.runRoot, 'report.json'), result.stdout);
        if (result.status !== 0) {
          const first = Array.isArray(report?.errors) ? report.errors[0] : undefined;
          const row = Array.isArray(report?.results) ? report.results.find(row => row?.status !== 'passed') : undefined;
          let reason = `${exitReason(result)}${first?.code ? ` ${first.code}` : ''}${first?.message ? ` ${first.message}` : ''}${row?.status ? ` ${row.status}` : ''}`;
          if (result.status === 4) reason += `; ${REGENERATE}`;
          try { await judge('disclosure-only'); } catch (error) {
            interrupted();
            reason += `; ${classifyJudgeFailure(message(error))}`;
          }
          throw new Error(reason);
        }
      });
      await step('judge', () => judge('full'));
      if (options.regenerate) {
        await step('fixture', () => withLock(() => {
          const ownedTemps = new Set();
          publishing = true;
          try {
            for (const file of [CONFIG, PLAN, GROUNDING]) {
              const destination = join(fixture, file);
              const temporary = `${destination}.tmp-${root.runId}`;
              // Exclusive creation is the ownership proof for cleanup; foreign temps survive.
              const bytes = fs.readFileSync(join(root.projectDir, file));
              ownedTemps.add(temporary);
              try {
                fs.writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
              } catch (error) {
                if (error?.code === 'EEXIST') ownedTemps.delete(temporary);
                throw error;
              }
              fs.renameSync(temporary, destination);
              ownedTemps.delete(temporary);
              published.push(file);
              if (sigExit !== null) break;
            }
          } catch (error) {
            throw new Error(`${message(error)}; published files: ${published.join(', ') || 'none'}`);
          } finally {
            publishing = false;
            if (sigExit !== null) abort.abort();
            for (const temporary of ownedTemps) fs.rmSync(temporary, { force: true });
          }
        }));
      }
    }
  } catch (error) {
    failure = error instanceof HarnessError ? error : new HarnessError(currentStage, message(error));
    err(`${message(error)}\n`);
  }

  let teardownError;
  try {
    if (options.keep && sigExit === null && root) {
      if (password) fs.writeFileSync(join(root.runRoot, 'credentials.json'),
        JSON.stringify({ username: ADMIN_USERNAME, password }), { mode: 0o600 });
      if (containerRegistered) err(`container: ${root.containerName}\ndocker rm -f ${root.containerName}\n`);
      err(`runRoot: ${root.runRoot}\nrm -rf ${JSON.stringify(root.runRoot)}\n`);
    } else if (root) {
      await step('teardown', async () => {
        const cleanupError = await td.runAll();
        const residual = [];
        if (cleanupError) residual.push(cleanupError.message.replace(/^container: /, ''));
        try {
          if (containerRegistered && (await deps.runner.listContainers(freshOptions())).includes(root.containerName)) {
            if (!cleanupError) residual.push(`residual container ${root.containerName}`);
          }
        } catch (error) { residual.push(message(error)); }
        if (fs.existsSync(root.runRoot)) residual.push(`residual runRoot ${root.runRoot}`);
        if (residual.length) throw new Error(residual.join('; '));
      }, true, true);
    }
  } catch (error) { teardownError = error; }
  finally {
    for (const [name, handler] of Object.entries(handlers)) signals.off(name, handler);
  }
  if (sigExit !== null) {
    failure = new HarnessError(signalStage, 'interrupted');
    aiCalls = 'n/a';
  }
  if (teardownError) {
    if (failure) failure.message += `; teardown failed: ${message(teardownError)}`;
    else failure = new HarnessError('teardown', message(teardownError));
  }
  if (failure && published.length) failure.message += `; fixture updated: ${published.join(', ')}`;
  if (options.clean) {
    if (failure) err(`verify-memos: ${failure.message}\n`);
  } else if (failure) {
    const reason = safe(failure.message).replace(/[\u0000-\u001f\u007f]/g, char =>
      ({ '\n': '\\n', '\r': '\\r', '\t': '\\t' })[char] ?? `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`).slice(0, 400);
    out(`verify-memos: FAIL stage=${failure.stage} reason=${reason} aiCalls=${aiCalls}\n`);
  } else out(`verify-memos: PASS aiCalls=${aiCalls} sha=${manifest.sha.slice(0, 12)}${manifest.dirty ? '-dirty' : ''} memos=${MEMOS_VERSION}\n`);
  return sigExit ?? (failure ? 1 : 0);
}

/**
 * Supplies the production bindings consumed by main.
 * @returns The Docker runner, fetch, clock, process/port helpers, tmpRoot/repoRoot,
 * randomness, browser-version/path readers, host uid/gid and stdout/stderr sinks.
 * @remarks Keeping these bindings at the entry boundary lets lifecycle tests
 * inject failures and clocks without Docker, AI calls or real readiness waits.
 */
export function createDeps() {
  const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const require = createRequire(import.meta.url);
  return {
    runner: createDockerRunner(createExec()), fetch: globalThis.fetch, runProcess, assertPortFree,
    tmpRoot: tmpdir(), repoRoot, randomBytes, uid: process.getuid?.(), gid: process.getgid?.(),
    stdout: process.stdout, stderr: process.stderr,
    clock: { now: () => Date.now(), sleep: (ms, signal) => sleep(ms, undefined, { signal }) },
    readPlaywrightVersion: () => JSON.parse(fs.readFileSync(require.resolve('playwright-core/package.json'), 'utf8')).version,
    resolveChromiumPath: () => require('playwright-core').chromium.executablePath(),
  };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = await main(process.argv.slice(2));
}
