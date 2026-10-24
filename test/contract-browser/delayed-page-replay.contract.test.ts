import { chromium } from 'playwright-core';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPlaywrightUiExecutor } from '#adapters/browser/chromium.js';
import { createSystemClock } from '#adapters/system/system-clock.js';
import { DEFAULT_RAW_CONFIG } from '#config/defaults.js';
import { GroundingDocument } from '#core/ir/schema.js';
import type { UiExecutor } from '#ports/browser.js';
import { run } from '#usecases/run.js';
import { buildRunReport } from '#usecases/run-report.js';
import { createFakeSecretsProvider } from '../doubles/fake-secrets-provider.js';
import { assertDiagnosable, assertZeroAiCalls, assertNoSecretDisclosure, collectStorageArtifacts } from '../support/report-assertions.js';
import { createScenario, createFreshPlan, writePrompt, DEFAULT_OPTIONS, RESOLVED_TARGETS, TEST_DIR, type TestStep } from '../support/run-scenario.js';
import { resolveChromiumAvailability } from './support/chromium-availability.js';
import { startFixtureApp, FIXTURE_CREDENTIALS, DELAY_LOWER_SLACK_MS, DELAY_UPPER_SLACK_MS, MAX_DELAY_MS, type FixtureApp } from './support/fixture-app.js';
import { CONTRACT_REPEATS } from './support/repeats.js';

const DELAY_MS = 1500;
const MUTATION_DELAY_MS = 3000;
const OTP_CODE = '424242';
const OTP_REF = '{{secrets.fixture.otp}}';

// Defeat immediate observation while leaving four jitter allowances for snapshots,
// polling, navigation completion and painting. The mutation doubles the delay so
// its immediate snapshot precedes rendering. Collection rejects unsafe constants
// even on hosts without Chromium.
if (!(DELAY_MS >= 1000
  && DELAY_MS + 4 * DELAY_UPPER_SLACK_MS < DEFAULT_RAW_CONFIG.targets['web-user'].resolveTimeoutMs
  && MUTATION_DELAY_MS >= 2 * DELAY_MS
  && MUTATION_DELAY_MS + 4 * DELAY_UPPER_SLACK_MS < DEFAULT_RAW_CONFIG.targets['web-user'].resolveTimeoutMs)) {
  throw new RangeError('Timing constants must keep fixture delays inside resolveTimeoutMs.');
}

type ScenarioDeps = ReturnType<typeof createScenario>['deps'];
type RunOutcome = Awaited<ReturnType<typeof run>>;
type Envelope = ReturnType<typeof buildRunReport>['envelope'];
type PersistedText = { plan: string; grounding: string | undefined };
type ReplayObservation = {
  outcome: RunOutcome;
  envelope: Envelope;
  elapsedMs: number;
  before: PersistedText;
  after: PersistedText;
};
type ReplayScenario = {
  body: string;
  steps: readonly TestStep[];
  configure: (app: FixtureApp) => void;
  secrets?: NonNullable<Parameters<typeof createScenario>[0]>['secrets'];
  recordExecutor: () => UiExecutor;
  replayExecutors: readonly (() => UiExecutor)[];
};

// Quotes are anchored in the third-line instruction, never the heading; the whole
// sentence anchors each intent and its quoted substring anchors the quote.
function bodySpan(body: string, text: string = body) {
  const index = body.indexOf(text);
  if (index === -1) throw new Error('The span text is absent from the instruction body.');
  return { startLine: 3, startColumn: index + 1, endLine: 3, endColumn: index + text.length + 1 };
}

// Distinguish a missing grounding file from an empty document so a redirect-only
// plan cannot accidentally acquire a cache. Retain exact text before parsing it.
async function persistedText(deps: ScenarioDeps, testPath: string): Promise<PersistedText> {
  const groundingPath = deps.layout.groundingPathFor(testPath);
  return {
    plan: await deps.storage.readText(deps.layout.planPathFor(testPath)),
    grounding: await deps.storage.exists(groundingPath) ? await deps.storage.readText(groundingPath) : undefined,
  };
}

