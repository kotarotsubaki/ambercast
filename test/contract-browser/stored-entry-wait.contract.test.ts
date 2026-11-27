import { chromium } from 'playwright-core';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPlaywrightUiExecutor } from '#adapters/browser/chromium.js';
import { createSystemClock } from '#adapters/system/system-clock.js';
import { GroundingDocument } from '#core/ir/schema.js';
import type { UiExecutor } from '#ports/browser.js';
import { run } from '#usecases/run.js';
import { buildRunReport } from '#usecases/run-report.js';
import { assertDiagnosable, assertZeroAiCalls } from '../support/report-assertions.js';
import { createScenario, createFreshPlan, writePrompt, DEFAULT_OPTIONS, RESOLVED_TARGETS, type TestStep } from '../support/run-scenario.js';
import { resolveChromiumAvailability } from './support/chromium-availability.js';
import { startFixtureApp, DELAY_LOWER_SLACK_MS, type FixtureApp } from './support/fixture-app.js';
import { CONTRACT_REPEATS } from './support/repeats.js';
import { instrumentExecutor, type VerifyLogEntry, type InstrumentOptions } from './support/stored-entry-instrument.js';

/*
 * A page whose content is replaced under a stored entry. The leaving view and the
 * incoming view each hold a button named `More` inside an identically named group;
 * only the preceding sibling's name differs, so verifying the stored entry against
 * the leaving view reports `fingerprint-mismatch` with a `neighbor-names` difference.
 * The recording runs with no `More` in the leaving view and no delay, so the first
 * target resolution can only ever see the incoming view; the replay adds the leaving
 * `More` and the delay, which is what makes the stored entry miss before the switch.
 * Each `More` requests its own path and shows its result text only after the response,
 * so the fixture's request count tells which view's button was operated.
 */

type SwitchMode = 'a' | 'b' | 'c';

const NEXT_MORE_PATH = '/live-more/next';
const FROM_MORE_PATH = '/live-more/from';
const LIVE_PATH = '/live';
const LIVE_NEXT_PATH = '/live-next';
// Mode (c) leaves through a client timer that is short compared with the response delay.
const NAVIGATE_TIMER_MS = 100;
const BODY = 'Open the live page, click "Switch view", click "More" and see Next opened.';

type PageOptions = { mode: SwitchMode; hasFromMore: boolean; delayMs: number; switches: boolean };
type ScenarioDeps = ReturnType<typeof createScenario>['deps'];
type RunOutcome = Awaited<ReturnType<typeof run>>;
type Envelope = ReturnType<typeof buildRunReport>['envelope'];
type PersistedText = { plan: string; grounding: string | undefined };
type LiveReplay = { executor: (log: VerifyLogEntry[]) => UiExecutor; resolve?: boolean };
type LiveObservation = {
  outcome: RunOutcome;
  envelope: Envelope;
  elapsedMs: number;
  before: PersistedText;
  after: PersistedText;
  nextClicks: number;
  fromClicks: number;
  log: VerifyLogEntry[];
};

function actionGroup(neighbor: string, path: string, done: string): string {
  return `<div role="group" aria-label="Item actions"><button type="button">${neighbor}</button><button type="button" data-more="${path}" data-done="${done}">More</button></div>`;
}

const CLICK_HANDLER = `document.addEventListener('click', function (event) {
  var button = event.target.closest('[data-more]');
  if (!button) return;
  fetch(button.getAttribute('data-more')).then(function () { document.getElementById('status').textContent = button.getAttribute('data-done'); });
});`;

