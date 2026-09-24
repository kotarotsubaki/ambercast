import { describe, expect, it, vi } from 'vitest';
import { createCallIdAllocator } from '#core/ai/call-id-allocator.js';
import { IntegrityViolationError } from '#core/errors/integrity-violation-error.js';
import { promptTemplateFingerprint } from '#core/ai/prompt-envelope.js';
import { planProducerBundleFingerprint } from '#core/ai/plan-producer-bundle.js';
import { toCanonicalArtifactText } from '#core/ir/canonical-json.js';
import { computeInputsDigest, computePlanDigest } from '#core/ir/digest.js';
import { normalizeTestMd } from '#core/ir/normalize.js';
import type { JsonValueT, TargetDefinition } from '#core/ir/schema.js';
import { createLayoutResolver } from '#core/layout/resolve.js';
import { run, type RunDeps } from '#usecases/run.js';
import { createFixedClock } from '../../doubles/create-fixed-clock.js';
import { createInMemoryStorage } from '../../doubles/create-in-memory-storage.js';
import { createRecordingEventSink } from '../../doubles/create-recording-event-sink.js';
import { createFakeBrowserDriver } from '../../doubles/fake-browser-driver.js';
import { awaitElementPresenceCalls, createFakeBrowserSession, elementRefKey, type FakeBrowserSession } from '../../doubles/fake-browser-session.js';
import { createFakeSecretsProvider } from '../../doubles/fake-secrets-provider.js';
import { createFakeAiExecutor } from '../../doubles/fake-ai-executor.js';
import { expectSecretSinkOriginViolation } from '../../doubles/expect-secret-sink-origin-violation.js';
import type { BrowserSession } from '#ports/browser.js';

const ROOT = '/multi-target';
const FILE = `${ROOT}/case.test.md`;
const PROMPT = '# Multi target\n\nThe dashboard is visible.\n';
const REF = { strategy: 'accessibility' as const, role: 'textbox', name: 'Value' };
const SECRET_REF = '{{secrets.TOKEN}}';
const FINGERPRINT = { algorithm: 'a11y-neighborhood-v2' as const, hash: 'a'.repeat(64) };
const definitions = {
  A: { surface: 'web', baseUrl: 'https://a.example.test' },
  B: { surface: 'web', baseUrl: 'https://b.example.test' },
  C: { surface: 'web', baseUrl: 'https://c.example.test' },
} as const;
const configs = Object.fromEntries(Object.entries(definitions).map(([name, target], index) => [name, {
  ...target, browser: 'chromium', resolveTimeoutMs: 111 + index * 111, healReplayIsolation: 'stateful',
}])) as RunDeps['config']['targets'];
type TestStep = Record<string, unknown> & { id: string; target: 'A' | 'B' | 'C' };

function action(id: string, target: TestStep['target'], kind: string, extra: Record<string, unknown> = {}): TestStep {
  return { id, target, kind: 'action', action: kind, ...extra };
}
function assertion(id: string, target: TestStep['target'], check: string, timeoutMs: number, extra: Record<string, unknown> = {}): TestStep {
  return { id, target, kind: 'assert', check, timeoutMs, ...extra };
}
function capture(id: string, target: TestStep['target'], variable: string): TestStep {
  return { id, target, kind: 'capture', element: REF, variable };
}
function session(name: 'A' | 'B' | 'C', options: Parameters<typeof createFakeBrowserSession>[1] = {}): FakeBrowserSession {
  return createFakeBrowserSession(new Map([[elementRefKey(REF), { exists: true, currentFingerprint: FINGERPRINT }]]), {
    baseUrl: definitions[name].baseUrl,
    currentUrl: definitions[name].baseUrl,
    ...options,
  });
}