// Only replay is timed, excluding fixture setup and report construction, so
// startup cannot satisfy the delay oracle.
async function measureReplay(deps: Parameters<typeof run>[0]): Promise<{ outcome: RunOutcome; elapsedMs: number }> {
  const started = performance.now();
  const outcome = await run(deps, { ...DEFAULT_OPTIONS, resolve: false });
  const elapsedMs = performance.now() - started;
  return { outcome, elapsedMs };
}

// In-process runs bypass command-boundary rounding, but reports require integer durationMs.
function createRoundedSystemClock() {
  return { ...createSystemClock(), monotonicMs: () => Math.round(performance.now()) };
}

function report(outcome: RunOutcome): Envelope {
  return buildRunReport({ startedAt: '2026-10-22T00:00:00Z', durationMs: 0, options: { allowEmpty: false, list: false }, outcome }).envelope;
}

/**
 * Records quoted bindings and replays them with independently selected executors.
 * @remarks
 * Every invocation, including repeats, owns a fresh app and scenario storage with
 * a real clock and the default throwing AI resolver. Only the target base URL
 * changes; timeout policy stays at its ordinary default.
 * Capture the plan before recording to detect a recording that rewrites it.
 * Replays replace the executor in array order, checking unchanged bytes immediately
 * after each replay, before a later control can silently repair its inputs.
 * Retain reports and exact artifact text for caller-specific oracles and count
 * dashboard requests around replay to prove redirect arrival.
 * The finally block stops the app even when setup, a run or an oracle fails;
 * run owns browser sessions. No retained state may mask repeat failures.
 */
async function recordThenReplay(scenario: ReplayScenario): Promise<{
  planBeforeRecord: string;
  recorded: { outcome: RunOutcome; envelope: Envelope; persistedText: PersistedText };
  replays: readonly ReplayObservation[];
  dashboardReplayRequestDelta: number;
}> {
  const app = await startFixtureApp();
  try {
    scenario.configure(app);
    const { deps, resolveAiExecutor } = createScenario({
      clock: createRoundedSystemClock(), uiExecutor: () => scenario.recordExecutor(),
      ...(scenario.secrets === undefined ? {} : { secrets: scenario.secrets }),
    });
    const targets = { web: { ...RESOLVED_TARGETS.web, baseUrl: app.baseUrl } };
    expect(targets.web.resolveTimeoutMs).toBe(DEFAULT_RAW_CONFIG.targets['web-user'].resolveTimeoutMs);
    const browserDeps = { ...deps, config: { ...deps.config, targets, ...(scenario.secrets === undefined ? {} : { secrets: { allow: ['fixture.otp'] } }) } };
    // Match createScenario's default discovery path to avoid FS_IO_ERROR.
    const testPath = await writePrompt(deps.storage, 'login.test.md', `# Delayed page replay\n\n${scenario.body}\n`);
    await createFreshPlan(deps.storage, testPath, scenario.steps, targets);
    const planBeforeRecord = await deps.storage.readText(deps.layout.planPathFor(testPath));
    const outcome = await run(browserDeps, { ...DEFAULT_OPTIONS, updateCache: true });
    const recorded = { outcome, envelope: report(outcome), persistedText: await persistedText(deps, testPath) };
    expect(recorded.persistedText.plan).toBe(planBeforeRecord);
    expect(recorded.outcome.results).toHaveLength(1);
    expect(recorded.outcome.results[0]?.result.status, JSON.stringify({ error: recorded.outcome.results[0]?.error, errors: recorded.envelope.errors })).toBe('passed');
    assertDiagnosable(recorded.envelope);
    expect(resolveAiExecutor).not.toHaveBeenCalled();

    const replays: ReplayObservation[] = [];
    const dashboardBefore = app.requestCount('/dashboard');
    for (const replayExecutor of scenario.replayExecutors) {
      const before = await persistedText(deps, testPath);
      const measured = await measureReplay({ ...browserDeps, uiExecutor: () => replayExecutor() });
      const after = await persistedText(deps, testPath);
      // This check precedes the next replay, so failed mutation cannot retire a
      // binding and let the real executor control rebuild it unnoticed.
      expect(after).toEqual(before);
      expect(after.plan).toBe(planBeforeRecord);
      const envelope = report(measured.outcome);
      assertDiagnosable(envelope);
      assertZeroAiCalls(envelope);
      expect(resolveAiExecutor).not.toHaveBeenCalled();
      replays.push({ ...measured, envelope, before, after });
    }
    if (scenario.secrets !== undefined) {
      const artifacts = await collectStorageArtifacts(deps.storage, [TEST_DIR]);
      for (const envelope of [recorded.envelope, ...replays.map(replay => replay.envelope)]) {
        assertNoSecretDisclosure({ secrets: { 'fixture.otp': OTP_CODE }, report: envelope, artifacts });
      }
    }
    return { planBeforeRecord, recorded, replays, dashboardReplayRequestDelta: app.requestCount('/dashboard') - dashboardBefore };
  } finally {
    await app.stop();
  }
}