function livePage({ mode, hasFromMore, delayMs, switches }: PageOptions): string {
  const arriving = actionGroup('Archive', NEXT_MORE_PATH, 'Next opened');
  const leaving = hasFromMore ? actionGroup('Share', FROM_MORE_PATH, 'Previous opened') : '';
  const timer = mode === 'c' ? NAVIGATE_TIMER_MS : delayMs;
  return `<!doctype html><html lang="en"><body><main>
<section aria-label="Controls"><button type="button" id="switch">Switch view</button></section>
<section aria-label="Current view" id="view">${leaving}</section>
<section aria-label="Incoming view" id="incoming"></section>
<p id="status"></p></main>
<script>
(function () {
  var arriving = ${JSON.stringify(arriving)};
  var mode = ${JSON.stringify(mode)};
  var switches = ${JSON.stringify(switches)};
  var timer = ${String(timer)};
  document.getElementById('switch').addEventListener('click', function () {
    if (!switches) return;
    if (mode === 'a') {
      setTimeout(function () { document.getElementById('view').innerHTML = arriving; }, timer);
    } else if (mode === 'b') {
      document.getElementById('incoming').innerHTML = arriving;
      setTimeout(function () { document.getElementById('view').innerHTML = ''; }, timer);
    } else {
      setTimeout(function () { location.href = ${JSON.stringify(LIVE_NEXT_PATH)}; }, timer);
    }
  });
  ${CLICK_HANDLER}
})();
</script></body></html>`;
}

function nextPage(): string {
  return `<!doctype html><html lang="en"><body><main>
<section aria-label="Incoming view">${actionGroup('Archive', NEXT_MORE_PATH, 'Next opened')}</section>
<p id="status"></p></main>
<script>${CLICK_HANDLER}</script></body></html>`;
}

function configurePages(app: FixtureApp, options: PageOptions): void {
  app.setPage(LIVE_PATH, livePage(options));
  app.setPage(LIVE_NEXT_PATH, nextPage());
  app.setPage(NEXT_MORE_PATH, 'ok');
  app.setPage(FROM_MORE_PATH, 'ok');
  // Mode (c) delays the destination's response; the other modes delay in page script.
  app.configure({ responseDelayMs: options.mode === 'c' ? { [LIVE_NEXT_PATH]: options.delayMs } : {} });
}

function bodySpan(text: string = BODY) {
  const index = BODY.indexOf(text);
  if (index === -1) throw new Error('The span text is absent from the instruction body.');
  return { startLine: 3, startColumn: index + 1, endLine: 3, endColumn: index + text.length + 1 };
}

function quotedIntent(text: string, roleHint: string) {
  return { description: text, roleHint, sourceSpan: bodySpan(), quote: { text, sourceSpan: bodySpan(text) } };
}

const STEPS: readonly TestStep[] = [
  { id: 'open', kind: 'action', action: 'navigate', url: LIVE_PATH },
  { id: 'click-switch', kind: 'action', action: 'click', intent: quotedIntent('Switch view', 'button') },
  { id: 'click-more', kind: 'action', action: 'click', intent: quotedIntent('More', 'button') },
  { id: 'see-next', kind: 'assert', check: 'text-visible', text: 'Next opened', confirms: ['click-switch', 'click-more'] },
];

async function persistedText(deps: ScenarioDeps, testPath: string): Promise<PersistedText> {
  const groundingPath = deps.layout.groundingPathFor(testPath);
  return {
    plan: await deps.storage.readText(deps.layout.planPathFor(testPath)),
    grounding: await deps.storage.exists(groundingPath) ? await deps.storage.readText(groundingPath) : undefined,
  };
}

function report(outcome: RunOutcome): Envelope {
  return buildRunReport({ startedAt: '2026-11-27T00:00:00Z', durationMs: 0, options: { allowEmpty: false, list: false }, outcome }).envelope;
}

const realExecutor = () => createPlaywrightUiExecutor({ kind: 'playwright', browser: 'chromium' });
const withInstrument = (options: Omit<InstrumentOptions, 'log'> = {}) => (log: VerifyLogEntry[]) => instrumentExecutor(realExecutor(), { ...options, log });

/**
 * Records against a leaving view without `More`, then replays against one with it.
 * @remarks Every invocation owns a fresh fixture and storage with a real clock and
 * an AI resolver that fails the test if called. The recording runs with no delay
 * and no leaving `More`; the replay options differ only in those two fields (and,
 * for the negative case, in whether the switch button does anything), so the plan
 * and the target definitions that feed its freshness digest stay identical.
 * Artifact bytes are compared around each replay before the next one starts.
 */
