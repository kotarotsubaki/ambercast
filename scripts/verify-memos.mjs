#!/usr/bin/env node
/**
 * verify-memos.mjs — CLI entry for the Memos verification harness
 *
 * Owns the process lifecycle: argv, signals, stage sequencing, final pass/fail reporting.
 * Delegates all mechanism to the library (memos-harness.mjs).
 */

import * as fs from 'node:fs';
import { realpathSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import {
  MEMOS_IMAGE, MEMOS_VERSION, HOST, PORT, ADMIN_USERNAME, TIMEOUTS, HarnessError, TerminationUnconfirmedError,
  createExec, createDockerRunner, assertPortFree, createRunRoot, redact, buildChildEnv,
  generateAdminPassword, waitReady, bootstrapAdmin, secretEnvName, buildProjectPackageJson,
  summarizeAiCalls, createTeardown, reapStale, runProcess,
  signInAdmin, getGeneralSetting, patchAdditionalScript, HEAL_LABEL_SCRIPT,
} from './lib/memos-harness.mjs';

const CONFIG = 'ambercast.config.json';
/**
 * Explicit case membership and fixture paths derived from the same naming
 * convention make missing fixtures detectable instead of silently shrinking
 * coverage through automatic discovery.
 */
export const CASES = Object.freeze([
  { id: 'memos-sign-in-create-memo', target: 'memos' },
  { id: 'memos-edit-memo', target: 'memos' },
  { id: 'memos-delete-memo', target: 'memos' },
  { id: 'memos-search-memos', target: 'memos' },
  { id: 'memos-tag-filter', target: 'memos' },
  { id: 'memos-settings-dialog', target: 'memos-readonly' },
  { id: 'memos-ja-locale', target: 'memos-ja' },
]);
const HEAL_CASE = 'memos-settings-dialog';
/**
 * The settings-entry step identity comes from the generated plan, never a
 * handwritten guess. An undefined identity stops the heal check with an explicit
 * error before H3 can accept an unrelated grounding failure.
 */
export const HEAL_STEP_ID = undefined;
const prompt = id => `tests/ambercast/${id}.test.md`;
const plan = id => `tests/ambercast/${id}.ambercast.plan.json`;
const grounding = id => `tests/ambercast/${id}.ambercast.grounding.json`;
const FIXTURE_FILES = [CONFIG, ...CASES.flatMap(c => [prompt(c.id), plan(c.id), grounding(c.id)])];
const PUBLISH_FILES = [CONFIG, ...CASES.map(c => plan(c.id)), ...CASES.map(c => grounding(c.id))];
const REGENERATE = 'npm run verify:memos -- --regenerate (real AI provider, local only)';

/**
 * Checks the case inventory against the copied project configuration.
 * @param config - Configuration whose targets govern replay isolation.
 * @throws For duplicate ids, a missing HEAL_CASE or target, a heal target without
 * idempotent isolation, or another target declared idempotent; attributed to fixture.
 * @remarks The table is authoritative for membership; this defensive check runs
 * immediately after copying, before a container can start with unsafe isolation.
 */
function assertCaseTable(config) {
  const heal = CASES.find(c => c.id === HEAL_CASE);
  if (new Set(CASES.map(c => c.id)).size !== CASES.length || !heal
    || CASES.some(c => !Object.hasOwn(config.targets ?? {}, c.target))
    || config.targets[heal.target].healReplayIsolation !== 'idempotent'
    || Object.entries(config.targets).some(([name, target]) => name !== heal.target && target.healReplayIsolation === 'idempotent')) {
    throw new Error('invalid case table or replay isolation');
  }
}

/**
 * Checks that a heal plan retains the read-only case's credential-only input.
 * @param plan - Generated or repaired plan to inspect.
 * @param secretName - The single consented logical password name.
 * @throws For targets other than exactly memos-readonly or inputs other than
 * exactly one fill of verifier and one fill-secret referencing that secret.
 * @remarks Prompt and plan review own the read-only guarantee. This defensive
 * check protects both regeneration publication and H5 because repair regeneration
 * may select another target. The caller assigns fixture or heal attribution.
 */
function assertReadOnlyHealPlan(plan, secretName) {
  const steps = plan.steps ?? [];
  const declaredTargets = Object.keys(plan.targets ?? {});
  const targets = new Set(steps.map(step => step.target));
  const inputs = steps.filter(step => ['fill', 'fill-secret'].includes(step.action));
  if (declaredTargets.length !== 1 || declaredTargets[0] !== 'memos-readonly'
    || targets.size !== 1 || !targets.has('memos-readonly') || inputs.length !== 2
    || inputs.filter(step => step.action === 'fill' && step.value === ADMIN_USERNAME).length !== 1
    || inputs.filter(step => step.action === 'fill-secret' && step.secretRef === `{{secrets.${secretName}}}`).length !== 1) {
    throw new Error('plan is not read-only');
  }
}

/**
 * Parses verification, regeneration or cleanup options without resource creation.
 * @param argv - Arguments excluding the executable and script name.
 * @returns Validated options for verification, regeneration or cleanup.
 * @throws A usage error for unknown/duplicate flags, missing values, positional
 * arguments, invalid providers or incompatible combinations.
 * @remarks This is the sole owner of argument meaning; pack-install retains
 * responsibility for the tarball's dirty-state policy.
 */
export function parseArgs(argv) {
  const options = { manifest: undefined, ai: undefined, allowDirty: false, keep: false, regenerate: false, clean: false, healCheck: false, published: undefined };
  const keys = { '--manifest': 'manifest', '--ai': 'ai', '--allow-dirty': 'allowDirty', '--keep': 'keep', '--regenerate': 'regenerate', '--clean': 'clean', '--heal-check': 'healCheck', '--published': 'published' };
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!Object.hasOwn(keys, flag) || seen.has(flag)) throw new Error(`invalid argument: ${flag}`);
    seen.add(flag);
    if (['--manifest', '--ai', '--published'].includes(flag)) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`missing value: ${flag}`);
      options[keys[flag]] = value;
    } else options[keys[flag]] = true;
  }
  if ((options.clean && seen.size !== 1) || (options.ai && !options.regenerate)
    || (options.ai && !['claude', 'codex'].includes(options.ai)) || (options.allowDirty && options.manifest)
    || (options.healCheck && options.regenerate)
    || (options.published && (options.manifest || options.allowDirty || options.regenerate
      || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?$/.test(options.published)))) {
    throw new Error('incompatible arguments');
  }
  return options;
}

