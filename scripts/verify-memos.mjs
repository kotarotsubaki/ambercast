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
 * @returns Options for manifest, allowDirty, keep, regenerate, ai and clean,
 * plus healCheck (false by default) and
 * published (undefined by default, otherwise an exact npm version).
 * @throws A usage error for unknown/duplicate flags, missing values, positional
 * arguments, invalid providers or incompatible combinations. Cleanup is exclusive;
 * ai requires regenerate, and allowDirty cannot accompany an explicit manifest.
 * @remarks This is the sole owner of argument meaning; pack-install retains
 * responsibility for the tarball's dirty-state policy.
 * --published excludes manifest, allowDirty, regenerate and clean, while
 * allowing keep and healCheck. --heal-check excludes regenerate and clean;
 * clean remains exclusive. Published versions accept semver core and prerelease,
 * rejecting numeric leading zeros, build metadata, ranges, tags and empty values.
 * Argument validation remains side-effect free and reports usage with exit 2.
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
 * to finish. Abort is deferred until after publication completes or fails; the
 * synchronous critical section always finishes. Two setImmediate turns allow
 * real signal delivery before cleanup decisions; injected emits complete publication and
 * then abort. Already published files are not rolled back and their names remain
 * diagnostic evidence.
 *
 * Unconfirmed termination stops verification and publication. The detecting
 * step assigns its stage without losing an earlier failure reason. A pgid
 * list preserves evidence before errors become strings or interruption masks
 * them; repeated catches of one pgid do not duplicate it. Teardown still
 * attempts every cleanup with fresh bounded Docker budgets. Teardown failures
 * append to an earlier failure. Signals retain their original stage,
 * exit 130/143 and aiCalls=n/a, with reason interrupted followed by a teardown
 * failure entry for each recorded pgid. Nonsignal --keep fails and
 * prints each unconfirmed group with its manual kill -9 -<pgid> command.
 * A disclosure-only judge's unconfirmed termination appends directly to the
 * replay reason, bypassing the judge classifier; other judge errors retain it.
 * Final assembly renders each recorded pgid only when its exact message is
 * absent from the assembled reason, including cleanup aggregates.
 * Final reason formatting redacts and escapes error text and publication
 * lists separately, reserves space for process identities and both publication
 * lists, and caps ordinary error text within the overall 400-character budget.
 *
 * Normal verification copies fixtures without modification and has no AI path.
 * Regeneration preserves committed consent names and runs generate before any
 * password or container exists. The generator prefers existing names but does
 * not enforce them; refuse any request to consent to another name and fail
 * generation to keep the consent scope unchanged. Consent's TTY check and redaction
 * never collide: generate inherits stdin/stderr and forwards only its captured
 * stdout to the harness sink. The config must contain exactly one non-wildcard
 * name before generation and retain that name afterward. Only then does a
 * password get generated and an instance start; resolve
 * then captures and redacts both of its streams, resets Memos and replays
 * without resolution. Every judge child gets an explicit mode after
 * parent-environment isolation: full for normal acceptance, disclosure-only
 * solely for a nonzero replay with an available report.
 * Only a successfully resolved full judge permits fixture publication under its
 * lock, in config/plan/grounding order via private temporary files and renames.
 * Partial publication names affected files and is recoverable by full regeneration;
 * a later ordinary check is not guaranteed to detect every partial combination.
 *
 * Fixture copying and retention of the heal case's original plan/cache share
 * one lock, preventing restoration from reading a different fixture generation.
 * Cases share a sequential run; acceptance of that run does not establish that
 * every case passes individually.
 *
 * After ordinary replay and judge succeed, --heal-check enters one heal
 * stage for H1 through H8. H1 signs in and snapshots GENERAL. H2 installs the
 * narrowly scoped label script. H3 uses replayExpectingMiss to prove exit 4 is a
 * zero-AI, single-case GROUNDING_UNRESOLVED at HEAL_STEP_ID, rather than accepting
 * an unrelated stale plan or a label change that did nothing. H4 previews heal
 * with --dry-run and verifies unchanged SHA-256 plan/cache hashes; H5 applies
 * with --yes, requires at least one changed hash and checks the repaired plan's
 * read-only contract. Both heals use --json --no-color --ai claude, require one
 * completed row for the exact prompt with repairOutcome healed and respectively
 * preview-only/applied, and run the heal-report judge before outcome checks.
 * Neither is retried. H6 replays without resolution and judges one zero-AI case.
 * H7 restores settings. H8 restores project plan/cache from the retained bytes,
 * then repeats the one-case zero-AI replay and judge to prove reversibility.
 * H4, H5, H6 and H8 require both child exit 0 and their report conditions; H3
 * alone expects exit 4 and is the only path that accepts a nonzero child exit
 * as success. The first failure in any step stops all later steps, except that
 * required H7 restoration is attempted exactly once. A failed H7 never proceeds
 * to H8. Judge failures in H6/H8 and heal-report judge failures after H4/H5 keep
 * stage=heal and begin their reason with 'judge:'.
 * No runtime config rewrite or healed-fixture publication
 * is permitted: idempotent isolation belongs to the declared read-only target.
 *
 * H2 marks restoreNeeded immediately before fetch starts, since a lost
 * response cannot prove the mutation did not happen. restoreAttempted guarantees
 * one H7 attempt across finally, signals and --keep. H7 uses a fresh signal with
 * request timeouts and a new sign-in token, patches the snapshot script, then
 * checks deep JSON equality with missing additionalScript normalized to "".
 * A failed restoration preserves the original failure; --keep then yields to
 * teardown and adds '; --keep not honored: restore failed', preventing a retained
 * instance from serving the label script. Signals still exit 130/143 after
 * restoration and teardown. Heal children share replay's isolated secret env;
 * TIMEOUTS.heal allows 900,000 ms per heal and the three replays each get 120,000.
 *
 * Heal stdout and the three replay reports are saved as heal-dry-run.json,
 * heal-apply.json, heal-broken-report.json, heal-report.json and restore-report.json
 * under runRoot. H6/H8 disclosure scans also include both heal reports and the
 * broken replay report. The heal-report judge owns schema acceptance,
 * diagnosability and report disclosure; the harness does not invent schema-version
 * checks or inspect repaired grounding contents. Tokens stay only in memory and
 * join password redaction; disclosure assertions continue to use the password.
 *
 * The final ordinary replay to finish owns aiCalls, including H3 even though its
 * failure is expected; generate, resolve and heal do not contribute. Heal totals
 * sum H4/H5 results, becoming unknown if either lacks aiCalls. Successful local
 * output remains 'verify-memos: PASS aiCalls=0 sha=<12 digits>[-dirty] memos=0.31.0';
 * heal checks append ' heal=healed healAiCalls=<n|unknown>'. Published runs replace
 * sha with 'package=ambercast@<version>'. Failures retain
 * 'verify-memos: FAIL stage=<stage> reason=<reason> aiCalls=<n|unknown|n/a>'.
 * Restoration failures reserve a protected '; restore failed: <reason>' tail
 * (reason bounded to 120 characters) before ordinary text consumes the 400-character
 * budget, just like process identities. Interruption replaces the original reason
 * with interrupted but preserves restoration failure evidence. Publication tails
 * use '; published files: <k> of 15' and '; fixture updated: <k> of 15'; the full
 * redacted, untruncated file list goes to stderr immediately before the verdict.
 * Each step call emits one ok line: heal has one, regeneration has five fixture
 * lines (copy, three generates, publication), and published runs have no pack line.
 *
 * Explicit targets prevent ambiguous assignment during regeneration, and budgets
 * scale with prompt counts. Acceptance and the read-only contract gate publication.
 * Prompts are never published and partial publication recovers by full regeneration.
 *
 * --published skips packing and installs ambercast@<version> directly with
 * npm install --save-dev --no-audit --no-fund in the isolated project, using
 * TIMEOUTS.pack. The installed package version must match exactly; failed install
 * reports exit and 'the published package may not be available yet; rerun later'
 * without polling or retry. It has no sha/dirty identity. Fresh dependency-code
 * execution requires direct maintainer authorization for manifests, lockfile,
 * command and install-script/network effects before a real harness run.
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
   * Runs H1-H8 after full acceptance, keeping every failure in stage heal.
   * @remarks H4, H5, H6 and H8 require both child exit 0 and their report
   * conditions so a valid-looking report cannot hide a process failure. Only H3
   * expects exit 4 and accepts a nonzero child exit as success. The first failure
   * stops later steps, with required H7 restoration attempted exactly once as
   * the sole exception; H7 failure prevents H8. H6/H8 judge failures and the
   * heal-report judge failures after H4/H5 begin their reason with 'judge:' while
   * retaining stage heal, preserving both the failing check and its heal context.
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
   * Proves the label change broke the intended binding through a direct child call.
   * @remarks H3 bypasses the ordinary replay step and its --regenerate guidance.
   * Require one JSON result, zero AI calls, exit 4 and a case-scoped error matching
   * its id and HEAL_STEP_ID. Exit 0 means 'label change did not break the heal case';
   * other exits use 'unexpected exit=<n>', and mismatched errors use
   * 'unexpected failure: <first code>'. Save stdout before parsing and retain this
   * completed ordinary replay's aiCalls even when its expected-miss check fails.
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