/**
 * Builds a value-sensitive OTP fixture.
 * @remarks
 * Validate the delay before HTML interpolation and embed the code solely in the
 * script comparison, keeping it out of the accessibility tree. The fake provider
 * uses the same constant. Zero delay inserts synchronously; the wrong-code
 * control proves success text depends on secret input.
 */
function otpPage(delayMs: number): string {
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > MAX_DELAY_MS) throw new RangeError('OTP delay must be an integer within the fixture delay range.');
  return `<!doctype html><html lang="en"><body><main><h1>Verify sign-in</h1><div id="slot"></div><p id="status"></p></main>
<script>
(function(){
  function insert(){
    document.getElementById('slot').innerHTML = '<label for="otp">One-time code</label><input id="otp" name="otp" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6"><button type="button">Verify code</button>';
    document.querySelector('button').addEventListener('click', function(){
      document.getElementById('status').textContent = document.getElementById('otp').value === ${JSON.stringify(OTP_CODE)} ? 'Code accepted' : 'Invalid code';
    });
  }
  var delay = ${String(delayMs)};
  if (delay === 0) { insert(); } else { setTimeout(insert, delay); }
})();
</script></body></html>`;
}

// Remove only awaitElementPresence, the #381 fix, to prove delayed transition and
// insertion detect its regression. Bind other methods to the original session to
// preserve private fields. Copying product polling would weaken this mutation.
function withoutExistenceWait(executor: UiExecutor): UiExecutor {
  return {
    kind: executor.kind, surface: executor.surface, capabilities: executor.capabilities,
    async launch(target) {
      const session = await executor.launch(target);
      return new Proxy(session, {
        get(target, property) {
          if (property === 'awaitElementPresence') return async () => undefined;
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
  };
}

const realExecutor = () => createPlaywrightUiExecutor({ kind: 'playwright', browser: 'chromium' });
const mutatedExecutor = () => withoutExistenceWait(realExecutor());

function quotedIntent(body: string, text: string, roleHint: string) {
  return { description: text, roleHint, sourceSpan: bodySpan(body), quote: { text, sourceSpan: bodySpan(body, text) } };
}

function transitionPlan() {
  const body = 'Open the items list, click "Open item 1", then click "Back to list" and see Items.';
  const steps: TestStep[] = [
    { id: 'open', kind: 'action', action: 'navigate', url: '/spa' },
    { id: 'click-open', kind: 'action', action: 'click', intent: quotedIntent(body, 'Open item 1', 'link') },
    { id: 'click-back', kind: 'action', action: 'click', intent: quotedIntent(body, 'Back to list', 'link') },
    { id: 'see-items', kind: 'assert', check: 'text-visible', text: 'Items', confirms: ['click-open', 'click-back'] },
  ];
  return { body, steps };
}

function insertionPlan() {
  const body = 'Open the delayed page, click "Late action" and see Late action done.';
  const steps: TestStep[] = [
    { id: 'open', kind: 'action', action: 'navigate', url: '/late' },
    { id: 'click-late', kind: 'action', action: 'click', intent: quotedIntent(body, 'Late action', 'button') },
    { id: 'see-done', kind: 'assert', check: 'text-visible', text: 'Late action done', confirms: ['click-late'] },
  ];
  return { body, steps };
}

function otpPlan() {
  const body = 'Open verification, fill "One-time code", click "Verify code" and see Code accepted.';
  const steps: TestStep[] = [
    { id: 'open', kind: 'action', action: 'navigate', url: '/otp' },
    { id: 'fill-otp', kind: 'action', action: 'fill-secret', intent: quotedIntent(body, 'One-time code', 'textbox'), secretRef: OTP_REF },
    { id: 'click-verify', kind: 'action', action: 'click', intent: quotedIntent(body, 'Verify code', 'button') },
    { id: 'see-accepted', kind: 'assert', check: 'text-visible', text: 'Code accepted', confirms: ['fill-otp', 'click-verify'] },
  ];
  return { body, steps };
}

// All element actions have quotes and later confirmation in plan order. Exact
// cache keys and confirmed replay bindings prevent familiar initial text from
// passing an unexercised action; elapsed time proves the delay actually occurred.
function expectSuccessfulReplay(observation: Awaited<ReturnType<typeof recordThenReplay>>, actionIds: string[], minimumDelayMs = DELAY_MS) {
  const { recorded, replays, planBeforeRecord } = observation;
  expect(recorded.persistedText.plan).toBe(planBeforeRecord);
  const grounding = recorded.persistedText.grounding === undefined ? undefined : GroundingDocument.parse(JSON.parse(recorded.persistedText.grounding));
  expect(Object.keys(grounding?.entries ?? {}).sort()).toEqual([...actionIds].sort());
  if (actionIds.length === 0) expect(recorded.persistedText.grounding).toBeUndefined();
  for (const id of actionIds) {
    expect(grounding?.entries[id]).toMatchObject({ kind: 'element', provenance: 'quoted-match' });
    expect(recorded.outcome.results[0]?.result.steps.find(step => step.id === id)).toMatchObject({ binding: { provenance: 'quoted-match', confirmed: true } });
  }
  expect(replays).toHaveLength(1);
  const replay = replays[0]!;
  expect(replay.outcome.results).toHaveLength(1);
  expect(replay.outcome.results[0]?.result.status, JSON.stringify({ error: replay.outcome.results[0]?.error, errors: replay.envelope.errors })).toBe('passed');
  expect(replay.before).toEqual(recorded.persistedText);
  expect(replay.after).toEqual(replay.before);
  expect(replay.elapsedMs).toBeGreaterThanOrEqual(minimumDelayMs - DELAY_LOWER_SLACK_MS);
  for (const id of actionIds) {
    expect(replay.outcome.results[0]?.result.steps.find(step => step.id === id)).toMatchObject({ binding: { provenance: 'grounding', confirmed: true } });
  }
}

let chromiumAvailable = false;

describe('delayed page deterministic replay', () => {
  beforeAll(async () => {
    chromiumAvailable = await resolveChromiumAvailability(() => chromium.launch());
  });
  beforeEach((context) => {
    if (!chromiumAvailable) context.skip('Chromium is unavailable for this opt-in contract lane; run `npx playwright install chromium` once.');
  });

  it('TEST-1 replays an action right after a delayed client-side transition without AI', { repeats: CONTRACT_REPEATS, timeout: 60_000 }, async () => {
    // An assertion between clicks would poll on behalf of existence waiting and
    // hide #381. Items alone is initially true, so bindings and timing also matter.
    const observation = await recordThenReplay({ ...transitionPlan(), configure: app => app.configure({ transitionDelayMs: DELAY_MS }), recordExecutor: realExecutor, replayExecutors: [realExecutor] });
    expectSuccessfulReplay(observation, ['click-back', 'click-open']);
  });

  it('TEST-2 replays an action on a delayed inserted element without AI', { repeats: CONTRACT_REPEATS, timeout: 60_000 }, async () => {
    // The completion text proves the inserted button was operated.
    const observation = await recordThenReplay({ ...insertionPlan(), configure: app => app.configure({ lateElementDelayMs: DELAY_MS }), recordExecutor: realExecutor, replayExecutors: [realExecutor] });
    expectSuccessfulReplay(observation, ['click-late']);
  });

  it('TEST-3 replays login through a delayed redirect destination without AI', { repeats: CONTRACT_REPEATS, timeout: 60_000 }, async () => {
    // Public fixture credentials use fill. Playwright navigation waiting absorbs
    // this delay, while the request delta proves actual POST/302 arrival.
    const body = 'Open login, fill "Username" and "Passcode", click "Sign in" and see Signed in.';
    const steps: TestStep[] = [
      { id: 'open', kind: 'action', action: 'navigate', url: '/login' },
      { id: 'fill-username', kind: 'action', action: 'fill', value: FIXTURE_CREDENTIALS.username, intent: quotedIntent(body, 'Username', 'textbox') },
      { id: 'fill-passcode', kind: 'action', action: 'fill', value: FIXTURE_CREDENTIALS.passcode, intent: quotedIntent(body, 'Passcode', 'textbox') },
      { id: 'click-sign-in', kind: 'action', action: 'click', intent: quotedIntent(body, 'Sign in', 'button') },
      { id: 'see-signed-in', kind: 'assert', check: 'text-visible', text: 'Signed in', confirms: ['fill-username', 'fill-passcode', 'click-sign-in'] },
    ];
    const observation = await recordThenReplay({ body, steps, configure: app => app.configure({ responseDelayMs: { '/dashboard': DELAY_MS } }), recordExecutor: realExecutor, replayExecutors: [realExecutor] });
    expectSuccessfulReplay(observation, ['click-sign-in', 'fill-passcode', 'fill-username']);
    expect(observation.dashboardReplayRequestDelta).toBeGreaterThanOrEqual(1);
  });

  it('TEST-4 replays a disabled action after the ready gate opens without AI', { repeats: CONTRACT_REPEATS, timeout: 60_000 }, async () => {
    // Playwright actionability waits on disabled; the enabled replay must still
    // match the binding recorded before that gate opened.
    const body = 'Open the ready page, click "Continue" and see Continued.';
    const steps: TestStep[] = [
      { id: 'open', kind: 'action', action: 'navigate', url: '/ready' },
      { id: 'click-continue', kind: 'action', action: 'click', intent: quotedIntent(body, 'Continue', 'button') },
      { id: 'see-continued', kind: 'assert', check: 'text-visible', text: 'Continued', confirms: ['click-continue'] },
    ];
    const observation = await recordThenReplay({ body, steps, configure: app => app.configure({ readyDelayMs: DELAY_MS }), recordExecutor: realExecutor, replayExecutors: [realExecutor] });
    expectSuccessfulReplay(observation, ['click-continue']);
  });

  it('TEST-5 follows an unauthenticated redirect without creating grounding', { repeats: CONTRACT_REPEATS, timeout: 60_000 }, async () => {
    // No element intent means no cache. The delayed login response exercises
    // redirect following rather than the product's element existence waiting.
    const observation = await recordThenReplay({
      body: 'Open the dashboard and see Account access.',
      steps: [
        { id: 'open', kind: 'action', action: 'navigate', url: '/dashboard' },
        { id: 'see-login', kind: 'assert', check: 'text-visible', text: 'Account access' },
      ],
      configure: app => app.configure({ responseDelayMs: { '/login': DELAY_MS } }), recordExecutor: realExecutor, replayExecutors: [realExecutor],
    });
    expectSuccessfulReplay(observation, []);
    expect(observation.replays[0]?.after.grounding).toBeUndefined();
  });

  it('TEST-6 replays delayed OTP input without disclosing the secret', { repeats: CONTRACT_REPEATS, timeout: 60_000 }, async () => {
    // The allow-list uses a logical name, while the fake lookup uses the full ref.
    // Shared report and storage checks cover both runs, including persisted caches.
    const observation = await recordThenReplay({ ...otpPlan(), configure: app => app.setPage('/otp', otpPage(DELAY_MS)), secrets: createFakeSecretsProvider(new Map([[OTP_REF, OTP_CODE]])), recordExecutor: realExecutor, replayExecutors: [realExecutor] });
    expectSuccessfulReplay(observation, ['click-verify', 'fill-otp']);

    // Independent app/storage and a wrong value prove success depends on input;
    // the control's failure classification is deliberately unconstrained.
    const app = await startFixtureApp();
    try {
      app.setPage('/otp', otpPage(DELAY_MS));
      const { deps } = createScenario({ clock: createRoundedSystemClock(), uiExecutor: realExecutor, secrets: createFakeSecretsProvider(new Map([[OTP_REF, '000000']])) });
      const targets = { web: { ...RESOLVED_TARGETS.web, baseUrl: app.baseUrl } };
      const browserDeps = { ...deps, config: { ...deps.config, targets, secrets: { allow: ['fixture.otp'] } } };
      const { body, steps } = otpPlan();
      // Match createScenario's default discovery path to avoid FS_IO_ERROR.
      const testPath = await writePrompt(deps.storage, 'login.test.md', `# Delayed page replay\n\n${body}\n`);
      await createFreshPlan(deps.storage, testPath, steps, targets);
      const outcome = await run(browserDeps, { ...DEFAULT_OPTIONS, updateCache: true });
      expect(outcome.results).toHaveLength(1);
      expect(outcome.results[0]?.result.status).not.toBe('passed');
    } finally {
      await app.stop();
    }
  });

  it.each([
    { name: 'client transition', delayKey: 'transitionDelayMs', makePlan: transitionPlan, stepId: 'click-back' },
    { name: 'element insertion', delayKey: 'lateElementDelayMs', makePlan: insertionPlan, stepId: 'click-late' },
  ] as const)('TEST-7 detects removed existence waiting after $name', { repeats: CONTRACT_REPEATS, timeout: 60_000 }, async ({ delayKey, makePlan, stepId }) => {
    // Real recording, mutated replay and real control share storage, in that
    // order. The helper checks failed-run bytes before starting the real control.
    const observation = await recordThenReplay({ ...makePlan(), configure: app => app.configure({ [delayKey]: MUTATION_DELAY_MS }), recordExecutor: realExecutor, replayExecutors: [mutatedExecutor, realExecutor] });
    expect(observation.replays).toHaveLength(2);
    const [mutation, control] = observation.replays;
    expect(mutation!.outcome.results).toHaveLength(1);
    expect(mutation!.outcome.results[0]?.result.status).toBe('error');
    const error = mutation!.outcome.results[0]?.error;
    expect(error).toMatchObject({ kind: 'grounding-unresolved', details: { stepId, reason: 'recoverable-miss' } });
    expect(error?.exitCode).toBe(4);
    expect(mutation!.envelope.errors[0]).toMatchObject({ code: 'GROUNDING_UNRESOLVED' });
    expect(mutation!.before).toEqual(observation.recorded.persistedText);
    expect(mutation!.after).toEqual(mutation!.before);
    expect(control!.before).toEqual(mutation!.after);
    expect(control!.outcome.results).toHaveLength(1);
    expect(control!.outcome.results[0]?.result.status, JSON.stringify({ error: control!.outcome.results[0]?.error, errors: control!.envelope.errors })).toBe('passed');
  });

  it('TEST-8 preserves immediate replay when only existence waiting is removed', { repeats: CONTRACT_REPEATS, timeout: 60_000 }, async () => {
    // Immediate rendering rejects a Proxy that breaks private fields or other
    // executor behavior rather than selectively removing the #381 wait.
    const observation = await recordThenReplay({ ...transitionPlan(), configure: app => app.configure({ transitionDelayMs: 0 }), recordExecutor: realExecutor, replayExecutors: [mutatedExecutor] });
    expectSuccessfulReplay(observation, ['click-back', 'click-open'], 0);
  });
});