/**
 * Verifies a pinned Memos smoke replay, regenerates its fixture, or reaps stale resources.
 * @param argv - CLI arguments excluding the executable and script name.
 * @param platform - Host platform; Windows is rejected before parsing arguments.
 * @param deps - Injectable resource, filesystem, process, clock and output dependencies;
 * healStepId may supply the generated settings-entry identity for a fake replay.
 * @param signals - SIGINT/SIGTERM event source, defaulting to process.
 * @returns Exit code 0 for success, 1 for verification/precondition failure, 2 for
 * usage/unsupported platform, 130 for SIGINT or 143 for SIGTERM; never calls process.exit.
 * @remarks The harness owns lifecycle and stage attribution; pack-install owns
 * package identity and installation, and the judge owns report schema acceptance,
 * diagnosability and disclosure checks. Replay alone supplies the acceptance AI
 * count; generation, resolution and repair have separate accounting.
 *
 * Cleanup is registered before ambiguous resource creation and uses independent
 * cancellation so interruption cannot prevent teardown. The first signal pins
 * its exit and stage; later signals cannot disrupt recovery. Publication is a
 * synchronous critical section, so interruption waits for it to finish and
 * preserves evidence of any published files. Unconfirmed child termination
 * prevents further verification and publication; process identities survive
 * aggregation and truncation so manual recovery remains possible.
 *
 * Regeneration preserves the consent scope before credentials or containers
 * exist. The generator prefers existing names but does not enforce them; refuse
 * consent to any alternative name and fail if that scope changes. Inherited
 * terminal streams preserve interactive consent, while resolution captures and
 * redacts output once credentials exist. Successful acceptance gates publication;
 * partial publication requires full regeneration.
 *
 * Fixture copying and retention of the original heal plan/cache share one lock,
 * making the retained bytes the restoration authority even if fixtures change
 * later. Cases share a sequential run; acceptance does not establish independent
 * execution of every case.
 *
 * Heal relies on the declared read-only target's idempotent isolation, never a
 * runtime config rewrite. The expected binding miss must identify the intended
 * case and step, preventing unrelated failures from masquerading as repair
 * evidence. Preview must preserve artifacts, application must change them, and
 * replay must establish both repair and reversibility. Reports supplement child
 * success rather than replace it; only the deliberate binding miss accepts
 * failure. The judge owns report validity; the harness owns protocol outcomes
 * and the defensive read-only plan check, without inspecting grounding internals.
 *
 * A settings PATCH can succeed despite a lost response, so restoration becomes
 * mandatory as soon as mutation starts. Restoration is attempted once with fresh
 * cancellation and credentials, using the settings snapshot as its authority.
 * Interruption permits restoration to finish but prevents further verification.
 * Failed restoration overrides resource retention to avoid leaving the injected
 * script active. Its evidence survives interruption and diagnostic truncation.
 * Tokens remain in memory and participate in redaction; disclosure checks still
 * use the password. Saved repair reports join replay artifacts in disclosure
 * scans so repair output cannot escape the acceptance boundary.
 *
 * Explicit targets prevent ambiguous assignment during regeneration. Prompts
 * remain authoritative and are never replaced by generated artifacts. Published
 * verification installs the requested package directly; availability failures
 * remain visible to the caller rather than triggering implicit retries.
 * Executing a fresh dependency graph requires direct maintainer authorization
 * for the manifests, command, and install-script, network and filesystem effects.
 */