async function scenario(
  steps: TestStep[],
  sessions: Partial<Record<'A' | 'B' | 'C', FakeBrowserSession>>,
  options: { readonly abort?: AbortSignal; readonly launchError?: string; readonly advanceOnLaunchMs?: number; readonly targetConfigs?: RunDeps['config']['targets']; readonly resolveAiExecutor?: RunDeps['resolveAiExecutor'] } = {},
) {
  const storage = createInMemoryStorage();
  const layout = createLayoutResolver({ testDir: ROOT, runsDir: `${ROOT}/.runs` });
  const targetNames = [...new Set(steps.map((step) => step.target))].sort();
  const activeConfigs = options.targetConfigs ?? configs;
  const targets = Object.fromEntries(targetNames.map((name) => [name, {
    ...definitions[name],
    ...(activeConfigs[name]?.secretSinkOrigins === undefined ? {} : { secretSinkOrigins: activeConfigs[name]?.secretSinkOrigins }),
  }])) as unknown as Record<string, TargetDefinition>;
  const inputsDigest = computeInputsDigest({
    normalizedTestMd: normalizeTestMd(PROMPT),
    schemaVersion: 4,
    generatorPromptTemplateFingerprint: promptTemplateFingerprint(),
    planProducerBundleFingerprint: planProducerBundleFingerprint(),
    targetDefinitions: targets,
  });
  const plan = { schemaVersion: 4, source: { inputsDigest }, targets, steps };
  const entries = Object.fromEntries(steps.filter((step) => step.element !== undefined).map((step) => [step.id, {
    kind: 'element', fingerprint: FINGERPRINT,
  }]));
  const grounding = { schemaVersion: 2, planDigest: computePlanDigest(plan as never), entries };
  await storage.writeText(FILE, PROMPT);
  await storage.writeText(layout.planPathFor(FILE), toCanonicalArtifactText(plan as JsonValueT));
  const originalGrounding = toCanonicalArtifactText(grounding as JsonValueT);
  await storage.writeText(layout.groundingPathFor(FILE), originalGrounding);
  const clock = createFixedClock(new Date('2026-09-23T00:00:00Z'), 0);
  const events = createRecordingEventSink();
  const factories = Object.fromEntries(Object.entries(sessions).map(([name, value]) => [name, () => {
    if (name === options.launchError) throw new Error('launch failed');
    if (options.advanceOnLaunchMs !== undefined) void clock.sleep(options.advanceOnLaunchMs);
    return value as BrowserSession;
  }]));
  const driver = createFakeBrowserDriver(factories, targets);
  const deps: RunDeps = {
    storage,
    layout,
    clock,
    runId: '2026-09-23T000000Z-550e8400-e29b-41d4-a716-446655440000',
    browserDriver: () => driver,
    secrets: createFakeSecretsProvider(new Map([[SECRET_REF, 'secret-value']])),
    resolveAiExecutor: options.resolveAiExecutor ?? (async () => { throw new Error('AI must not run'); }),
    events: events.sink,
    discoverTestFiles: async () => [FILE],
    isCI: false,
    config: {
      testDir: ROOT, testMatch: ['**/*.test.md'], testIgnore: [], targets: configs, defaultTarget: 'A',
      ai: { provider: 'codex', timeoutMs: 120_000, maxGenerateAttempts: 2 },
      ci: { heal: false, updateGroundingCache: false },
      grounding: { repositoryPolicy: 'committed', localWriteBack: 'auto' },
      secrets: { allow: '*' },
      ...(options.targetConfigs === undefined ? {} : { targets: options.targetConfigs }),
    },
    allocateCallId: createCallIdAllocator(),
  };
  const outcome = await run(deps, {
    files: [FILE], resolve: options.resolveAiExecutor !== undefined, updateCache: false, allowEmpty: false, list: false, stale: 'fail',
    ...(options.abort === undefined ? {} : { signal: options.abort }),
  });
  return { outcome, driver, clock, storage, layout, events, originalGrounding, deps, plan };
}

