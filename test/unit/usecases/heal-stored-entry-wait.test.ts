/**
 * Stored-entry waiting must consume heal's case budget because replay and
 * repair share elapsed time. Otherwise a slow baseline could admit repair
 * after the case deadline, hiding the cost of waiting behind a fresh budget.
 * TEST-WAIT-14 also protects waiting in resolve-enabled replays: a later
 * stored hit must avoid an unnecessary provider dispatch.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { heal } from '#usecases/heal.js';
import * as runModule from '#usecases/run.js';
import { createFixedClock } from '../../doubles/create-fixed-clock.js';
import { createFakeAiExecutor } from '../../doubles/fake-ai-executor.js';
import { createFakeBrowserSession, elementRefKey } from '../../doubles/fake-browser-session.js';
import { createFakeUiExecutor } from '../../doubles/fake-ui-executor.js';
import * as healing from '../../support/heal-scenario.js';

afterEach(() => vi.restoreAllMocks());

async function fixture(caseTimeoutMs: number, resolveTimeoutMs = 5000, appearsAt?: number) {
  const entry = { exists: false, currentFingerprint: healing.FINGERPRINT };
  const entries = new Map([[elementRefKey(healing.SUBMIT), entry]]);
  let elapsed = 0;
  const clock = createFixedClock(new Date('2026-11-27T00:00:00.000Z'), 0, ms => {
    elapsed += ms;
    if (appearsAt !== undefined && elapsed >= appearsAt) entry.exists = true;
    return ms;
  });
  // A refused proposal keeps admission observable without manufacturing a
  // successful repair or spending virtual time inside provider execution.
  const executor = createFakeAiExecutor({
    execute: async () => ({ data: { proposal: { outcome: 'none' } }, raw: '{"proposal":{"outcome":"none"}}' }),
  });
  const execute = vi.spyOn(executor, 'execute');
  const executeAgentic = vi.spyOn(executor, 'executeAgentic');
  const sessions: { verifyTimes: number[]; perform: ReturnType<typeof vi.spyOn> }[] = [];
  const scenario = await healing.createScenario({
    sessionEntries: entries,
    aiExecutor: executor,
    uiExecutor: () => createFakeUiExecutor(() => {
      const session = createFakeBrowserSession(entries, {
        baseUrl: healing.TARGETS.web.baseUrl,
        currentUrl: healing.TARGETS.web.baseUrl,
        snapshot: healing.healSnapshot(entries),
      });
      const verifyTimes: number[] = [];
      const resolve = session.resolveGrounded.bind(session);
      vi.spyOn(session, 'resolveGrounded').mockImplementation(async (ref, query) => {
        if (query.mode === 'verify') verifyTimes.push(clock.monotonicMs());
        return resolve(ref, query);
      });
      sessions.push({ verifyTimes, perform: vi.spyOn(session, 'perform') });
      return session;
    }),
  });
  const path = scenario.deps.layout.groundingPathFor(healing.OPTIONS.files[0]!);
  const original = await scenario.storage.readText(path);
  const replays: { resolve: boolean; start: number; end: number; before: string; after: string }[] = [];
  // The storage each replay actually received: after heal returns, the overlay itself must still hold the original bytes.
  const overlays: typeof scenario.deps.storage[] = [];
  const actualRun = runModule.run;
  vi.spyOn(runModule, 'run').mockImplementation(async (deps, options) => {
    overlays.push(deps.storage);
    const start = clock.monotonicMs();
    const before = await deps.storage.readText(path);
    const result = await actualRun(deps, options);
    replays.push({ resolve: options.resolve, start, end: clock.monotonicMs(), before, after: await deps.storage.readText(path) });
    return result;
  });
  const deps = {
    ...scenario.deps,
    clock,
    config: {
      ...scenario.deps.config,
      targets: { web: { ...healing.RESOLVED_TARGETS.web, resolveTimeoutMs } },
      heal: { caseTimeoutMs, maxStepRepairs: 1 },
    },
  };
  return { ...scenario, deps, clock, original, path, replays, overlays, sessions, execute, executeAgentic };
}

async function expectOverlaysUnchanged(f: Awaited<ReturnType<typeof fixture>>) {
  expect(f.overlays.length).toBeGreaterThan(0);
  for (const overlay of f.overlays) expect(await overlay.readText(f.path)).toBe(f.original);
}

describe('TEST-WAIT-14 heal stored-entry waiting', () => {
  it.each([
    { caseTimeoutMs: 3000, resolveTimeoutMs: 5000 },
    { caseTimeoutMs: 5000, resolveTimeoutMs: 5000 },
    { caseTimeoutMs: 60000, resolveTimeoutMs: 60000 },
  ])('denies repair after the baseline wait with caseTimeoutMs=$caseTimeoutMs and resolveTimeoutMs=$resolveTimeoutMs', async ({ caseTimeoutMs, resolveTimeoutMs }) => {
    const f = await fixture(caseTimeoutMs, resolveTimeoutMs);
    const result = await heal(f.deps, healing.OPTIONS);

    expect(f.replays).toEqual([{ resolve: false, start: 0, end: resolveTimeoutMs, before: f.original, after: f.original }]);
    expect(f.clock.monotonicMs()).toBe(resolveTimeoutMs);
    expect(f.clock.sleepCalls).toEqual(Array.from({ length: resolveTimeoutMs / 100 }, () => 100));
    expect(f.sessions[0]?.verifyTimes).toEqual(Array.from({ length: resolveTimeoutMs / 100 + 1 }, (_, i) => i * 100));
    expect(f.sessions.every(session => session.perform.mock.calls.length === 0)).toBe(true);
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.executeAgentic).not.toHaveBeenCalled();
    expect(f.deps.resolveAiExecutor).not.toHaveBeenCalled();
    expect(result.outcome.results[0]).toMatchObject({ repairOutcome: 'unresolved', stopReason: 'deadline', finalFirstFailureIndex: 0, repairTrace: [], aiCalls: 0 });
    expect(result.commits.size).toBe(0);
    expect(await f.storage.readText(f.path)).toBe(f.original);
    await expectOverlaysUnchanged(f);
  });

  it.each([
    { caseTimeoutMs: 300000, resolveTimeoutMs: 5000 },
    { caseTimeoutMs: 5001, resolveTimeoutMs: 5000 },
    { caseTimeoutMs: 60001, resolveTimeoutMs: 60000 },
  ])('admits repair after the baseline wait with caseTimeoutMs=$caseTimeoutMs and resolveTimeoutMs=$resolveTimeoutMs', async ({ caseTimeoutMs, resolveTimeoutMs }) => {
    const f = await fixture(caseTimeoutMs, resolveTimeoutMs);
    const result = await heal(f.deps, healing.OPTIONS);

    expect(f.replays[0]).toEqual({ resolve: false, start: 0, end: resolveTimeoutMs, before: f.original, after: f.original });
    expect(f.replays[1]).toMatchObject({ resolve: true, start: resolveTimeoutMs, end: resolveTimeoutMs * 2, before: f.original });
    // Each replay pays its own wait; admission does not erase the stored miss.
    expect(f.sessions[1]?.verifyTimes).toEqual(Array.from({ length: resolveTimeoutMs / 100 + 1 }, (_, i) => resolveTimeoutMs + i * 100));
    if (caseTimeoutMs === 300000) {
      expect(f.execute).toHaveBeenCalled();
    } else {
      // The phase was admitted with one millisecond left, but its replay
      // exhausts that remainder before a provider dispatch can be admitted.
      expect(f.execute).not.toHaveBeenCalled();
      expect(f.executeAgentic).not.toHaveBeenCalled();
      expect(result.outcome.results[0]).toMatchObject({ repairOutcome: 'unresolved', stopReason: 'deadline', aiCalls: 0 });
      expect(result.commits.size).toBe(0);
    }
    expect(await f.storage.readText(f.path)).toBe(f.original);
    await expectOverlaysUnchanged(f);
  });

  it('uses a delayed stored hit in the repair replay without dispatching AI for the step', async () => {
    const f = await fixture(300000, 5000, 5250);
    const result = await heal(f.deps, healing.OPTIONS);

    expect(f.replays).toEqual([
      { resolve: false, start: 0, end: 5000, before: f.original, after: f.original },
      { resolve: true, start: 5000, end: 5300, before: f.original, after: f.original },
    ]);
    expect(f.sessions[1]?.verifyTimes).toEqual([5000, 5100, 5200, 5300]);
    expect(f.sessions[0]?.perform).not.toHaveBeenCalled();
    expect(f.sessions[1]?.perform).toHaveBeenCalledTimes(1);
    expect(f.clock.monotonicMs()).toBe(5300);
    expect(f.clock.sleepCalls).toEqual(Array.from({ length: 53 }, () => 100));
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.executeAgentic).not.toHaveBeenCalled();
    expect(f.deps.resolveAiExecutor).not.toHaveBeenCalled();
    expect(result.outcome.results[0]).toMatchObject({ repairOutcome: 'healed', stopReason: 'settled', finalFirstFailureIndex: 1, aiCalls: 0 });
    expect(result.outcome.results[0]?.steps[0]).toMatchObject({ status: 'passed', binding: { provenance: 'grounding' } });
    expect(await f.storage.readText(f.path)).toBe(f.original);
    await expectOverlaysUnchanged(f);
  });
});