export async function main(argv, platform = process.platform, deps = createDeps(), signals = process) {
  if (platform === 'win32') {
    deps.stderr.write('verify-memos: Windows is not supported\n');
    return 2;
  }
  let options;
  try { options = parseArgs(argv); } catch {
    deps.stderr.write('verify-memos.mjs [--manifest <path> | --published <version>] [--allow-dirty] [--keep] [--heal-check] [--regenerate [--ai claude|codex]] | --clean\n');
    return 2;
  }
  const abort = new AbortController();
  const td = createTeardown();
  let currentStage = 'preflight', signalStage, sigExit = null, publishing = false, publishAttempted = false;
  let root, password, secretName, manifest, manifestPath, failure, containerRegistered = false;
  let aiCalls = 'n/a';
  let token, snapshot, originalHealFiles, restoreNeeded = false, restoreAttempted = false, restoreFailed;
  const tokens = new Set();
  let healAiCalls = 0;
  const allPrompts = CASES.map(c => prompt(c.id));
  const copyFiles = options.regenerate ? [CONFIG, ...allPrompts] : FIXTURE_FILES;
  const published = [];
  const unconfirmed = new Map(); // pgid -> { stage } for first-stage evidence
  /**
   * Verifies repair and reversibility after ordinary acceptance.
   * @remarks Restoration is the only operation allowed to continue after failure;
   * a plausible report cannot override child failure. Judge errors retain their
   * heal context so diagnostics identify both the protocol and the failed check.
   */
  async function healCheck() {
    if (!(deps.healStepId ?? HEAL_STEP_ID)) throw new Error('HEAL_STEP_ID is undefined; regenerate the heal plan and set its settings-entry step id');
    const paths = [plan(HEAL_CASE), grounding(HEAL_CASE)].map(file => join(root.projectDir, file));
    const hashes = () => paths.map(file => createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
    const api = { fetch: deps.fetch, baseUrl: `http://${HOST}:${PORT}`, password, username: ADMIN_USERNAME, signal: abort.signal };
    const healArtifacts = () => [join(root.projectDir, 'tests/ambercast/.runs'), ...paths,
      ...['heal-dry-run.json', 'heal-apply.json', 'heal-broken-report.json'].map(file => join(root.runRoot, file))];
    async function judged(mode, reportFile) {
      try { await judge(mode, { expectedCases: 1, reportFile, artifactRoots: healArtifacts() }); }
      catch (error) { noteUnconfirmed(error); throw new Error(`judge: ${message(error)}`); }
    }
    async function replay(file) {
      const result = await child(ambercast(), ['run', '--json', '--no-color', prompt(HEAL_CASE)], root.projectDir, TIMEOUTS.replay, secrets());
      captureReplay(result, file);
      requireSuccess(result);
      await judged('full', file);
    }
    try {
      token = await signInAdmin(api);
      tokens.add(token);
      snapshot = await getGeneralSetting({ ...api, token });
      restoreNeeded = true;
      await patchAdditionalScript({ ...api, token, value: HEAL_LABEL_SCRIPT });
      await replayExpectingMiss();
      for (const apply of [false, true]) {
        const before = hashes();
        const file = apply ? 'heal-apply.json' : 'heal-dry-run.json';
        const result = await child(ambercast(), ['heal', apply ? '--yes' : '--dry-run', '--json', '--no-color', '--ai', 'claude', prompt(HEAL_CASE)],
          root.projectDir, TIMEOUTS.heal, secrets());
        fs.writeFileSync(join(root.runRoot, file), result.stdout);
        let report;
        try { report = JSON.parse(result.stdout); } catch { throw new Error('non-json stdout'); }
        await judged('heal-report', file);
        requireSuccess(result);
        const rows = report.results;
        if (!Array.isArray(rows) || rows.length !== 1 || rows[0].status !== 'completed'
          || rows[0].file !== prompt(HEAL_CASE) || rows[0].repairOutcome !== 'healed'
          || rows[0].application !== (apply ? 'applied' : 'preview-only')) throw new Error('unexpected heal outcome or application');
        healAiCalls = healAiCalls === 'unknown' || typeof rows[0].aiCalls !== 'number' ? 'unknown' : healAiCalls + rows[0].aiCalls;
        const unchanged = isDeepStrictEqual(before, hashes());
        if (apply ? unchanged : !unchanged) throw new Error(apply ? 'heal did not change plan or grounding' : 'dry-run changed plan or grounding');
        if (apply) {
          try { assertReadOnlyHealPlan(JSON.parse(fs.readFileSync(paths[0], 'utf8')), secretName); }
          catch { throw new Error('repaired plan is not read-only'); }
        }
      }
      await replay('heal-report.json');
      await restore(new AbortController().signal);
      interrupted();
      if (restoreFailed) throw new Error('restoration failed');
      paths.forEach((file, i) => fs.writeFileSync(file, originalHealFiles[i]));
      await replay('restore-report.json');
    } finally {
      if (restoreNeeded && !restoreAttempted) await restore(new AbortController().signal);
    }
  }
  /**
   * Attempts H7 once with fresh cancellation and credentials even after failure.
   * @param freshSignal - A signal independent of the interrupted verification.
   * @remarks Mark the attempt before awaiting, preserving ambiguous-failure
   * evidence and preventing finally and signal cleanup from restoring twice.
   */
  async function restore(freshSignal) {
    if (!restoreNeeded || restoreAttempted) return;
    restoreAttempted = true;
    try {
      const api = { fetch: deps.fetch, baseUrl: `http://${HOST}:${PORT}`, password, username: ADMIN_USERNAME, signal: freshSignal };
      token = await signInAdmin(api);
      tokens.add(token);
      await patchAdditionalScript({ ...api, token, value: snapshot.generalSetting?.additionalScript ?? '' });
      const restored = await getGeneralSetting({ ...api, token });
      const normalize = setting => ({ ...setting, generalSetting: { ...setting.generalSetting, additionalScript: setting.generalSetting?.additionalScript ?? '' } });
      if (!isDeepStrictEqual(normalize(snapshot), normalize(restored))) throw new Error('restored settings differ from snapshot');
    } catch (error) { restoreFailed = message(error); }
  }
  /**
   * Proves the label change broke the intended binding.
   * @remarks The ordinary replay wrapper recommends regeneration on failure,
   * which would conceal the deliberate binding miss here. Matching the case and
   * step prevents an unrelated failure from satisfying the repair precondition.
   */
  async function replayExpectingMiss() {
    const result = await child(ambercast(), ['run', '--json', '--no-color', prompt(HEAL_CASE)], root.projectDir, TIMEOUTS.replay, secrets());
    const report = captureReplay(result, 'heal-broken-report.json');
    if (result.status === 0) throw new Error('label change did not break the heal case');
    if (result.status !== 4) throw new Error(`unexpected exit=${result.status}`);
    if (aiCalls !== 0) throw new Error('expected zero aiCalls');
    if (report.results?.length !== 1 || !report.errors?.some(error => error.code === 'GROUNDING_UNRESOLVED'
      && error.scope === 'case' && error.caseId === report.results[0].id && error.details?.stepId === (deps.healStepId ?? HEAL_STEP_ID))) {
      throw new Error(`unexpected failure: ${report.errors?.[0]?.code}`);
    }
  }
  function captureReplay(result, file) {
    fs.writeFileSync(join(root.runRoot, file), result.stdout);
    let report;
    try { report = JSON.parse(result.stdout); } catch { aiCalls = 'unknown'; throw new Error('non-json stdout'); }
    try { aiCalls = summarizeAiCalls(report); } catch { aiCalls = 'unknown'; }
    return report;
  }
  function noteUnconfirmed(error) {
    if (error instanceof TerminationUnconfirmedError && !unconfirmed.has(error.pgid)) {
      unconfirmed.set(error.pgid, { stage: currentStage });
    }
  }
  const fixture = join(deps.repoRoot, 'test/verification/memos/fixture');
  const lockPath = join(fixture, '.lock');
  const message = error => error instanceof Error ? error.message : String(error);
  const safe = text => redact(String(text), password, ...tokens);
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

  // A shared boundary keeps failure attribution consistent across lifecycle stages.
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
      noteUnconfirmed(error);
      const wrapped = error instanceof HarnessError ? error : new HarnessError(stage, message(error));
      if (error instanceof TerminationUnconfirmedError) wrapped.pgid = error.pgid;
      throw wrapped;
    }
  }
  const dockerOptions = () => ({ signal: abort.signal, timeoutMs: TIMEOUTS.docker });
  const freshOptions = () => ({ signal: new AbortController().signal, timeoutMs: TIMEOUTS.docker });
  // The reaper owns discovery policy; this adapter supplies the active lifecycle budget.
  const staleRunner = Object.fromEntries(['listContainers', 'inspectCreated', 'removeContainer'].map(method =>
    [method, async (...args) => {
      interrupted();
      let value;
      try { value = await deps.runner[method](...args, dockerOptions()); }
      catch (error) { noteUnconfirmed(error); throw error; }
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
    if (result.termination === 'unconfirmed') {
      // Forwarding flushes the cross-stream redaction queue before resolution;
      // replaying raw stream-local captures can disclose previously hidden fragments.
      const error = new TerminationUnconfirmedError(result.pgid);
      noteUnconfirmed(error);
      throw error;
    }
    interrupted();
    return result;
  }
  const exitReason = result => `exit=${result.status}${result.signal ? ` signal=${result.signal}` : ''}`;
  function requireSuccess(result, advice = '') {
    if (result.status !== 0) throw new Error(`${exitReason(result)}${result.stderr ? ` ${result.stderr}` : ''}${advice ? `; ${advice}` : ''}`);
  }
  // Only a completed disclosure assertion establishes a leak; inspection failures
  // preserve uncertainty instead of incorrectly reporting confirmed disclosure.
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
        // Aggregation must not erase process identity needed by signal reporting.
        td.defer('container', async () => {
          try { await deps.runner.removeContainer(root.containerName, freshOptions()); }
          catch (error) { noteUnconfirmed(error); throw error; }
        });
        containerRegistered = true;
      }
      await deps.runner.startContainer({ runId: root.runId, name: root.containerName, data: root.dataDir,
        uid: deps.uid, gid: deps.gid }, dockerOptions());
    });
    await step('ready', () => waitReady({ fetch: deps.fetch, runner: deps.runner, name: root.containerName,
      clock: deps.clock, signal: abort.signal }));
    await step('bootstrap', () => bootstrapAdmin({ fetch: deps.fetch, password, signal: abort.signal }));
  }
  async function judge(mode, { expectedCases = CASES.length, reportFile = 'report.json', artifactRoots } = {}) {
    const result = await child(join(deps.repoRoot, 'node_modules/.bin/vitest'),
      ['run', '--config', 'vitest.config.verification.ts', 'test/verification/memos/smoke-judge.verification.test.ts'],
      deps.repoRoot, TIMEOUTS.judge, {
        AMBERCAST_VERIFY_MEMOS_MODE: mode,
        AMBERCAST_VERIFY_MEMOS_REPORT: join(root.runRoot, reportFile),
        AMBERCAST_VERIFY_MEMOS_EXPECTED_CASES: String(expectedCases),
        AMBERCAST_VERIFY_MEMOS_ARTIFACT_ROOTS: JSON.stringify(artifactRoots ?? [
          join(root.projectDir, 'tests/ambercast/.runs'), ...CASES.map(c => join(root.projectDir, plan(c.id))), ...CASES.map(c => join(root.projectDir, grounding(c.id))),
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
        for (const file of copyFiles) {
          if (!fs.existsSync(join(fixture, file))) {
            throw new Error(`missing fixture ${file}; ${file === CONFIG || allPrompts.includes(file)
              ? 'git checkout -- test/verification/memos/fixture' : REGENERATE}`);
          }
        }
      }, false);
      await step('preflight', () => reapStale({ runner: staleRunner, tmpRoot: deps.tmpRoot, lockPath }), false);
      await step('port', () => deps.assertPortFree(PORT, HOST));
      if (!options.published) await step('pack', async () => {
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
        if (options.published) {
          const result = await child('npm', ['install', '--save-dev', '--no-audit', '--no-fund', `ambercast@${options.published}`], root.projectDir, TIMEOUTS.pack);
          requireSuccess(result, 'the published package may not be available yet; rerun later');
          const installed = JSON.parse(fs.readFileSync(join(root.projectDir, 'node_modules/ambercast/package.json'), 'utf8'));
          if (installed.version !== options.published) throw new Error(`installed version ${installed.version} does not match ${options.published}`);
        } else {
          const result = await child('node', [join(deps.repoRoot, 'scripts/pack-install.mjs'), 'install', root.projectDir,
            '--manifest', manifestPath, '--pm', 'npm'], root.projectDir, TIMEOUTS.pack);
          requireSuccess(result);
        }
      });
      await step('chromium', async () => {
        const result = await child('node', ['--input-type=module', '-e',
          "import { chromium } from 'playwright-core'; const browser = await chromium.launch({headless:true}); await browser.close();"],
        root.projectDir, 30000);
        requireSuccess(result, 'npx playwright-core install chromium');
      });
      await step('fixture', async () => {
        withLock(() => {
          for (const file of copyFiles) {
            const destination = join(root.projectDir, file);
            fs.mkdirSync(dirname(destination), { recursive: true });
            fs.copyFileSync(join(fixture, file), destination);
          }
          assertCaseTable(JSON.parse(fs.readFileSync(join(root.projectDir, CONFIG), 'utf8')));
          if (options.healCheck) originalHealFiles = [plan(HEAL_CASE), grounding(HEAL_CASE)].map(file => fs.readFileSync(join(root.projectDir, file)));
        });
        secretName = readConsent();
        if (!options.regenerate) {
          const result = await child(ambercast(), ['check', '--json', ...allPrompts], root.projectDir, TIMEOUTS.replay);
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
        // generate runs before any password or container exists:
        // consent needs a real stdin/stderr, and no
        // secret can leak through generate's output at this point.
        for (const target of new Set(CASES.map(c => c.target))) await step('fixture', async () => {
          const selected = CASES.filter(c => c.target === target).map(c => prompt(c.id));
          const result = await child(ambercast(), ['generate', '--target', target, ...selected, ...(options.ai ? ['--ai', options.ai] : [])],
            root.projectDir, TIMEOUTS.generate * selected.length, {}, {
              stdio: 'generate', onStderrChunk: chunk => err(chunk),
            });
          requireSuccess(result);
        });
        if (readConsent() !== secretName) throw new Error('secrets.allow must retain the committed consent name');
      }
      password = generateAdminPassword(deps.randomBytes);
      await startInstance();
      if (options.regenerate) {
        await step('replay', async () => {
          const result = await child(ambercast(), ['run', '--resolve', '--update-cache', '--json', ...allPrompts,
            ...(options.ai ? ['--ai', options.ai] : [])], root.projectDir, TIMEOUTS.resolve * CASES.length, secrets(), {
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
        const result = await child(ambercast(), ['run', '--json', '--no-color', ...allPrompts], root.projectDir, TIMEOUTS.replay * CASES.length, secrets());
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
          if (row?.id) reason += ` ${row.id}`;
          if (result.status === 4) reason += `; ${REGENERATE}`;
          try { await judge('disclosure-only'); } catch (error) {
            noteUnconfirmed(error);
            if (error instanceof TerminationUnconfirmedError) {
              reason += `; process group ${error.pgid} not confirmed terminated`;
            } else {
              reason += `; ${classifyJudgeFailure(message(error))}`;
            }
          }
          throw new Error(reason);
        }
      });
      await step('judge', () => judge('full'));
      if (options.healCheck) await step('heal', healCheck);
      if (options.regenerate) {
        await step('fixture', () => assertReadOnlyHealPlan(JSON.parse(fs.readFileSync(join(root.projectDir, plan(HEAL_CASE)), 'utf8')), secretName), false);
        publishAttempted = true;
        await step('fixture', () => withLock(() => {
          const ownedTemps = new Set();
          publishing = true;
          try {
            for (const file of PUBLISH_FILES) {
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
            }
          } catch (error) {
            // Keep publication evidence separate so later cleanup diagnostics
            // consume the body budget rather than extending a protected list.
            const failure = new HarnessError('fixture', message(error));
            failure.publishedFiles = [...published];
            throw failure;
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
  // A poll-phase signal can arrive after the first check phase. Keep handlers
  // installed through a second turn before deciding whether resources survive.
  if (publishAttempted) {
    await new Promise(resolve => setImmediate(() => setImmediate(resolve)));
  }
  try {
    if (options.keep && !restoreFailed && sigExit === null && root) {
      if (password) fs.writeFileSync(join(root.runRoot, 'credentials.json'),
        JSON.stringify({ username: ADMIN_USERNAME, password }), { mode: 0o600 });
      if (containerRegistered) err(`container: ${root.containerName}\ndocker rm -f ${root.containerName}\n`);
      err(`runRoot: ${root.runRoot}\nrm -rf ${JSON.stringify(root.runRoot)}\n`);
      for (const [pgid] of unconfirmed) {
        err(`process group ${pgid} not confirmed terminated; kill -9 -${pgid}\n`);
      }
    } else if (root) {
      await step('teardown', async () => {
        const cleanupError = await td.runAll();
        const residual = [];
        if (cleanupError) residual.push(cleanupError.message.replace(/^container: /, ''));
        try {
          if (containerRegistered && (await deps.runner.listContainers(freshOptions())).includes(root.containerName)) {
            if (!cleanupError) residual.push(`residual container ${root.containerName}`);
          }
        } catch (error) {
          noteUnconfirmed(error);
          if (!residual.some(reason => reason.includes(message(error)))) residual.push(message(error));
        }
        if (fs.existsSync(root.runRoot)) residual.push(`residual runRoot ${root.runRoot}`);
        if (residual.length) throw new Error(residual.join('; '));
      }, true, true);
    }
  } catch (error) { teardownError = error; }
  finally {
    for (const [name, handler] of Object.entries(handlers)) signals.off(name, handler);
  }
  function formatReason(body, tail = '') {
    const sanitize = text => safe(text).replace(/[\u0000-\u001f\u007f]/g, char =>
      ({ '\n': '\\n', '\r': '\\r', '\t': '\\t' })[char] ?? `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
    const safeTail = sanitize(tail);
    // Reserve identity evidence independently of ordinary diagnostics, preserving
    // its position in short reasons and its presence after long reasons are cut.
    const identities = new Set([...unconfirmed.keys()].map(pgid => `process group ${pgid} not confirmed terminated`));
    const parts = sanitize(body).split(/(process group \d+ not confirmed terminated)/g);
    let budget = Math.max(0, 400 - safeTail.length - parts.filter(part => identities.has(part)).join('').length);
    return parts.map(part => {
      if (identities.has(part)) return part;
      const prefix = part.slice(0, budget);
      budget -= prefix.length;
      return prefix;
    }).join('') + safeTail;
  }
  if (sigExit !== null) {
    // Interruption replaces verification failure, but preserves ordinary cleanup
    // evidence. Final assembly renders each recorded pgid only if its exact
    // message is absent, including messages already in the cleanup aggregate.
    failure = new HarnessError(signalStage, 'interrupted');
    aiCalls = 'n/a';
  }
  if (teardownError) {
    const publishedFiles = failure?.publishedFiles;
    failure = failure
      ? new HarnessError(failure.stage, `${message(failure)}; teardown failed: ${message(teardownError)}`)
      : teardownError;
    if (publishedFiles) failure.publishedFiles = publishedFiles;
  }
  for (const [pgid, { stage }] of unconfirmed) {
    const text = `process group ${pgid} not confirmed terminated`;
    if (!failure) failure = new HarnessError(stage, text);
    else if (!message(failure).includes(text)) {
      failure.message += `; teardown failed: ${text}`;
    }
  }
  if (failure) {
    const reasonBody = message(failure);
    const tail = (failure.publishedFiles ? `; published files: ${failure.publishedFiles.length} of ${PUBLISH_FILES.length}` : '')
      + (published.length ? `; fixture updated: ${published.length} of ${PUBLISH_FILES.length}` : '')
      + (restoreFailed ? `; restore failed: ${safe(restoreFailed).slice(0, 120)}` : '')
      + (restoreFailed && options.keep ? '; --keep not honored: restore failed' : '');
    const reason = formatReason(reasonBody, tail);
    if (publishAttempted) err(`verify-memos: published files: ${published.join(', ') || 'none'}\n`);
    if (options.clean) err(`verify-memos: FAIL stage=${failure.stage} reason=${reason} aiCalls=${aiCalls}\n`);
    else out(`verify-memos: FAIL stage=${failure.stage} reason=${reason} aiCalls=${aiCalls}\n`);
    return sigExit ?? 1;
  }
  if (publishAttempted) err(`verify-memos: published files: ${published.join(', ') || 'none'}\n`);
  if (!options.clean) out(`verify-memos: PASS aiCalls=${aiCalls} ${options.published ? `package=ambercast@${options.published}` : `sha=${manifest.sha.slice(0, 12)}${manifest.dirty ? '-dirty' : ''}`} memos=${MEMOS_VERSION}${options.healCheck ? ` heal=healed healAiCalls=${healAiCalls}` : ''}\n`);
  return 0;
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