async function liveScenario(scenario: {
  mode: SwitchMode;
  replayDelayMs: number;
  hasFromMoreAtReplay?: boolean;
  switchesAtReplay?: boolean;
  resolveTimeoutMs?: number;
  replays: readonly LiveReplay[];
}): Promise<{ recorded: PersistedText; replays: LiveObservation[]; groundingAfterRecord: GroundingDocument }> {
  const app = await startFixtureApp();
  try {
    const record: PageOptions = { mode: scenario.mode, hasFromMore: false, delayMs: 0, switches: true };
    const replay: PageOptions = { mode: scenario.mode, hasFromMore: scenario.hasFromMoreAtReplay ?? true, delayMs: scenario.replayDelayMs, switches: scenario.switchesAtReplay ?? true };
    configurePages(app, record);
    const { deps, resolveAiExecutor } = createScenario({ clock: { ...createSystemClock(), monotonicMs: () => Math.round(performance.now()) }, uiExecutor: () => realExecutor() });
    const targets = { web: { ...RESOLVED_TARGETS.web, baseUrl: app.baseUrl, ...(scenario.resolveTimeoutMs === undefined ? {} : { resolveTimeoutMs: scenario.resolveTimeoutMs }) } };
    const browserDeps = { ...deps, config: { ...deps.config, targets } };
    const testPath = await writePrompt(deps.storage, 'login.test.md', `# Stored entry wait\n\n${BODY}\n`);
    await createFreshPlan(deps.storage, testPath, STEPS, targets);
    const planBeforeRecord = await deps.storage.readText(deps.layout.planPathFor(testPath));
    const recordedOutcome = await run(browserDeps, { ...DEFAULT_OPTIONS, updateCache: true });
    const recordedEnvelope = report(recordedOutcome);
    expect(recordedOutcome.results[0]?.result.status, JSON.stringify({ error: recordedOutcome.results[0]?.error, errors: recordedEnvelope.errors })).toBe('passed');
    assertDiagnosable(recordedEnvelope);
    expect(resolveAiExecutor).not.toHaveBeenCalled();
    const recorded = await persistedText(deps, testPath);
    expect(recorded.plan).toBe(planBeforeRecord);
    const groundingAfterRecord = GroundingDocument.parse(JSON.parse(recorded.grounding ?? 'null'));
    // Both element steps must have been recorded from the quote, with neighbor names intact.
    for (const id of ['click-switch', 'click-more']) expect(groundingAfterRecord.entries[id]).toMatchObject({ kind: 'element', provenance: 'quoted-match' });
    expect(app.requestCount(NEXT_MORE_PATH)).toBe(1);
    expect(app.requestCount(FROM_MORE_PATH)).toBe(0);

    configurePages(app, replay);
    const observations: LiveObservation[] = [];
    for (const step of scenario.replays) {
      const log: VerifyLogEntry[] = [];
      const before = await persistedText(deps, testPath);
      const nextBefore = app.requestCount(NEXT_MORE_PATH);
      const fromBefore = app.requestCount(FROM_MORE_PATH);
      const started = performance.now();
      const outcome = await run({ ...browserDeps, uiExecutor: () => step.executor(log) }, { ...DEFAULT_OPTIONS, resolve: step.resolve ?? false });
      const elapsedMs = performance.now() - started;
      const after = await persistedText(deps, testPath);
      expect(after).toEqual(before);
      expect(after.plan).toBe(planBeforeRecord);
      const envelope = report(outcome);
      assertDiagnosable(envelope);
      assertZeroAiCalls(envelope);
      expect(resolveAiExecutor).not.toHaveBeenCalled();
      observations.push({ outcome, envelope, elapsedMs, before, after, nextClicks: app.requestCount(NEXT_MORE_PATH) - nextBefore, fromClicks: app.requestCount(FROM_MORE_PATH) - fromBefore, log });
    }
    return { recorded, replays: observations, groundingAfterRecord };
  } finally {
    await app.stop();
  }
}

function moreOutcomes(observation: LiveObservation): string[] {
  return observation.log.filter(entry => entry.name === 'More').map(entry => entry.outcome);
}