describe('multi-target run contracts', () => {
  it('routes equal-baseUrl definitions by Target name', async () => {
    const sharedUrl = 'https://shared.example.test';
    const targetA = { surface: 'web', baseUrl: sharedUrl, description: 'A' } as unknown as TargetDefinition;
    const targetB = { surface: 'web', baseUrl: sharedUrl, description: 'B' } as unknown as TargetDefinition;
    const a = session('A');
    const b = session('B');
    const driver = createFakeBrowserDriver({ A: () => a, B: () => b }, { A: targetA, B: targetB });
    await expect(driver.launch(targetB)).resolves.toBe(b);
    await expect(driver.launch({ ...targetA })).resolves.toBe(a);
    expect(driver.launches).toEqual([targetB, targetA]);
  });

  it('TEST-22 resolves once, replays without AI, and polls on the separate B session', async () => {
    const firstA = session('A', { captureValues: new Map([[elementRefKey(REF), { text: 'created', value: 'created' }]]) });
    const firstB = session('B');
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        await request.controller.evaluateAssert({ type: 'assert', check: 'text-visible', text: 'ready' }, 'ready');
        return { outcome: 'success' };
      },
    });
    const steps: TestStep[] = [
      { id: 'make-value', target: 'A', kind: 'ai', instruction: 'Create a value.', instructionCoverage: [{
        id: 'ready', kind: 'success', sourceSpan: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 26 },
      }] },
      capture('read-value', 'A', 'x'),
      assertion('check-value', 'B', 'text-equals', 5000, { element: REF, text: '{{run.x}}' }),
    ];
    const first = await scenario(steps, { A: firstA, B: firstB }, { resolveAiExecutor: async () => executor });
    expect(first.outcome.results[0]?.result.status).toBe('passed');
    const updatedGrounding = await first.storage.readText(first.layout.groundingPathFor(FILE));
    expect(updatedGrounding).not.toBe(first.originalGrounding);
    expect(first.events.emitted().filter((event) => event.type === 'ai-call').length).toBeGreaterThanOrEqual(1);

    const secondA = session('A', { captureValues: new Map([[elementRefKey(REF), { text: 'created', value: 'created' }]]) });
    const secondB = session('B', { assertOutcomes: [{ passed: false, message: 'not yet' }, { passed: true }] });
    const replayDriver = createFakeBrowserDriver({ A: () => secondA, B: () => secondB }, definitions);
    const replayEvents = createRecordingEventSink();
    const replay = await run({ ...first.deps, browserDriver: () => replayDriver, events: replayEvents.sink }, {
      files: [FILE], resolve: false, updateCache: false, allowEmpty: false, list: false, stale: 'fail',
    });
    expect(replay.results[0]?.result).toMatchObject({ status: 'passed', aiCalls: 0 });
    expect(replayEvents.emitted().filter((event) => event.type === 'ai-call')).toEqual([]);
    expect(await first.storage.readText(first.layout.groundingPathFor(FILE))).toBe(updatedGrounding);
    expect(first.driver.launches.map((target) => target.baseUrl)).toEqual([definitions.A.baseUrl, definitions.B.baseUrl]);
    expect(replayDriver.launches.map((target) => target.baseUrl)).toEqual([definitions.A.baseUrl, definitions.B.baseUrl]);
    expect(firstA.operations().filter((operation) => operation.type === 'capture-value')).toHaveLength(1);
    expect(firstB.operations().filter((operation) => operation.type === 'capture-value')).toEqual([]);
    expect(secondA.operations().filter((operation) => operation.type === 'evaluate-assert').map((operation) => operation.check.check)).toEqual(['text-visible']);
    expect(secondB.operations().filter((operation) => operation.type === 'evaluate-assert')).toHaveLength(2);
    expect(secondB.bindCalls()).toBe(2);
    expect(first.clock.sleepCalls).toEqual([100]);
  });
  it('fixed clock records sleeps, advances monotonically, and rejects aborts', async () => {
    const clock = createFixedClock(new Date('2026-09-23T00:00:00Z'), 5);
    await clock.sleep(100);
    expect(clock.sleepCalls).toEqual([100]);
    expect(clock.monotonicMs()).toBe(105);
    const controller = new AbortController();
    controller.abort(new Error('interrupted'));
    await expect(clock.sleep(100, controller.signal)).rejects.toThrow('interrupted');
  });
  it('TEST-12 launches on first use, reuses each target session, and routes browser work by target', async () => {
    const a = session('A');
    const b = session('B');
    const { outcome, driver } = await scenario([
      action('a-nav', 'A', 'navigate', { url: '/start' }),
      action('b-nav', 'B', 'navigate', { url: '/start' }),
      action('a-click', 'A', 'click', { element: REF }),
      assertion('b-assert', 'B', 'text-equals', 0, { element: REF, text: 'Value' }),
      capture('a-capture', 'A', 'x'),
      action('b-fill', 'B', 'fill', { element: REF, value: '{{run.x}}' }),
    ], { A: a, B: b });
    expect(outcome.results[0]?.result.status).toBe('passed');
    expect(driver.launches.map((target) => target.baseUrl)).toEqual([definitions.A.baseUrl, definitions.B.baseUrl]);
    expect(a.operations().filter((operation) => operation.type === 'perform').map((operation) => operation.action.type)).toEqual(['navigate', 'click']);
    expect(b.operations().filter((operation) => operation.type === 'perform').map((operation) => operation.action.type)).toEqual(['navigate', 'fill']);
    expect(a.operations().filter((operation) => operation.type === 'capture-value')).toHaveLength(1);
    expect(b.operations().filter((operation) => operation.type === 'capture-value')).toEqual([]);
    expect(b.operations().filter((operation) => operation.type === 'perform' && operation.action.type === 'click')).toEqual([]);
    expect(b.operations().filter((operation) => operation.type === 'evaluate-assert')).toHaveLength(1);
    expect(a.operations().filter((operation) => operation.type === 'evaluate-assert')).toEqual([]);
    expect(awaitElementPresenceCalls(a).map((call) => call.timeoutMs)).toEqual([111, 111]);
    expect(awaitElementPresenceCalls(b).map((call) => call.timeoutMs)).toEqual([222, 222]);
  });

  it('TEST-12 sends secret fill only to the step target session', async () => {
    const a = session('A');
    const b = session('B');
    const { outcome, driver } = await scenario([
      action('a-nav', 'A', 'navigate', { url: '/start' }),
      action('b-secret', 'B', 'fill-secret', { element: REF, secretRef: SECRET_REF }),
    ], { A: a, B: b });
    expect(outcome.results[0]?.result.status).toBe('passed');
    expect(driver.launches.map((target) => target.baseUrl)).toEqual([definitions.A.baseUrl, definitions.B.baseUrl]);
    expect(a.operations().filter((operation) => operation.type === 'fill-secret')).toEqual([]);
    expect(b.operations().filter((operation) => operation.type === 'fill-secret')).toHaveLength(1);
    expect(b.operations().filter((operation) => operation.type === 'perform' && operation.action.type === 'navigate')).toEqual([]);
    expect(a.currentUrlCalls()).toBe(0);
    expect(b.currentUrlCalls()).toBeGreaterThan(0);
  });

  it('TEST-12 validates navigation against the step target origin', async () => {
    const a = session('A');
    const b = session('B');
    const { outcome, driver } = await scenario([
      action('a-first', 'A', 'navigate', { url: '/start' }),
      action('b-cross', 'B', 'navigate', { url: `${definitions.A.baseUrl}/wrong-origin` }),
    ], { A: a, B: b });
    expect(driver.launches).toHaveLength(2);
    expect(outcome.results[0]?.error).toBeInstanceOf(IntegrityViolationError);
    expect(b.operations().filter((operation) => operation.type === 'perform')).toEqual([]);
  });

  it('TEST-12 wraps the AI step controller around its own target session', async () => {
    const a = session('A');
    const b = session('B');
    const executor = createFakeAiExecutor({
      async executeAgentic(request) {
        await request.controller.snapshotForResolution();
        await request.controller.perform({ type: 'navigate', url: '/ai' });
        return { outcome: 'failure' };
      },
    });
    const ai: TestStep = {
      id: 'b-ai', target: 'B', kind: 'ai', instruction: 'Verify the dashboard.',
      instructionCoverage: [{ id: 'dashboard', kind: 'success', sourceSpan: {
        startLine: 3, startColumn: 1, endLine: 3, endColumn: 26,
      } }],
    };
    const { driver } = await scenario([action('a-nav', 'A', 'navigate', { url: '/start' }), ai], { A: a, B: b }, {
      resolveAiExecutor: async () => executor,
    });
    expect(driver.launches.map((target) => target.baseUrl)).toEqual([definitions.A.baseUrl, definitions.B.baseUrl]);
    expect(executor.agenticRequests).toHaveLength(1);
    expect(a.operations().filter((operation) => operation.type === 'snapshot-for-resolution')).toEqual([]);
    expect(a.operations().filter((operation) => operation.type === 'perform' && operation.action.type === 'navigate' && operation.action.url === '/ai')).toEqual([]);
    expect(b.operations()).toEqual(expect.arrayContaining([
      { type: 'snapshot-for-resolution' },
      expect.objectContaining({ type: 'perform', action: expect.objectContaining({ type: 'navigate', url: '/ai' }) }),
    ]));
  });

  it('TEST-13 closes every acquired session in name order despite a rejected close', async () => {
    const closed: string[] = [];
    const a = session('A', { onClose: () => closed.push('A') });
    const b = session('B', { onClose: () => closed.push('B'), closeError: new Error('close B') });
    const c = session('C', { onClose: () => closed.push('C') });
    const { outcome, driver, plan } = await scenario([
      action('b', 'B', 'navigate', { url: '/ok' }),
      action('a', 'A', 'navigate', { url: '/ok' }),
      action('c', 'C', 'navigate', { url: '/ok' }),
    ], { A: a, B: b, C: c });
    expect(outcome.results[0]?.result.status).toBe('passed');
    expect(driver.launches.map((target) => target.baseUrl)).toEqual([definitions.B.baseUrl, definitions.A.baseUrl, definitions.C.baseUrl]);
    expect(closed).toEqual(['A', 'B', 'C']);
    expect(outcome.results[0]?.result).toMatchObject({ sessions: {
      A: { state: 'closed' }, B: { state: 'close-failed' }, C: { state: 'closed' },
    } });
    expect(Object.keys(outcome.results[0]!.result.sessions).sort()).toEqual(Object.keys(plan.targets).sort());
  });

  it('TEST-13 keeps unreached and launch-failed targets not-opened', async () => {
    const closed: string[] = [];
    const a = session('A', { onClose: () => closed.push('A') });
    const b = session('B', { onClose: () => closed.push('B'), closeError: new Error('close B'), assertOutcome: { passed: false, message: 'absent' } });
    const c = session('C');
    const steps = [action('a', 'A', 'navigate', { url: '/ok' }), action('b', 'B', 'navigate', { url: '/ok' }), action('c', 'C', 'navigate', { url: '/ok' })];
    const failed = await scenario(steps.map((step) => step.id === 'b' ? assertion('b', 'B', 'text-visible', 0, { text: 'absent' }) : step), { A: a, B: b, C: c });
    expect(failed.outcome.results[0]?.result).toMatchObject({ status: 'failed', sessions: { A: { state: 'closed' }, C: { state: 'not-opened' }, B: { state: 'close-failed' } } });
    expect(closed).toEqual(['A', 'B']);
    const launchClosed: string[] = [];
    const launch = await scenario(steps, { A: session('A', { onClose: () => launchClosed.push('A') }), B: session('B'), C: session('C') }, { launchError: 'B' });
    expect(launch.outcome.results[0]?.error).toMatchObject({ kind: 'browser-launch-failed', exitCode: 3 });
    expect(launch.outcome.results[0]?.result).toMatchObject({ sessions: { A: { state: 'closed' }, B: { state: 'not-opened' }, C: { state: 'not-opened' } } });
    expect(launchClosed).toEqual(['A']);
  });

  it.each(['error', 'abort'] as const)('TEST-13 closes A and B and leaves C unopened after %s', async (ending) => {
    const closed: string[] = [];
    const controller = new AbortController();
    const a = session('A', { onClose: () => closed.push('A') });
    const b = session('B', {
      onClose: () => closed.push('B'), closeError: new Error('close B'),
      onPerform: () => {
        if (ending === 'abort') controller.abort(new Error('stopped'));
        else throw new Error('browser failure');
      },
    });
    const c = session('C');
    const { outcome } = await scenario([
      action('a', 'A', 'navigate', { url: '/ok' }), action('b', 'B', 'navigate', { url: '/stop' }),
      action('c', 'C', 'navigate', { url: '/unreached' }),
    ], { A: a, B: b, C: c }, { abort: controller.signal });
    expect(closed).toEqual(['A', 'B']);
    expect(outcome.results[0]?.result).toMatchObject({ sessions: {
      A: { state: 'closed' }, B: { state: 'close-failed' }, C: { state: 'not-opened' },
    } });
    expect(outcome.results[0]?.result.status).toBe('error');
  });

  it('TEST-13 keeps the case status when B close rejects', async () => {
    const steps = [action('a', 'A', 'navigate', { url: '/ok' }), action('b', 'B', 'navigate', { url: '/ok' })];
    const normal = await scenario(steps, { A: session('A'), B: session('B') });
    const rejected = await scenario(steps, { A: session('A'), B: session('B', { closeError: new Error('close B') }) });
    expect(normal.outcome.results[0]?.result.status).toBe('passed');
    expect(rejected.outcome.results[0]?.result.status).toBe(normal.outcome.results[0]?.result.status);
    expect(rejected.outcome.results[0]?.result).toMatchObject({ sessions: { B: { state: 'close-failed' } } });
  });

  it.each(['text-equals', 'element-count'] as const)('TEST-14 polls %s and binds only element checks', async (check) => {
    const b = session('B', { assertOutcomes: [{ passed: false, message: 'first' }, { passed: false, message: 'second' }, { passed: true }] });
    const step = assertion('poll', 'B', check, 1000, check === 'text-equals' ? { element: REF, text: 'Value' } : { element: REF, count: 1 });
    const { outcome, clock } = await scenario([step], { B: b });
    expect(outcome.results[0]?.result.status).toBe('passed');
    expect(b.operations().filter((operation) => operation.type === 'evaluate-assert')).toHaveLength(3);
    if (check === 'element-count') {
      expect(b.operations().filter((operation) => operation.type === 'evaluate-assert').map((operation) => operation.check)).toEqual([
        { check: 'element-count', target: REF, count: 1 },
        { check: 'element-count', target: REF, count: 1 },
        { check: 'element-count', target: REF, count: 1 },
      ]);
    }
    expect(b.bindCalls()).toBe(check === 'text-equals' ? 3 : 0);
    expect(clock.sleepCalls).toEqual([100, 100]);
  });

  it.each([0, 150])('TEST-14 stops at timeoutMs %i with the final mismatch', async (timeoutMs) => {
    const b = session('B', { assertOutcomes: [{ passed: false, message: 'first' }, { passed: false, message: 'second' }] });
    const { outcome, clock } = await scenario([assertion('poll', 'B', 'text-visible', timeoutMs, { text: 'wanted' })], { B: b });
    expect(outcome.results[0]?.result).toMatchObject({ status: 'failed', steps: [{ kind: 'assertion', expected: 'Text "wanted" is visible.', actual: timeoutMs === 0 ? 'first' : 'second' }] });
    expect(b.operations().filter((operation) => operation.type === 'evaluate-assert')).toHaveLength(timeoutMs === 0 ? 1 : 2);
    expect(clock.sleepCalls).toEqual(timeoutMs === 0 ? [] : [100, 50]);
  });

  it('TEST-14 starts the deadline before session acquisition', async () => {
    const b = session('B', { assertOutcomes: [{ passed: false, message: 'first' }, { passed: true }] });
    const { outcome, clock } = await scenario(
      [assertion('poll', 'B', 'text-visible', 100, { text: 'wanted' })],
      { B: b }, { advanceOnLaunchMs: 150 },
    );
    expect(outcome.results[0]?.result).toMatchObject({ status: 'failed', steps: [{ kind: 'assertion', actual: 'first' }] });
    expect(b.operations().filter((operation) => operation.type === 'evaluate-assert')).toHaveLength(1);
    expect(clock.sleepCalls).toEqual([150]);
  });

  it.each(['bind-miss', 'adapter-reject', 'integrity-reject'] as const)('TEST-14 does not retry %s', async (failure) => {
    const b = session('B', { assertOutcomes: [{ passed: false, message: 'first' }, { passed: true }] });
    if (failure === 'bind-miss') {
      vi.spyOn(b, 'resolveGrounded').mockResolvedValue({ kind: 'miss', reason: 'element-not-found' });
    } else if (failure === 'adapter-reject') {
      vi.spyOn(b, 'evaluateAssert').mockRejectedValue(new Error('adapter failed'));
    } else {
      vi.spyOn(b, 'resolveGrounded').mockRejectedValue(new IntegrityViolationError('contaminated'));
    }
    const { outcome, clock, driver } = await scenario([assertion('poll', 'B', 'text-equals', 1000, { element: REF, text: 'wanted' })], { B: b });
    expect(driver.launches).toHaveLength(1);
    expect(outcome.results[0]?.result).toMatchObject({ status: 'error', steps: [{ status: 'error', kind: 'environment' }] });
    if (failure === 'integrity-reject') {
      expect(outcome.results[0]?.error?.kind).toBe('integrity-violation');
    } else if (failure === 'bind-miss') {
      expect(outcome.results[0]?.result.explanation).toContain('no matching element');
    } else {
      expect(outcome.results[0]?.result.explanation).toContain('browser session could not complete');
    }
    expect(clock.sleepCalls).toEqual([]);
    expect(b.operations().filter((operation) => operation.type === 'evaluate-assert')).toHaveLength(0);
  });

  it('TEST-14 interrupts the wait immediately after an abort', async () => {
    const controller = new AbortController();
    const b = session('B', {
      assertOutcome: { passed: false, message: 'pending' },
      onEvaluateAssert: () => controller.abort(new Error('stopped')),
    });
    const { outcome, clock } = await scenario([assertion('poll', 'B', 'text-visible', 1000, { text: 'wanted' })], { B: b }, { abort: controller.signal });
    expect(outcome.results[0]?.result.status).toBe('error');
    expect(b.operations().filter((operation) => operation.type === 'evaluate-assert')).toHaveLength(1);
    expect(clock.sleepCalls).toHaveLength(1);
  });

  it('TEST-15 shares the latest capture writer across targets and reports both writers', async () => {
    const a = session('A', { captureValues: new Map([[elementRefKey(REF), { text: 'from A', value: 'from A' }]]) });
    const b = session('B', { captureValues: new Map([[elementRefKey(REF), { text: 'from B', value: 'from B' }]]) });
    const { outcome } = await scenario([
      capture('a-capture', 'A', 'x'), action('b-fill-first', 'B', 'fill', { element: REF, value: '{{run.x}}' }),
      capture('b-capture', 'B', 'x'), action('b-fill-last', 'B', 'fill', { element: REF, value: '{{run.x}}' }),
    ], { A: a, B: b });
    expect(b.operations().flatMap((operation) => operation.type === 'perform' && operation.action.type === 'fill' ? [operation.action.value] : [])).toEqual(['from A', 'from B']);
    expect(outcome.results[0]?.result.steps.filter((step) => step.type === 'capture')).toMatchObject([
      { id: 'a-capture', target: 'A', variable: 'x' }, { id: 'b-capture', target: 'B', variable: 'x' },
    ]);
  });

  it('TEST-15 preserves target on a skipped step', async () => {
    const b = session('B', { assertOutcome: { passed: false, message: 'missing' } });
    const { outcome } = await scenario([
      assertion('fail', 'B', 'text-visible', 0, { text: 'wanted' }),
      action('skipped', 'C', 'navigate', { url: '/later' }),
    ], { B: b, C: session('C') });
    expect(outcome.results[0]?.result.steps).toMatchObject([
      { id: 'fail', target: 'B', status: 'failed' },
      { id: 'skipped', target: 'C', status: 'skipped' },
    ]);
  });

  it('TEST-16 rejects a plan fill whose materialized value equals a resolved secret', async () => {
    const a = session('A', { captureValues: new Map([[elementRefKey(REF), { text: 'secret-value', value: 'secret-value' }]]) });
    const b = session('B');
    const { outcome, storage, layout, originalGrounding } = await scenario([
      action('secret', 'A', 'fill-secret', { element: REF, secretRef: SECRET_REF }),
      capture('capture', 'A', 'y'),
      action('literal', 'B', 'fill', { element: REF, value: '{{run.y}}' }),
      action('after', 'B', 'navigate', { url: '/after' }),
    ], { A: a, B: b });
    expect(outcome.results[0]?.error).toMatchObject({ kind: 'integrity-violation', exitCode: 4 });
    expect(b.operations().filter((operation) => operation.type === 'perform' && operation.action.type === 'fill')).toEqual([]);
    expect(outcome.results[0]?.result.steps.at(-1)).toMatchObject({ status: 'skipped', target: 'B' });
    expect(await storage.readText(layout.groundingPathFor(FILE))).toBe(originalGrounding);
  });

  it.each(['missing-policy', 'other-target-policy', 'current-url-outside'] as const)('TEST-17 rejects %s before filling on B', async (condition) => {
    const b = session('B', { currentUrl: condition === 'current-url-outside' ? 'https://outside.example.test' : definitions.B.baseUrl });
    const targetConfigs = { ...configs,
      A: { ...configs.A, secretSinkOrigins: { [SECRET_REF]: [definitions.A.baseUrl] } },
      B: { ...configs.B, secretSinkOrigins: { [SECRET_REF]: condition === 'current-url-outside' ? [definitions.B.baseUrl] : [] } },
    } as RunDeps['config']['targets'];
    const steps = condition === 'other-target-policy'
      ? [action('a-first', 'A', 'navigate', { url: '/start' }), action('secret', 'B', 'fill-secret', { element: REF, secretRef: SECRET_REF })]
      : [action('secret', 'B', 'fill-secret', { element: REF, secretRef: SECRET_REF })];
    const { outcome } = await scenario(steps, { A: session('A'), B: b }, { targetConfigs });
    expectSecretSinkOriginViolation(outcome.results[0]?.error, {
      secretRef: SECRET_REF,
      allowedOrigins: condition === 'current-url-outside' ? [definitions.B.baseUrl] : [],
      source: 'configured',
    });
    expect(b.operations().filter((operation) => operation.type === 'fill-secret')).toEqual([]);
    expect(b.currentUrlCalls()).toBeGreaterThan(0);
  });
});
