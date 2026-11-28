/**
 * A page transition must not discard a reusable stored binding after one miss.
 * These contracts keep verification running against unchanged stored evidence
 * until a hit or the shared step deadline, so transient pages cannot trigger
 * premature replacement or learned exclusions. Only the final verification
 * determines failure diagnostics and eligibility for learning ignored names.
 * Exceptions, cancellation, pre-action rejection, and failed operations must
 * never become verification retries; an operation still happens at most once.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeIntentDigest } from '#core/ir/digest.js';
import { GroundingDocument, type FingerprintNameSlot } from '#core/ir/schema.js';
import { SNAPSHOT_INVALID } from '#core/ir/aria-snapshot.js';
import { BoundElementRejectedError } from '#core/errors/bound-element-rejected-error.js';
import type { GroundedResolution } from '#ports/browser.js';
import { run } from '#usecases/run.js';
import { buildRunReport } from '#usecases/run-report.js';
import { createFixedClock } from '../../doubles/create-fixed-clock.js';
import { createFakeAiExecutor } from '../../doubles/fake-ai-executor.js';
import { createFakeUiExecutor } from '../../doubles/fake-ui-executor.js';
import { elementRefKey } from '../../doubles/fake-browser-session.js';
import {
  createScenario, createFakeBrowserSession, liveEntries, seedFreshArtifacts,
  writePrompt, DEFAULT_OPTIONS, RESOLVED_TARGETS, type TestStep,
} from '../../support/run-scenario.js';
import { neighborTree, observation, RELAX_REF } from '../../support/relaxed-fingerprint.js';
import { assertDiagnosable, assertZeroAiCalls } from '../../support/report-assertions.js';

afterEach(() => vi.restoreAllMocks());

const NOW = new Date('2026-11-27T00:00:00Z');
const SPAN = { startLine: 3, startColumn: 1, endLine: 3, endColumn: 16 };
type Miss = Extract<GroundedResolution, { kind: 'miss' }>;
const mismatch: Miss = { kind: 'miss', reason: 'fingerprint-mismatch', difference: 'structure' };
const neighborMiss: Miss = { kind: 'miss', reason: 'fingerprint-mismatch', difference: 'neighbor-names', changedNames: ['siblingBefore'] };
const missing: Miss = { kind: 'miss', reason: 'element-not-found' };
const ambiguous: Miss = { kind: 'miss', reason: 'ambiguous-match' };
const invalid: Miss = { kind: 'miss', reason: 'snapshot-invalid' };

function click(quoted = true): TestStep {
  return { id: 'click', kind: 'action', action: 'click', intent: {
    description: 'Click Submit', roleHint: 'button', sourceSpan: SPAN,
    ...(quoted ? { quote: { text: 'Submit', sourceSpan: { ...SPAN, startColumn: 8, endColumn: 14 } } } : {}),
  } };
}

async function fixture(options: {
  timeout?: number; quoted?: boolean; resolve?: boolean; missingEntry?: boolean;
  wrongIntent?: boolean; legacy?: boolean; ignored?: FingerprintNameSlot[];
  change?: Record<string, string | boolean>; elapsedOnSleep?: (ms: number) => number;
  controller?: AbortController;
} = {}) {
  const clock = createFixedClock(NOW, 0, options.elapsedOnSleep);
  const step = click(options.quoted ?? true);
  if (step.kind !== 'action' || !('intent' in step)) throw new Error('Fixture requires an element action.');
  const stored = {
    kind: 'element' as const, locator: RELAX_REF, fingerprint: observation().fingerprint,
    ...(options.legacy ? {} : { components: observation().components }),
    ...(options.ignored ? { ignoredNames: options.ignored } : {}),
    intentDigest: options.wrongIntent ? 'f'.repeat(64) : computeIntentDigest({ stepKind: 'action', operation: 'click', intent: step.intent }),
    provenance: 'quoted-match' as const,
  };
  const snapshot = { accessibilityTree: neighborTree(options.change), screenshot: new Uint8Array([1]) };
  const live = liveEntries([RELAX_REF], observation(snapshot.accessibilityTree).fingerprint);
  const session = createFakeBrowserSession(live, { snapshot, accessibilityCapture: { rawYaml: 'stable-submit', scalarValues: [] } });
  const executor = createFakeAiExecutor({ execute: async () => ({ data: { proposal: { outcome: 'found', role: 'button', name: 'Submit' } }, raw: '{}' }) });
  const scenario = createScenario({ clock, ...(options.controller ? { signal: options.controller.signal } : {}),
    uiExecutor: () => createFakeUiExecutor(() => session),
    resolveAiExecutor: vi.fn(async () => executor),
  });
  const deps = { ...scenario.deps, config: { ...scenario.deps.config, targets: {
    web: { ...RESOLVED_TARGETS.web, resolveTimeoutMs: options.timeout ?? 5000 },
  } } };
  const path = await writePrompt(deps.storage, 'login.test.md', '# Submit\n\nClick "Submit".\n');
  const entries = GroundingDocument.shape.entries.parse(options.missingEntry ? {} : { click: stored });
  await seedFreshArtifacts(deps.storage, path, [step], entries);
  const groundingPath = deps.layout.groundingPathFor(path);
  const before = await deps.storage.readText(groundingPath);
  scenario.recordingStorage.writes.length = 0;
  const presence = vi.spyOn(session, 'awaitElementPresence');
  const perform = vi.spyOn(session, 'perform');
  const rawSnapshot = session.accessibilitySnapshot.bind(session);
  const snapshots = vi.spyOn(session, 'accessibilitySnapshot');
  const verifyTimes: number[] = [];
  const trace: string[] = [];
  // Replacement observations (made while choosing a target) and diagnostic observations
  // (made after a failure to describe it) are told apart by the calling phase: only the
  // diagnostic capture runs inside captureObservedEvidence.
  const observations: { phase: 'replacement' | 'diagnostic'; aborted: boolean; verifyTimes: number[] }[] = [];
  const observe = (impl: () => ReturnType<typeof rawSnapshot> = rawSnapshot) => snapshots.mockImplementation(async () => {
    observations.push({
      phase: /captureObservedEvidence/.test(new Error().stack ?? '') ? 'diagnostic' : 'replacement',
      aborted: options.controller?.signal.aborted ?? false,
      verifyTimes: [...verifyTimes],
    });
    return impl();
  });
  const original = session.resolveGrounded.bind(session);
  const resolveGrounded = vi.spyOn(session, 'resolveGrounded').mockImplementation(async (ref, query) => {
    trace.push(query.mode);
    if (query.mode === 'verify') verifyTimes.push(clock.monotonicMs());
    return original(ref, query);
  });
  return { ...scenario, deps, clock, session, stored, snapshot, live, executor, presence, perform, snapshots,
    resolveGrounded, verifyTimes, trace, before, groundingPath, observations, observe,
    change(change: Record<string, string | boolean> = {}) {
      snapshot.accessibilityTree = neighborTree(change);
      live.get(elementRefKey(RELAX_REF))!.currentFingerprint = observation(snapshot.accessibilityTree).fingerprint;
    },
    script(results: readonly Miss[]) {
      for (const result of results) resolveGrounded.mockResolvedValueOnce(result);
    },
    read: async () => GroundingDocument.parse(JSON.parse(await deps.storage.readText(groundingPath))),
    async unchanged() {
      expect(await deps.storage.readText(groundingPath)).toBe(before);
      expect(scenario.recordingStorage.writes.filter(write => write.path === groundingPath)).toEqual([]);
    },
    async execute(resolve = options.resolve ?? false) {
      const outcome = await run(deps, { ...DEFAULT_OPTIONS, resolve, updateCache: resolve });
      const report = buildRunReport({ startedAt: '2026-11-27T00:00:00Z', durationMs: clock.monotonicMs(), options: DEFAULT_OPTIONS, outcome });
      assertDiagnosable(report.envelope);
      if (executor.structuredRequests.length === 0) assertZeroAiCalls(report.envelope);
      return { outcome, report, result: outcome.results[0]!.result, step: outcome.results[0]!.result.steps[0]! };
    },
  };
}

describe('stored entry verification deadlines', () => {
  it('TEST-WAIT-1 accepts the first hit without polling or replacement observations', async () => {
    const f = await fixture();
    const result = await f.execute();
    expect(result.result.status).toBe('passed');
    expect(f.resolveGrounded).toHaveBeenCalledTimes(1);
    expect(f.clock.sleepCalls).toEqual([]);
    expect(f.snapshots).not.toHaveBeenCalled();
  });

  it('TEST-WAIT-1 waits once for presence using the remaining step budget', async () => {
    const f = await fixture({ timeout: 300 });
    await f.execute();
    expect(f.presence.mock.calls).toEqual([[RELAX_REF, 300]]);
  });

  it.each([
    { timeout: 300, presenceMs: 0, times: [0, 100, 200, 300], sleeps: [100, 100, 100] },
    { timeout: 250, presenceMs: 0, times: [0, 100, 200, 250], sleeps: [100, 100, 50] },
    { timeout: 200, presenceMs: 175, times: [175, 200], sleeps: [25] },
    { timeout: 200, presenceMs: 200, times: [200], sleeps: [] },
    { timeout: 5000, presenceMs: 0, times: Array.from({ length: 51 }, (_, i) => i * 100), sleeps: Array<number>(50).fill(100) },
  ])('TEST-WAIT-2 shares a $timeout ms deadline after $presenceMs ms of presence waiting', async ({ timeout, presenceMs, times, sleeps }) => {
    const f = await fixture({ timeout, ignored: ['parent'], change: { parentRole: 'form' } });
    f.presence.mockImplementation(async () => { if (presenceMs) await f.clock.sleep(presenceMs); });
    await f.execute();
    expect(f.verifyTimes).toEqual(times);
    expect(f.clock.sleepCalls).toEqual(presenceMs ? [presenceMs, ...sleeps] : sleeps);
    expect(f.presence.mock.calls).toEqual([[RELAX_REF, timeout]]);
    expect(f.resolveGrounded.mock.calls).toEqual(times.map(() => [RELAX_REF, {
      mode: 'verify', fingerprint: f.stored.fingerprint, components: f.stored.components, ignoredNames: ['parent'],
    }]));
    expect(f.perform).not.toHaveBeenCalled();
    await f.unchanged();
  });

  it.each([false, true])('TEST-WAIT-3 acts once on the delayed hit without AI (resolve=%s)', async resolve => {
    let elapsed = 0;
    let change = () => {};
    const f = await fixture({ change: { parentRole: 'form' }, elapsedOnSleep: ms => {
      elapsed += ms;
      if (elapsed >= 250) change();
      return ms;
    } });
    change = () => f.change();
    const result = await f.execute(resolve);
    expect(result.result.status).toBe('passed');
    expect(f.verifyTimes).toEqual([0, 100, 200, 300]);
    expect(f.perform).toHaveBeenCalledTimes(1);
    const hit = await f.resolveGrounded.mock.results[3]!.value as GroundedResolution;
    if (hit.kind !== 'hit') throw new Error('The deadline sample must hit.');
    expect(f.perform.mock.calls[0]![0]).toMatchObject({ type: 'click', target: hit.element });
    expect((f.perform.mock.calls[0]![0] as { target: unknown }).target).toBe(hit.element);
    expect(f.resolveAiExecutor).not.toHaveBeenCalled();
    expect(f.snapshots).not.toHaveBeenCalled();
    expect(result.step).toMatchObject({ binding: { confirmed: true, provenance: 'grounding' } });
    expect(f.events.emitted()).toContainEqual({ type: 'step-result', stepId: 'click', via: 'grounding' });
    const baseline = await fixture();
    expect(result.step.binding).toEqual((await baseline.execute()).step.binding);
    expect(JSON.stringify(result.report.envelope)).not.toContain('neighbor-name-ignored');
    expect((await f.read()).entries.click).not.toHaveProperty('ignoredNames');
    await f.unchanged();
  });

  it('TEST-WAIT-3 retains legacy evidence without backfilling components after a delayed hit', async () => {
    const f = await fixture({ timeout: 300, legacy: true });
    f.script([missing]);
    const result = await f.execute(true);
    expect(result.result.status).toBe('passed');
    expect(f.resolveGrounded).toHaveBeenCalledTimes(2);
    expect(result.step.binding).not.toHaveProperty('components');
    expect((await f.read()).entries.click).not.toHaveProperty('components');
    await f.unchanged();
  });

  it.each([
    'zero AI calls', 'one operation on the returned handle', 'unchanged grounding bytes',
    'grounding via', 'unchanged binding projection', 'no neighbor warning',
    'no replacement observation or additional exclusions',
  ])('TEST-WAIT-3 preserves %s after a delayed hit with resolve enabled', async property => {
    let elapsed = 0;
    let transition = () => {};
    const f = await fixture({ change: { siblingBefore: 'Transition' }, elapsedOnSleep: ms => {
      elapsed += ms;
      if (elapsed >= 250) transition();
      return ms;
    } });
    transition = () => f.change();
    const result = await f.execute(true);
    expect(f.verifyTimes).toEqual([0, 100, 200, 300]);
    expect(result.result.status).toBe('passed');
    switch (property) {
      case 'zero AI calls':
        assertZeroAiCalls(result.report.envelope);
        expect(f.resolveAiExecutor).not.toHaveBeenCalled();
        break;
      case 'one operation on the returned handle': {
        const hit = await f.resolveGrounded.mock.results[3]!.value as GroundedResolution;
        if (hit.kind !== 'hit') throw new Error('The final verification must hit.');
        expect(f.perform).toHaveBeenCalledTimes(1);
        expect((f.perform.mock.calls[0]![0] as { target: unknown }).target).toBe(hit.element);
        break;
      }
      case 'unchanged grounding bytes':
        await f.unchanged();
        break;
      case 'grounding via':
        expect(f.events.emitted()).toContainEqual({ type: 'step-result', stepId: 'click', via: 'grounding' });
        break;
      case 'unchanged binding projection': {
        const baseline = await fixture();
        expect(result.step.binding).toEqual((await baseline.execute()).step.binding);
        break;
      }
      case 'no neighbor warning':
        expect(JSON.stringify(result.report.envelope)).not.toContain('neighbor-name-ignored');
        break;
      case 'no replacement observation or additional exclusions':
        expect(f.snapshots).not.toHaveBeenCalled();
        expect((await f.read()).entries.click).not.toHaveProperty('ignoredNames');
        break;
    }
  });

  it.each([100, 107])('TEST-WAIT-4 accepts a hit after a final wait advancing %i ms', async elapsed => {
    const f = await fixture({ timeout: 100, elapsedOnSleep: () => elapsed });
    f.script([missing]);
    expect((await f.execute()).result.status).toBe('passed');
    expect(f.verifyTimes).toEqual([elapsed]);
    expect(f.resolveGrounded).toHaveBeenCalledTimes(2);
    expect(f.clock.sleepCalls).toEqual([100]);
    expect(f.perform).toHaveBeenCalledTimes(1);
  });

  it.each([
    { name: 'missing', misses: [missing, missing, missing] },
    { name: 'ambiguous', misses: [ambiguous, ambiguous, ambiguous] },
    { name: 'invalid', misses: [invalid, invalid, invalid] },
    { name: 'changing', misses: [mismatch, ambiguous, ambiguous] },
  ])('TEST-WAIT-5 retries $name evidence and acts only on the fourth hit', async ({ misses }) => {
    const f = await fixture({ timeout: 300 });
    const original = f.resolveGrounded.getMockImplementation()!;
    f.resolveGrounded.mockImplementation(async (ref, query) => {
      const index = f.resolveGrounded.mock.calls.length - 1;
      expect(f.perform).not.toHaveBeenCalled();
      if (index < misses.length) return misses[index]!;
      return original(ref, query);
    });
    expect((await f.execute()).result.status).toBe('passed');
    expect(f.resolveGrounded).toHaveBeenCalledTimes(4);
    expect(f.clock.sleepCalls).toEqual([100, 100, 100]);
    expect(f.perform).toHaveBeenCalledTimes(1);
    const hit = await f.resolveGrounded.mock.results[3]!.value as GroundedResolution;
    expect(hit.kind).toBe('hit');
    if (hit.kind === 'hit') expect((f.perform.mock.calls[0]![0] as { target: unknown }).target).toBe(hit.element);
  });

  it.each([
    { name: 'neighbor names', earlier: mismatch, last: neighborMiss },
    { name: 'missing element', earlier: neighborMiss, last: missing },
    { name: 'ambiguous element', earlier: mismatch, last: ambiguous },
    { name: 'invalid snapshot', earlier: neighborMiss, last: invalid },
  ])('TEST-WAIT-6 reports only the final $name evidence without binding or mutation', async ({ earlier, last }) => {
    const baseline = await fixture({ timeout: 0 });
    baseline.script([last]);
    const single = await baseline.execute();
    const f = await fixture({ timeout: 300 });
    f.script([earlier, earlier, earlier, last]);
    const result = await f.execute();
    expect(f.resolveGrounded).toHaveBeenCalledTimes(4);
    expect(result.report.exitCode).toBe(4);
    expect(result.report.envelope.errors).toEqual(single.report.envelope.errors);
    expect(result.outcome.results[0]!.error).toMatchObject({ details: { reason: 'recoverable-miss', verification: last.reason } });
    const details = (result.outcome.results[0]!.error as unknown as { details: Record<string, unknown> }).details;
    if (last === neighborMiss) expect(details).toMatchObject({ difference: 'neighbor-names', changedNames: ['siblingBefore'] });
    else {
      expect(details).not.toHaveProperty('difference');
      expect(details).not.toHaveProperty('changedNames');
    }
    expect(result.step).not.toHaveProperty('binding');
    expect(f.perform).not.toHaveBeenCalled();
    expect(f.resolveAiExecutor).not.toHaveBeenCalled();
    await f.unchanged();
  });

  it('TEST-WAIT-7 never operates on a persistently mismatching page', async () => {
    const f = await fixture({ timeout: 300, change: { siblingBefore: 'Other page' } });
    const result = await f.execute();
    expect(f.verifyTimes).toEqual([0, 100, 200, 300]);
    expect(result.report.exitCode).toBe(4);
    expect(f.perform).not.toHaveBeenCalled();
  });

  it.each([false, true])('TEST-WAIT-8 verifies once with zero budget (resolve=%s)', async resolve => {
    const f = await fixture({ timeout: 0, change: { parentRole: 'form' } });
    const result = await f.execute(resolve);
    expect(f.trace.filter(mode => mode === 'verify')).toHaveLength(resolve ? 2 : 1);
    expect(f.clock.sleepCalls).toEqual([]);
    if (resolve) {
      expect(result.result.status).toBe('passed');
      expect(result.step.binding).toMatchObject({ provenance: 'quoted-match', quoteWaitMs: 0 });
      expect(f.snapshots).toHaveBeenCalledTimes(1);
    } else {
      expect(result.report.exitCode).toBe(4);
      expect(f.perform).not.toHaveBeenCalled();
      await f.unchanged();
    }
  });

  it.each([true, false])('TEST-WAIT-9 defers replacement until expiry (quoted=%s)', async quoted => {
    const f = await fixture({ timeout: 300, quoted, change: { parentRole: 'form' } });
    const original = f.resolveGrounded.getMockImplementation()!;
    let storedChecks = 0;
    let replacing = false;
    f.snapshots.mockImplementation(async () => {
      replacing = true;
      expect(storedChecks).toBe(4);
      expect(f.clock.monotonicMs()).toBe(300);
      return { rawYaml: 'stable-submit', scalarValues: [], tree: f.snapshot.accessibilityTree };
    });
    f.resolveGrounded.mockImplementation(async (ref, query) => {
      if (!replacing) {
        storedChecks++;
        expect(f.snapshots).not.toHaveBeenCalled();
        expect(f.resolveAiExecutor).not.toHaveBeenCalled();
        expect(f.perform).not.toHaveBeenCalled();
        expect(f.recordingStorage.writes.filter(write => write.path === f.groundingPath)).toEqual([]);
      }
      return original(ref, query);
    });
    const result = await f.execute(true);
    expect(result.result.status).toBe('passed');
    expect(storedChecks).toBe(4);
    expect(f.snapshots).toHaveBeenCalledTimes(1);
    expect(f.executor.structuredRequests).toHaveLength(quoted ? 0 : 1);
    expect(result.step.binding).toMatchObject({ provenance: quoted ? 'quoted-match' : 'ai-proposed', quoteWaitMs: 0 });
    if (!quoted) expect(f.executor.structuredRequests[0]!.context).toMatchObject({ accessibilityTree: f.snapshot.accessibilityTree });
  });

  it('TEST-WAIT-9 aborts an invalid replacement observation without AI', async () => {
    const f = await fixture({ timeout: 300, change: { parentRole: 'form' } });
    f.observe(async () => ({ rawYaml: 'invalid', scalarValues: [], tree: SNAPSHOT_INVALID }));
    const result = await f.execute(true);
    // Exactly one replacement observation, made after the last stored verification; the
    // failure diagnostics that follow are not part of this count.
    const replacement = f.observations.filter(observation => observation.phase === 'replacement');
    expect(replacement).toHaveLength(1);
    expect(replacement[0]!.verifyTimes).toEqual([0, 100, 200, 300]);
    expect(result.report.exitCode).toBe(3);
    expect(result.outcome.results[0]!.error).toMatchObject({ details: { reason: 'grounding-snapshot-invalid' } });
    expect(f.clock.sleepCalls).toEqual([100, 100, 100]);
    expect(f.resolveAiExecutor).not.toHaveBeenCalled();
    expect(f.perform).not.toHaveBeenCalled();
    await f.unchanged();
  });

  it('TEST-WAIT-9 gives replacement its remaining millisecond after an early final wait', async () => {
    let sleeps = 0;
    const f = await fixture({ timeout: 100, quoted: false, change: { parentRole: 'form' }, elapsedOnSleep: ms => ++sleeps === 1 ? 99 : ms });
    const result = await f.execute(true);
    expect(result.result.status).toBe('passed');
    expect(f.verifyTimes).toEqual([0, 99, 100]);
    expect(f.clock.sleepCalls).toEqual([100, 1]);
    expect(f.snapshots).toHaveBeenCalledTimes(2);
    expect(result.step.binding).toMatchObject({ quoteWaitMs: 1, provenance: 'ai-proposed' });
    expect(f.executor.structuredRequests).toHaveLength(1);
  });

  it.each([
    { name: 'last mismatch', results: [ambiguous, ambiguous, ambiguous, neighborMiss], ignored: undefined, expected: ['siblingBefore'] },
    { name: 'last missing', results: [neighborMiss, neighborMiss, neighborMiss, missing], ignored: undefined, expected: undefined },
    { name: 'retained exclusions', results: [neighborMiss, neighborMiss, neighborMiss, neighborMiss], ignored: ['parent'] as FingerprintNameSlot[], expected: ['parent', 'siblingBefore'] },
  ])('TEST-WAIT-10 learns exclusions from $name only', async ({ results, ignored, expected }) => {
    const f = await fixture({ timeout: 300, change: { siblingBefore: 'Beta' }, ...(ignored ? { ignored } : {}) });
    // The scripted misses are served by index here rather than through the once-queue,
    // because getMockImplementation may report a queued once-implementation and a queued
    // result would bypass the entry assertions below.
    const passThrough = f.resolveGrounded.getMockImplementation()!;
    const queries: { query: unknown; copy: unknown }[] = [];
    let replacing = false;
    f.snapshots.mockImplementation(async () => {
      replacing = true;
      return { rawYaml: 'stable-submit', scalarValues: [], tree: f.snapshot.accessibilityTree };
    });
    // Before replacement every verification entry must see the stored entry and the whole
    // query exactly as recorded, with no grounding write and no replacement observation:
    // learned names may be added only after the final verification.
    f.resolveGrounded.mockImplementation(async (ref, query) => {
      if (!replacing) {
        expect(query).toEqual({
          mode: 'verify', fingerprint: f.stored.fingerprint, components: f.stored.components,
          ...(ignored ? { ignoredNames: ignored } : {}),
        });
        for (const seen of queries) expect(seen.query).toEqual(seen.copy);
        queries.push({ query, copy: structuredClone(query) });
        expect(await f.deps.storage.readText(f.groundingPath)).toBe(f.before);
        expect(f.recordingStorage.writes.filter(write => write.path === f.groundingPath)).toEqual([]);
        expect(f.snapshots).not.toHaveBeenCalled();
      }
      return replacing ? passThrough(ref, query) : results[queries.length - 1]!;
    });
    const result = await f.execute(true);
    expect(result.result.status).toBe('passed');
    expect(queries).toHaveLength(4);
    expect(f.resolveGrounded.mock.calls.slice(0, 4).map(call => call[1].mode)).toEqual(['verify', 'verify', 'verify', 'verify']);
    expect(f.clock.sleepCalls).toEqual([100, 100, 100]);
    const saved = (await f.read()).entries.click;
    if (expected) expect(saved).toHaveProperty('ignoredNames', expected);
    else expect(saved).not.toHaveProperty('ignoredNames');
  });

  it('TEST-WAIT-10 does not learn additional exclusions from an intermediate hit', async () => {
    const f = await fixture({ timeout: 300, ignored: ['siblingBefore'], change: { siblingBefore: 'Beta' } });
    f.script([ambiguous]);
    const result = await f.execute(true);
    expect(result.result.status).toBe('passed');
    expect(f.resolveGrounded).toHaveBeenCalledTimes(2);
    expect(f.snapshots).not.toHaveBeenCalled();
    expect((await f.read()).entries.click).toEqual(f.stored);
    await f.unchanged();
  });

  it('TEST-WAIT-11 propagates the second verification exception without a third attempt', async () => {
    const f = await fixture({ timeout: 300 });
    const fault = new Error('Stored verification transport failed.');
    f.resolveGrounded.mockResolvedValueOnce(missing).mockRejectedValueOnce(fault);
    const result = await f.execute(true);
    expect(f.resolveGrounded).toHaveBeenCalledTimes(2);
    expect(result.outcome.results[0]!.error).toMatchObject({ kind: 'unexpected-crash', cause: fault });
    expect(result.outcome.results[0]!.error?.cause).toBe(fault);
    expect(f.clock.sleepCalls).toEqual([100]);
    expect(f.perform).not.toHaveBeenCalled();
    expect(f.resolveAiExecutor).not.toHaveBeenCalled();
    expect(result.step).not.toHaveProperty('binding');
    await f.unchanged();
  });

  it('TEST-WAIT-11 propagates a presence exception without verification', async () => {
    const f = await fixture({ timeout: 300 });
    const fault = new Error('Presence transport failed.');
    f.presence.mockRejectedValueOnce(fault);
    const result = await f.execute(true);
    expect(result.outcome.results[0]!.error).toMatchObject({ kind: 'unexpected-crash', cause: fault });
    expect(result.outcome.results[0]!.error?.cause).toBe(fault);
    expect(f.resolveGrounded).not.toHaveBeenCalled();
    expect(f.clock.sleepCalls).toEqual([]);
    expect(f.perform).not.toHaveBeenCalled();
    expect(result.step).not.toHaveProperty('binding');
    await f.unchanged();
  });

  it.each(['reverification', 'operation'] as const)('TEST-WAIT-11 does not retry a delayed hit after %s failure', async failure => {
    const fault = failure === 'reverification'
      ? new BoundElementRejectedError('fingerprint-verification-failed', 'The bound descriptor changed.')
      : new Error('The click operation failed.');
    const baseline = await fixture({ timeout: 300 });
    baseline.perform.mockRejectedValueOnce(fault);
    const single = await baseline.execute();
    const f = await fixture({ timeout: 300 });
    f.script([missing]);
    f.perform.mockRejectedValueOnce(fault);
    const result = await f.execute();
    expect(f.resolveGrounded).toHaveBeenCalledTimes(2);
    expect(f.perform).toHaveBeenCalledTimes(1);
    expect(f.clock.sleepCalls).toEqual([100]);
    expect(result.step.binding).toEqual(single.step.binding);
    expect(result.step.binding).toBeDefined();
    expect(result.report.exitCode).toBe(single.report.exitCode);
    expect(result.outcome.results[0]!.error).toMatchObject({ kind: 'unexpected-crash', cause: fault });
    expect(result.outcome.results[0]!.error?.cause).toBe(fault);
    await f.unchanged();
  });

  it.each([false, true])('TEST-WAIT-12 stops during verification sleep (resolve=%s)', async resolve => {
    const controller = new AbortController();
    const f = await fixture({ timeout: 300, controller, change: { parentRole: 'form' }, elapsedOnSleep: ms => {
      controller.abort(new Error('Test cancellation.'));
      return ms;
    } });
    f.observe();
    const result = await f.execute(resolve);
    expect(f.resolveGrounded).toHaveBeenCalledTimes(1);
    expect(f.clock.sleepCalls).toEqual([100]);
    // Diagnostic observations after the interruption keep their current behavior.
    expect(f.observations.filter(observation => observation.phase === 'replacement')).toEqual([]);
    expect(f.perform).not.toHaveBeenCalled();
    expect(f.resolveAiExecutor).not.toHaveBeenCalled();
    expect(result.result).toMatchObject({ status: 'error', explanation: 'The run was interrupted.' });
    expect(result.outcome.results[0]!.error).toBeUndefined();
    expect(result.report.exitCode).toBe(3);
    expect(result.report.envelope.errors).toContainEqual(expect.objectContaining({ scope: 'run', code: 'INTERRUPTED' }));
    expect(result.step).not.toHaveProperty('binding');
    await f.unchanged();
  });

  it.each([false, true])('TEST-WAIT-12 checks cancellation after presence before the first verify (resolve=%s)', async resolve => {
    const controller = new AbortController();
    const f = await fixture({ timeout: 300, controller });
    f.presence.mockImplementation(async () => { controller.abort(new Error('Presence cancellation.')); });
    f.observe();
    const result = await f.execute(resolve);
    expect(f.presence).toHaveBeenCalledTimes(1);
    expect(f.resolveGrounded).not.toHaveBeenCalled();
    expect(f.observations.filter(observation => observation.phase === 'replacement')).toEqual([]);
    expect(f.perform).not.toHaveBeenCalled();
    expect(f.resolveAiExecutor).not.toHaveBeenCalled();
    expect(f.clock.sleepCalls).toEqual([]);
    expect(result.result).toMatchObject({ status: 'error', explanation: 'The run was interrupted.' });
    expect(result.report.exitCode).toBe(3);
    expect(result.step).not.toHaveProperty('binding');
    await f.unchanged();
  });

  it.each(['absent', 'different intent'] as const)('TEST-WAIT-13 stops immediately for %s stored evidence without resolve', async kind => {
    const f = await fixture({ missingEntry: kind === 'absent', wrongIntent: kind === 'different intent' });
    const result = await f.execute();
    expect(result.outcome.results[0]!.error).toMatchObject({ details: { reason: 'missing' } });
    expect(result.report.exitCode).toBe(4);
    expect(f.clock.sleepCalls).toEqual([]);
    expect(f.presence).not.toHaveBeenCalled();
    expect(f.resolveGrounded).not.toHaveBeenCalled();
    expect(result.step).not.toHaveProperty('binding');
    await f.unchanged();
  });

  it.each(['absent', 'different intent'] as const)('TEST-WAIT-13 starts normal first binding for %s stored evidence with resolve', async kind => {
    const f = await fixture({ missingEntry: kind === 'absent', wrongIntent: kind === 'different intent' });
    const result = await f.execute(true);
    expect(result.result.status).toBe('passed');
    expect(f.presence).not.toHaveBeenCalled();
    // The sole verify confirms the newly observed candidate; no stored verify precedes it.
    expect(f.trace).toEqual(['verify']);
    expect(f.snapshots).toHaveBeenCalledTimes(1);
    expect(f.clock.sleepCalls).toEqual([]);
    expect(result.step.binding).toMatchObject({ provenance: 'quoted-match' });
    expect(f.perform).toHaveBeenCalledTimes(1);
  });
});