// The first stored-entry verification of `More` must have looked at the leaving view;
// a first hit, or a port exception while the page is in transit, is a spec gap (the
// verification could not be shown to have seen the screen before the switch).
function expectVerifiedBeforeSwitch(observation: LiveObservation, firstMiss: string): void {
  const outcomes = moreOutcomes(observation);
  if (outcomes.includes('throw')) throw new Error(`GAP: the stored-entry verification threw during the transition (${JSON.stringify(outcomes)}).`);
  if (outcomes[0] === 'hit') throw new Error(`GAP: the first verification hit, so the leaving view was never verified (${JSON.stringify(outcomes)}).`);
  expect(outcomes[0]).toBe(firstMiss);
  expect(outcomes.at(-1)).toBe('hit');
}

function expectOperatedIncomingOnly(observation: LiveObservation, delayMs: number): void {
  const result = observation.outcome.results[0];
  expect(result?.result.status, JSON.stringify({ error: result?.error, errors: observation.envelope.errors, log: observation.log })).toBe('passed');
  expect(observation.nextClicks).toBe(1);
  expect(observation.fromClicks).toBe(0);
  expect(observation.before).toEqual(observation.after);
  expect(result?.result.steps.find(step => step.id === 'click-more')).toMatchObject({ status: 'passed', binding: { provenance: 'grounding', confirmed: true } });
  expect(observation.elapsedMs).toBeGreaterThanOrEqual(delayMs - DELAY_LOWER_SLACK_MS);
}

function expectStoppedWithoutOperating(observation: LiveObservation) {
  const result = observation.outcome.results[0];
  expect(result?.result.status).toBe('error');
  expect(result?.error).toMatchObject({ kind: 'grounding-unresolved', details: { stepId: 'click-more', reason: 'recoverable-miss' } });
  expect(result?.error?.exitCode).toBe(4);
  expect(observation.envelope.errors[0]).toMatchObject({ code: 'GROUNDING_UNRESOLVED' });
  expect(observation.nextClicks).toBe(0);
  expect(observation.fromClicks).toBe(0);
  expect(observation.before).toEqual(observation.after);
  return observation.envelope.errors[0] as { details?: Record<string, unknown> };
}

let chromiumAvailable = false;

describe('stored entry waits for a page that is still switching', () => {
  beforeAll(async () => {
    chromiumAvailable = await resolveChromiumAvailability(() => chromium.launch());
  });
  beforeEach((context) => {
    if (!chromiumAvailable) context.skip('Chromium is unavailable for this opt-in contract lane; run `npx playwright install chromium` once.');
  });

  it.each([300, 1500])('TEST-LIVE-1 replays through an in-document switch delayed %i ms and operates only the incoming button', { repeats: CONTRACT_REPEATS, timeout: 60_000 }, async (delayMs) => {
    const { recorded, replays } = await liveScenario({ mode: 'a', replayDelayMs: delayMs, replays: [{ executor: withInstrument() }] });
    const observation = replays[0]!;
    expectOperatedIncomingOnly(observation, delayMs);
    expect(observation.after).toEqual({ plan: recorded.plan, grounding: recorded.grounding });
    expectVerifiedBeforeSwitch(observation, 'fingerprint-mismatch');
  });

  it('TEST-LIVE-2 replays through a navigation whose response is delayed and operates only the incoming button', { repeats: CONTRACT_REPEATS, timeout: 60_000 }, async () => {
    const delayMs = 1500;
    const { replays } = await liveScenario({ mode: 'c', replayDelayMs: delayMs, replays: [{ executor: withInstrument() }] });
    const observation = replays[0]!;
    // A first hit or a port exception here means the transition was never observed from
    // the leaving view; neither counts as a pass and neither is swallowed.
    expectVerifiedBeforeSwitch(observation, 'fingerprint-mismatch');
    expectOperatedIncomingOnly(observation, delayMs);
  });

  it('TEST-LIVE-3 repeats the sticky miss until the step deadline, then stops without operating either button, when fresh verification is denied', { repeats: CONTRACT_REPEATS, timeout: 60_000 }, async () => {
    const delayMs = 1500;
    const { recorded, replays } = await liveScenario({
      mode: 'a', replayDelayMs: delayMs,
      // The existence wait stays: only fresh stored-entry verification results are denied.
      // The first miss is replayed on every later verification, so the product repeats
      // until the step deadline and fails on that same sticky miss.
      replays: [{ executor: withInstrument({ stickyFirstMiss: true }) }, { executor: withInstrument() }],
    });
    const [mutation, control] = replays as [LiveObservation, LiveObservation];
    const error = expectStoppedWithoutOperating(mutation);
    expect(error.details).toMatchObject({ verification: 'fingerprint-mismatch' });
    expect(mutation.after).toEqual({ plan: recorded.plan, grounding: recorded.grounding });
    expect(control.outcome.results[0]?.result.status, JSON.stringify({ errors: control.envelope.errors, log: control.log })).toBe('passed');
    expect(control.nextClicks).toBe(1);
    expect(control.fromClicks).toBe(0);
  });

  it('TEST-LIVE-4 stops with a neighbor-names difference when the page never switches', { repeats: CONTRACT_REPEATS, timeout: 60_000 }, async () => {
    const { replays } = await liveScenario({ mode: 'a', replayDelayMs: 300, switchesAtReplay: false, resolveTimeoutMs: 1000, replays: [{ executor: withInstrument() }] });
    const observation = replays[0]!;
    const error = expectStoppedWithoutOperating(observation);
    expect(error.details).toMatchObject({ verification: 'fingerprint-mismatch', difference: 'neighbor-names' });
    // The upper bound is not asserted: not waiting beyond the deadline is covered by the
    // verification counts of the fake-driven tests.
    expect(observation.elapsedMs).toBeGreaterThanOrEqual(995);
  });

  it('TEST-LIVE-5 waits out an ambiguous overlap of both views and operates only the incoming button', { repeats: CONTRACT_REPEATS, timeout: 60_000 }, async () => {
    const delayMs = 300;
    const { replays } = await liveScenario({ mode: 'b', replayDelayMs: delayMs, replays: [{ executor: withInstrument() }] });
    const observation = replays[0]!;
    expectOperatedIncomingOnly(observation, delayMs);
    expectVerifiedBeforeSwitch(observation, 'ambiguous-match');
  });

  it('TEST-LIVE-6 waits instead of re-resolving when resolution is permitted', { repeats: CONTRACT_REPEATS, timeout: 60_000 }, async () => {
    const { recorded, replays, groundingAfterRecord } = await liveScenario({ mode: 'a', replayDelayMs: 300, replays: [{ executor: withInstrument(), resolve: true }] });
    const observation = replays[0]!;
    expectOperatedIncomingOnly(observation, 300);
    expectVerifiedBeforeSwitch(observation, 'fingerprint-mismatch');
    expect(observation.after.grounding).toBe(recorded.grounding);
    const entry = GroundingDocument.parse(JSON.parse(observation.after.grounding ?? 'null')).entries['click-more'];
    expect(entry).not.toHaveProperty('ignoredNames');
    expect(groundingAfterRecord.entries['click-more']).not.toHaveProperty('ignoredNames');
    expect(JSON.stringify(observation.envelope)).not.toContain('neighbor-name-ignored');
  });

  it('TEST-LIVE-8 recovers from an invalid first verification on an immediately rendered page', { repeats: CONTRACT_REPEATS, timeout: 60_000 }, async () => {
    // Real Chromium cannot emit an invalid observation at a chosen moment, so only the
    // first stored-entry result of each locator is replaced.
    const { recorded, replays } = await liveScenario({
      mode: 'a', replayDelayMs: 0, hasFromMoreAtReplay: false,
      replays: [{ executor: withInstrument({ invalidFirstVerify: true }) }],
    });
    const observation = replays[0]!;
    expectOperatedIncomingOnly(observation, 0);
    expect(observation.after).toEqual({ plan: recorded.plan, grounding: recorded.grounding });
    expect(moreOutcomes(observation)).toEqual(['snapshot-invalid', 'hit']);
    expect(observation.log.filter(entry => entry.name === 'Switch view').map(entry => entry.outcome)).toEqual(['snapshot-invalid', 'hit']);
  });
});
