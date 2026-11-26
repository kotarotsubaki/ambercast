/*
 * Assertions that already hold before an operation produce advisory warnings.
 * Their extra reads preserve execution, persistence, cancellation, and secret
 * containment, and never launch a session or consume a step's time budget.
 */
import { describe, expect, it, vi } from 'vitest';
import { IntegrityViolationError } from '#core/errors/integrity-violation-error.js';
import { computeIntentDigest } from '#core/ir/digest.js';
import { computeAccessibilityFingerprint } from '#core/ir/fingerprint.js';
import { Step, type ElementRef, type GroundingDocument, type JsonValueT, type PlanDocument } from '#core/ir/schema.js';
import type { AssertCheck, BrowserSession } from '#ports/browser.js';
import type { Clock } from '#ports/system.js';
import { run, type RunDeps } from '#usecases/run.js';
import { buildRunReport } from '#usecases/run-report.js';
import { buildHealReport } from '#usecases/heal-report.js';
import { heal } from '#usecases/heal.js';
import { createFakeAiExecutor } from '../../doubles/fake-ai-executor.js';
import { awaitElementPresenceCalls, elementRefKey } from '../../doubles/fake-browser-session.js';
import { createFakeUiExecutor } from '../../doubles/fake-ui-executor.js';
import { createFakeSecretsProvider } from '../../doubles/fake-secrets-provider.js';
import { createFixedClock } from '../../doubles/create-fixed-clock.js';
import { assertDiagnosable, assertNoSecretDisclosure, assertZeroAiCalls, collectStorageArtifacts } from '../../support/report-assertions.js';
import { createScenario as healScenario, OPTIONS as HEAL_OPTIONS } from '../../support/heal-scenario.js';
import {
  aiStep, createFakeBrowserSession, createScenario, DEFAULT_OPTIONS,
  liveEntries, RESOLVED_TARGETS, RUNS_DIR, seedFreshArtifacts, TARGETS,
  writePrompt, type TestStep,
} from '../../support/run-scenario.js';

const PROMPT = '# Observe assertions\n\nUse "Submit", "Email", and "Heading" to verify the page.\n';
const SUBMIT = { strategy: 'accessibility', role: 'button', name: 'Submit' } as const;
const EMAIL = { strategy: 'accessibility', role: 'textbox', name: 'Email' } as const;
const HEADING = { strategy: 'accessibility', role: 'heading', name: 'Heading' } as const;
const REFS = [SUBMIT, EMAIL, HEADING];
const SOURCE = { startLine: 3, startColumn: 1, endLine: 3, endColumn: PROMPT.split('\n')[2]!.length + 1 };
const tree = (refs: readonly ElementRef[] = REFS): JsonValueT => ({ role: 'root', name: '', children: refs.map(({ role, name }) => ({ role, name, children: [] })) });
const captureTree = (refs: readonly ElementRef[] = REFS) => ({ tree: tree(refs), rawYaml: '', scalarValues: [] });
function intent(ref: ElementRef) {
  const startColumn = PROMPT.split('\n')[2]!.indexOf(ref.name) + 1;
  return { description: `${ref.name} control`, roleHint: ref.role, sourceSpan: SOURCE,
    quote: { text: ref.name, sourceSpan: { startLine: 3, startColumn, endLine: 3, endColumn: startColumn + ref.name.length } } };
}
const navigate = (id = 'navigate', target = 'web'): TestStep => ({ id, target, kind: 'action', action: 'navigate', url: '/' });
const click = (id = 'click'): TestStep => ({ id, kind: 'action', action: 'click', intent: intent(SUBMIT) });
const check = (id = 'warn', target = 'web') => ({ id, target, kind: 'assert' as const, check: 'text-visible' as const, text: id, timeoutMs: 0 });
const capture = (id = 'capture', variable = 'x'): TestStep => ({ id, kind: 'capture', intent: intent(EMAIL), variable });
function assertion(kind: 'text-visible' | 'element-visible' | 'text-equals' | 'url-matches' | 'element-count', id = 'warn'): TestStep {
  switch (kind) {
    case 'text-visible': return check(id);
    case 'url-matches': return { id, kind: 'assert', check: kind, pattern: 'example', timeoutMs: 0 };
    case 'element-visible': return { id, kind: 'assert', check: kind, intent: intent(HEADING), timeoutMs: 0 };
    case 'text-equals': return { id, kind: 'assert', check: kind, intent: intent(HEADING), text: 'Heading', timeoutMs: 0 };
    case 'element-count': return { id, kind: 'assert', check: kind, intent: intent(HEADING), count: 1, timeoutMs: 0 };
  }
}
const warning = (stepId = 'warn') => ({ kind: 'assert-held-before-actions', stepId });
type Read = { target: string; step: string | undefined; kind: 'assert' | 'snapshot' | 'capture'; check?: AssertCheck };
type FakeSession = ReturnType<typeof createFakeBrowserSession>;

async function fixture(steps: readonly TestStep[], options: {
  targets?: PlanDocument['targets'];
  signal?: AbortSignal;
  clock?: Clock;
  onRead?: (read: Read, session: FakeSession) => void | Promise<void>;
  configure?: (session: FakeSession, target: string) => void;
  onStep?: (id: string) => void;
  onCompleted?: (id: string) => void;
  emptyGrounding?: boolean;
} = {}) {
  let activeStep: string | undefined;
  const reads: Read[] = [];
  const sessions: FakeSession[] = [];
  const launches: string[] = [];
  const targets: PlanDocument['targets'] = options.targets ?? (steps.length === 0 ? {} : TARGETS);
  const entries: GroundingDocument['entries'] = {};
  for (const step of steps) {
    if ((step.kind !== 'action' && step.kind !== 'capture') || !('intent' in step)) continue;
    const ref = step.kind === 'capture' ? EMAIL : step.action === 'fill' || step.action === 'fill-secret' ? EMAIL : SUBMIT;
    const fp = computeAccessibilityFingerprint(tree(), ref, []);
    if (fp.kind !== 'ok') throw new Error('Fixture element needs a unique fingerprint.');
    entries[step.id] = { kind: 'element', locator: ref, fingerprint: fp.fingerprint, components: fp.components, provenance: 'quoted-match',
      intentDigest: computeIntentDigest({ stepKind: step.kind, operation: step.kind === 'capture' ? 'capture' : step.action, intent: step.intent }) };
  }
  const executor = createFakeAiExecutor({ executeAgentic: async (request) => {
    await request.controller.evaluateAssert({ type: 'assert', check: 'text-visible', text: 'covered' }, 'dashboard-reached');
    return { outcome: 'success' };
  } });
  const base = createScenario();
  const makeSession = (target: string) => {
    launches.push(target);
    const live = new Map(REFS.flatMap((ref) => {
      const fp = computeAccessibilityFingerprint(tree(), ref, []);
      if (fp.kind !== 'ok') throw new Error('Missing fixture fingerprint.');
      return [...liveEntries([ref], fp.fingerprint)];
    }));
    const session = createFakeBrowserSession(live, {
      snapshot: { accessibilityTree: tree(), screenshot: new Uint8Array([1, 2, 3]) },
      captureValues: new Map([[elementRefKey(EMAIL), { text: 'initial', value: 'initial' }], [elementRefKey(HEADING), { text: 'Heading', value: 'Heading' }]]),
    });
    const record = async (read: Omit<Read, 'target' | 'step'>) => {
      const entry = { ...read, target, step: activeStep };
      reads.push(entry);
      await options.onRead?.(entry, session);
    };
    const evaluate = session.evaluateAssert.bind(session);
    const readValue = session.captureValue.bind(session);
    vi.spyOn(session, 'evaluateAssert').mockImplementation(async (value) => { await record({ kind: 'assert', check: value }); return evaluate(value); });
    vi.spyOn(session, 'accessibilitySnapshot').mockImplementation(async () => { await record({ kind: 'snapshot' }); return captureTree(); });
    vi.spyOn(session, 'captureValue').mockImplementation(async (bound, mode) => { await record({ kind: 'capture' }); return readValue(bound, mode); });
    options.configure?.(session, target);
    sessions.push(session);
    return session;
  };
  const deps: RunDeps = {
    ...base.deps,
    secrets: createFakeSecretsProvider(new Map([['{{secrets.password}}', 'ReadOnlyObservationSecret_83!']])),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    events: { emit(event) {
      base.events.sink.emit(event);
      if (event.type === 'step-start') { activeStep = event.stepId; options.onStep?.(event.stepId); }
      if (event.type === 'step-result') options.onCompleted?.(event.stepId);
    } },
    config: { ...base.deps.config, targets: Object.fromEntries(Object.entries(targets).map(([name, value]) => [name, { ...RESOLVED_TARGETS.web, ...value }])) },
    uiExecutor: vi.fn(() => ({
      ...createFakeUiExecutor(() => { throw new Error('Launch must identify its target.'); }),
      async launch(definition: PlanDocument['targets'][string]) {
        const target = Object.keys(targets).find(name => targets[name]!.baseUrl === definition.baseUrl);
        if (target === undefined) throw new Error('Unknown fixture target.');
        return makeSession(target);
      },
    })),
    resolveAiExecutor: vi.fn(async () => executor),
  };
  const path = await writePrompt(deps.storage, 'login.test.md', PROMPT);
  await seedFreshArtifacts(deps.storage, path, steps, options.emptyGrounding ? {} : entries, targets);
  base.recordingStorage.writes.length = 0;
  const execute = (skipAssertObservation = false, resolve = false) => run(deps, { ...DEFAULT_OPTIONS, files: [path], resolve, skipAssertObservation });
  return { ...base, deps, executor, sessions, launches, reads, path, execute };
}
type Outcome = Awaited<ReturnType<typeof run>>;
const row = (outcome: Outcome) => outcome.results[0]!.result;
function report(outcome: Outcome) {
  const built = buildRunReport({ startedAt: '2026-11-20T00:00:00Z', durationMs: 0, options: { allowEmpty: false, list: false }, outcome });
  assertDiagnosable(built.envelope);
  return built;
}
function withoutWarnings(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (key, item: unknown) => key === 'warnings' ? undefined : item));
}
const isObservation = (read: Read) => read.step === 'loaded' && !(read.check?.check === 'text-visible' && read.check.text === 'loaded');
const observationReads = (f: Awaited<ReturnType<typeof fixture>>) => f.reads.filter(isObservation);

describe('assertion observations', () => {
  it.each((['text-visible', 'element-visible', 'text-equals', 'url-matches', 'element-count'] as const)
    .flatMap((kind) => [true, false].map((held) => ({ kind, held }))))(
    'TEST-WARN-1/7 evaluates $kind once per observation with held=$held', async ({ kind, held }) => {
        let phase = 'premise';
        const calls: { phase: string; port: string }[] = [];
        const clock = createFixedClock(new Date('2026-11-20T00:00:00Z'), 0);
        const f = await fixture([navigate(), check('loaded'), click(), assertion(kind)], {
          clock,
          onCompleted(id) { if (id === 'loaded') phase = 'observation'; },
          onStep(id) { if (id === 'click') phase = 'action'; if (id === 'warn') phase = 'assertion'; },
          configure(session) {
            const evaluate = vi.mocked(session.evaluateAssert).getMockImplementation()!;
            const resolve = session.resolveGrounded.bind(session);
            const capture = vi.mocked(session.captureValue).getMockImplementation()!;
            vi.mocked(session.evaluateAssert).mockImplementation(async (value) => {
              calls.push({ phase, port: 'evaluateAssert' });
              await evaluate(value);
              return { passed: phase !== 'observation' || held, message: 'Not held yet.' };
            });
            vi.mocked(session.accessibilitySnapshot).mockImplementation(async () => {
              calls.push({ phase, port: 'accessibilitySnapshot' });
              return captureTree(phase === 'observation' && !held && kind !== 'text-equals' ? [SUBMIT, EMAIL] : REFS);
            });
            vi.spyOn(session, 'resolveGrounded').mockImplementation(async (ref, query) => {
              calls.push({ phase, port: 'resolveGrounded' });
              return resolve(ref, query);
            });
            vi.mocked(session.captureValue).mockImplementation(async (bound, mode) => {
              calls.push({ phase, port: 'captureValue' });
              const value = await capture(bound, mode);
              return phase === 'observation' && !held ? 'Different heading' : value;
            });
          },
        });
        const outcome = await f.execute();
        const ports = kind === 'text-equals' ? ['accessibilitySnapshot', 'resolveGrounded', 'captureValue']
          : kind === 'element-visible' || kind === 'element-count' ? ['accessibilitySnapshot'] : ['evaluateAssert'];
        // One evaluation can contain three port calls; neither phase may repeat that sequence.
        expect(calls.filter((call) => call.phase === 'observation').map((call) => call.port)).toEqual(ports);
        expect(calls.filter((call) => call.phase === 'assertion').map((call) => call.port)).toEqual(ports);
        expect(clock.sleepCalls).toEqual([]);
        expect(clock.monotonicMs()).toBe(0);
        expect(row(outcome)).toMatchObject({ status: 'passed', warnings: held ? [warning()] : [] });
    });

  it.each([false, true])('TEST-WARN-5 preserves completion-only promotions when a later assertion fails=%s', async (fails) => {
    const steps: TestStep[] = [navigate(), check('loaded'), click(),
      { id: 'fill', kind: 'action', action: 'fill', intent: intent(EMAIL), value: 'example' },
      { id: 'press', kind: 'action', action: 'press', intent: intent(SUBMIT), key: 'Enter' },
      { ...check(), confirms: ['press'] }];
    if (fails) steps.push(check('stop'));
    const configure = (session: FakeSession) => {
      const evaluate = vi.mocked(session.evaluateAssert).getMockImplementation()!;
      vi.mocked(session.evaluateAssert).mockImplementation(async (value) => {
        await evaluate(value);
        return { passed: !(value.check === 'text-visible' && value.text === 'stop'), message: 'The final text is absent.' };
      });
    };
    const observed = await fixture(steps, { configure, emptyGrounding: true });
    const baseline = await fixture(steps, { configure, emptyGrounding: true });
    const a = await observed.execute(false, true);
    const b = await baseline.execute(true, true);
    expect(withoutWarnings(a)).toEqual(withoutWarnings(b));
    expect(observed.events.emitted()).toEqual(baseline.events.emitted());
    expect(observed.recordingStorage.writes).toEqual(baseline.recordingStorage.writes);
    const documents = await Promise.all([observed, baseline].map(async (f) =>
      JSON.parse(await f.deps.storage.readText(f.deps.layout.groundingPathFor(f.path))) as GroundingDocument));
    expect(documents[0]!.entries).toEqual(documents[1]!.entries);
    for (const document of documents) {
      expect(Object.keys(document.entries).sort()).toEqual(fails ? ['press'] : ['click', 'fill', 'press']);
      for (const step of steps) {
        if (step.kind !== 'action' || !('intent' in step) || (fails && step.id !== 'press')) continue;
        const ref = step.action === 'fill' ? EMAIL : SUBMIT;
        const fp = computeAccessibilityFingerprint(tree(), ref, []);
        if (fp.kind !== 'ok') throw new Error('Expected unique fixture fingerprint.');
        expect(document.entries[step.id]).toEqual({ kind: 'element', locator: ref, fingerprint: fp.fingerprint, components: fp.components,
          provenance: 'quoted-match', intentDigest: computeIntentDigest({ stepKind: 'action', operation: step.action, intent: step.intent }) });
      }
    }
    for (const outcome of [a, b]) {
      expect(row(outcome).status).toBe(fails ? 'failed' : 'passed');
      for (const id of ['click', 'fill', 'press']) {
        expect(row(outcome).steps.find((step) => step.id === id)).toMatchObject({ status: 'passed', binding: { confirmed: !fails || id === 'press' } });
      }
      assertZeroAiCalls(report(outcome).envelope);
    }
    expect(row(a)).toHaveProperty('warnings', [warning()]);
    expect(row(b)).toHaveProperty('warnings', []);
  });

  it.each(['text-visible', 'element-visible', 'text-equals', 'url-matches', 'element-count'] as const)('TEST-WARN-1 warns for an already-held %s predicate', async (kind) => {
    const f = await fixture([navigate(), check('loaded'), click(), assertion(kind)]);
    const outcome = await f.execute();
    expect(row(outcome)).toMatchObject({ status: 'passed', warnings: [warning()] });
    expect(observationReads(f).length).toBeGreaterThan(0);
    assertZeroAiCalls(report(outcome).envelope);
    expect(f.deps.resolveAiExecutor).not.toHaveBeenCalled();
  });

  it('TEST-WARN-1 includes element-visible with two matching elements', async () => {
    const f = await fixture([navigate(), check('loaded'), click(), assertion('element-visible')], {
      configure(session) { vi.mocked(session.accessibilitySnapshot).mockResolvedValue(captureTree([...REFS, HEADING])); },
    });
    expect(row(await f.execute())).toMatchObject({ status: 'passed', warnings: [warning()] });
  });

  it.each(['fill', 'press', 'fill-secret'] as const)('TEST-WARN-1 treats %s as an effect step', async (action) => {
    const effect: TestStep = action === 'fill'
      ? { id: 'effect', kind: 'action', action, intent: intent(EMAIL), value: 'example' }
      : action === 'press'
        ? { id: 'effect', kind: 'action', action, intent: intent(SUBMIT), key: 'Enter' }
        : { id: 'effect', kind: 'action', action, intent: intent(EMAIL), secretRef: '{{secrets.password}}' };
    const f = await fixture([navigate(), check('loaded'), effect, check()]);
    const outcome = await f.execute();
    expect(row(outcome)).toMatchObject({ status: 'passed', warnings: [warning()] });
    expect(observationReads(f)).toHaveLength(1);
    assertZeroAiCalls(report(outcome).envelope);
  });

  it('TEST-WARN-1 observes a zero-count predicate as held', async () => {
    const f = await fixture([navigate(), check('loaded'), click(), { ...assertion('element-count'), count: 0 } as TestStep], {
      configure(session) { vi.mocked(session.accessibilitySnapshot).mockResolvedValue(captureTree([SUBMIT, EMAIL])); },
    });
    expect(row(await f.execute())).toMatchObject({ status: 'passed', warnings: [warning()] });
  });

  it('TEST-WARN-2 does not launch a session for the first interval', async () => {
    const f = await fixture([navigate(), click(), check()]);
    expect(row(await f.execute())).toMatchObject({ status: 'passed', warnings: [] });
    expect(f.launches).toEqual(['web']);
    expect(f.reads.filter((read) => read.kind === 'assert')).toEqual([expect.objectContaining({ step: 'warn' })]);
  });

  it.each(['click', 'navigate'] as const)('TEST-WARN-2 samples before the first %s and never retries a not-held observation', async (effect) => {
    let changed = false;
    const effects = effect === 'click' ? [click()] : [navigate('next-page'), click('after-navigation')];
    const f = await fixture([navigate(), check('loaded'), ...effects, check()], {
      configure(session) {
        const perform = session.perform.bind(session);
        const evaluate = vi.mocked(session.evaluateAssert).getMockImplementation()!;
        vi.spyOn(session, 'perform').mockImplementation(async (action) => { await perform(action); if (action.type === effect) changed = true; });
        vi.mocked(session.evaluateAssert).mockImplementation(async (value) => { await evaluate(value); return { passed: value.check !== 'text-visible' || value.text !== 'warn' || changed, message: 'Not yet visible' }; });
      },
      onStep(id) { if (id === 'loaded') changed = false; },
    });
    expect(row(await f.execute())).toMatchObject({ status: 'passed', warnings: [] });
    expect(observationReads(f)).toHaveLength(1);
  });

  it('TEST-WARN-2 treats assert → capture → assert as two premise blocks', async () => {
    const f = await fixture([check('premise'), capture(), check('second'), click('trailing')]);
    expect(row(await f.execute())).toMatchObject({ status: 'passed', warnings: [] });
    expect(f.reads.filter((read) => read.kind === 'assert').map((read) => read.step)).toEqual(['premise', 'second']);
  });

  it('TEST-WARN-3 observes only the already-started target in a mixed block', async () => {
    const f = await fixture([navigate(), check('loaded'), click(), check('warm'), check('cold', 'other')], {
      targets: { ...TARGETS, other: { surface: 'web', baseUrl: 'https://other.test' } },
    });
    expect(row(await f.execute())).toMatchObject({ status: 'passed', warnings: [warning('warm')] });
    expect(f.launches).toEqual(['web', 'other']);
    expect(f.reads.filter((read) => read.target === 'other').map((read) => read.step)).toEqual(['cold']);
  });

  it.each(['adapter', 'integrity', 'snapshot'] as const)('TEST-WARN-3 swallows unavailable %s evidence without changing execution', async (failure) => {
    async function execute(skip: boolean) {
      let current = '';
      const f = await fixture([navigate(), check('loaded'), click(), assertion(failure === 'snapshot' ? 'element-visible' : 'text-visible')], {
        onStep(id) { current = id; },
        onRead(read) {
          if (!isObservation(read)) return;
          if (failure === 'adapter') throw new Error('Observation adapter unavailable');
          if (failure === 'integrity') throw new IntegrityViolationError('Observation integrity unavailable');
        },
        configure(session) {
          if (failure === 'snapshot') vi.mocked(session.accessibilitySnapshot).mockImplementation(async () => current === 'loaded'
            ? { tree: null, rawYaml: '', scalarValues: [] } : captureTree());
        },
      });
      return { f, outcome: await f.execute(skip) };
    }
    const observed = await execute(false);
    const baseline = await execute(true);
    expect(row(observed.outcome)).toMatchObject({ status: 'passed', warnings: [] });
    expect(JSON.stringify(withoutWarnings(observed.outcome))).toBe(JSON.stringify(withoutWarnings(baseline.outcome)));
    expect(observed.f.events.emitted()).toEqual(baseline.f.events.emitted());
    assertZeroAiCalls(report(observed.outcome).envelope);
  });

  it.each(['text-visible', 'text-equals', 'url-matches'] as const)('TEST-WARN-3 treats an unavailable run reference in %s as unavailable observation', async (kind) => {
    const expected = assertion(kind);
    const final = kind === 'url-matches' ? { ...expected, pattern: '{{run.x}}' } : { ...expected, text: '{{run.x}}' };
    const f = await fixture([navigate(), check('loaded'), click(), capture(), final as TestStep], {
      configure(session) { vi.spyOn(session, 'captureValue').mockResolvedValue('Heading'); },
    });
    expect(row(await f.execute())).toMatchObject({ status: 'passed', warnings: [] });
    expect(observationReads(f)).toEqual([]);
  });

  it.each(['before', 'during'] as const)('TEST-WARN-3 preserves step-start before cancellation %s observation', async (when) => {
    async function execute(skip: boolean) {
      const controller = new AbortController();
      const f = await fixture([navigate(), check('loaded'), click(), check()], {
        signal: controller.signal,
        onCompleted(id) { if (when === 'before' && id === 'loaded') controller.abort(); },
        onStep(id) { if (skip && when === 'during' && id === 'click') controller.abort(); },
        onRead(read) { if (!skip && when === 'during' && isObservation(read)) { controller.abort(); controller.signal.throwIfAborted(); } },
      });
      return { f, outcome: await f.execute(skip) };
    }
    const observed = await execute(false);
    const baseline = await execute(true);
    expect(row(observed.outcome).status).toBe('error');
    expect(observed.f.events.emitted()).toEqual(baseline.f.events.emitted());
    expect(JSON.stringify(withoutWarnings(observed.outcome))).toBe(JSON.stringify(withoutWarnings(baseline.outcome)));
    if (when === 'before') expect(observationReads(observed.f)).toEqual([]);
    else expect(observed.f.events.emitted()).toContainEqual({ type: 'step-start', stepId: 'click' });
    assertDiagnosable(report(observed.outcome).envelope);
  });

  it.each(['text-visible', 'text-equals', 'url-matches'] as const)('TEST-WARN-4 compares expanded %s expectations byte for byte', async (kind) => {
    for (const same of [false, true]) {
      let value = 'Heading';
      const expected = assertion(kind);
      const final = kind === 'url-matches' ? { ...expected, pattern: '{{run.x}}' } : { ...expected, text: '{{run.x}}' };
      const f = await fixture([navigate(), check('loaded'), capture('initial'), click(), capture('updated'), final as TestStep], {
        onStep(id) { if (id === 'updated' && !same) value = 'Changed'; },
        configure(session) { vi.spyOn(session, 'captureValue').mockImplementation(async () => value); },
      });
      expect(row(await f.execute())).toMatchObject({ status: 'passed', warnings: same ? [warning()] : [] });
    }
  });

  it('TEST-WARN-3 preserves the grounding failure when an observed page loses its action target', async () => {
    async function execute(skip: boolean) {
      let session: FakeSession | undefined;
      const f = await fixture([navigate(), check('loaded'), click(), check()], {
        configure(value) { session = value; },
        onStep(id) {
          if (id === 'click') vi.spyOn(session!, 'resolveGrounded').mockResolvedValue({ kind: 'miss', reason: 'element-not-found' });
        },
      });
      return { f, outcome: await f.execute(skip) };
    }
    const observed = await execute(false);
    const baseline = await execute(true);
    expect(row(observed.outcome)).toMatchObject({ status: 'error', warnings: [] });
    expect(report(observed.outcome).envelope.errors).toContainEqual(expect.objectContaining({ code: 'GROUNDING_UNRESOLVED', details: { stepId: 'click', reason: 'recoverable-miss' } }));
    expect(JSON.stringify(withoutWarnings(observed.outcome))).toBe(JSON.stringify(withoutWarnings(baseline.outcome)));
    expect(observed.f.events.emitted()).toEqual(baseline.f.events.emitted());
    expect(observationReads(observed.f)).toHaveLength(1);
  });

  it.each([
    { resolve: false, fails: false }, { resolve: true, fails: false },
    { resolve: false, fails: true }, { resolve: true, fails: true },
  ])('TEST-WARN-5 preserves all execution artifacts with resolve=$resolve, fails=$fails', async ({ resolve, fails }) => {
    const steps: TestStep[] = [navigate(), check('loaded'), click(),
      { id: 'fill', kind: 'action', action: 'fill', intent: intent(EMAIL), value: 'example' },
      { id: 'press', kind: 'action', action: 'press', intent: intent(SUBMIT), key: 'Enter' },
      { ...check(), confirms: ['click', 'fill', 'press'] }];
    if (fails) steps.push(check('stop'));
    const configure = (session: FakeSession) => {
      const evaluate = vi.mocked(session.evaluateAssert).getMockImplementation()!;
      vi.mocked(session.evaluateAssert).mockImplementation(async (value) => {
        await evaluate(value);
        return value.check === 'text-visible' && value.text === 'stop' ? { passed: false, message: 'The final text is absent.' } : { passed: true };
      });
    };
    const observed = await fixture(steps, { configure });
    const baseline = await fixture(steps, { configure });
    const a = await observed.execute(false, resolve);
    const b = await baseline.execute(true, resolve);
    expect(JSON.stringify(withoutWarnings(a))).toBe(JSON.stringify(withoutWarnings(b)));
    expect(observed.events.emitted()).toEqual(baseline.events.emitted());
    const actions = (f: typeof observed) => f.sessions.flatMap((session) => session.operations().filter((op) => op.type === 'perform' || op.type === 'fill-secret'));
    expect(actions(observed)).toEqual(actions(baseline));
    expect(observed.recordingStorage.writes).toEqual(baseline.recordingStorage.writes);
    if (fails) {
      const aFiles = await collectStorageArtifacts(observed.deps.storage, [RUNS_DIR, observed.deps.layout.groundingPathFor(observed.path)]);
      const bFiles = await collectStorageArtifacts(baseline.deps.storage, [RUNS_DIR, baseline.deps.layout.groundingPathFor(baseline.path)]);
      expect(aFiles).toEqual(bFiles);
    }
    for (const f of [observed, baseline]) {
      expect(f.deps.resolveAiExecutor).not.toHaveBeenCalled();
      expect(f.executor.structuredRequests).toEqual([]);
      expect(f.executor.agenticRequests).toEqual([]);
    }
    assertZeroAiCalls(report(a).envelope);
    expect(row(a)).toMatchObject({ status: fails ? 'failed' : 'passed', warnings: [warning()] });
    expect(row(b)).toHaveProperty('warnings', []);
  });

  it('TEST-WARN-5 waits for pending observation reads before starting the next step clock', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    let now = 0;
    const fixed = createFixedClock(new Date('2026-11-20T00:00:00Z'), 0);
    const clock: Clock = { ...fixed, monotonicMs: () => now };
    const f = await fixture([navigate(), check('loaded'), click(), check()], {
      clock,
      async onRead(read) { if (isObservation(read)) { entered(); await pending; } },
    });
    const execution = f.execute();
    const state = await Promise.race([started.then(() => 'reading'), execution.then(() => 'finished')]);
    expect(state).toBe('reading');
    expect(f.events.emitted()).not.toContainEqual({ type: 'step-start', stepId: 'click' });
    now = 20_000;
    release();
    const outcome = await execution;
    expect(row(outcome)).toMatchObject({ status: 'passed', warnings: [warning()] });
    expect(awaitElementPresenceCalls(f.sessions[0]!)).toEqual([{ ref: SUBMIT, timeoutMs: RESOLVED_TARGETS.web.resolveTimeoutMs }]);
    expect(fixed.sleepCalls).toEqual([]);
  });

  it('TEST-WARN-5 does not leak values from an observation exception', async () => {
    const secret = 'ObservationOnlySecret_762!';
    const f = await fixture([navigate(), check('loaded'), click(), check(), check('stop')], {
      onRead(read) { if (isObservation(read)) throw new Error(secret); },
      configure(session) {
        const evaluate = vi.mocked(session.evaluateAssert).getMockImplementation()!;
        vi.mocked(session.evaluateAssert).mockImplementation(async (value) => {
          await evaluate(value);
          return value.check === 'text-visible' && value.text === 'stop' ? { passed: false, message: 'The final text is absent.' } : { passed: true };
        });
      },
    });
    const outcome = await f.execute();
    const artifacts = await collectStorageArtifacts(f.deps.storage, [RUNS_DIR, f.deps.layout.planPathFor(f.path), f.deps.layout.groundingPathFor(f.path)]);
    assertNoSecretDisclosure({ secrets: { observation: secret }, report: report(outcome).envelope, artifacts });
    expect(row(outcome)).toMatchObject({ status: 'failed', warnings: [] });
  });

  it.each(['failed', 'error'] as const)('TEST-WARN-6 retains earlier warnings when a case ends %s', async (status) => {
    const f = await fixture([navigate(), check('loaded'), click(), check('z-first'), check('a-second'), check('stop')], {
      configure(session) {
        vi.mocked(session.evaluateAssert).mockImplementation(async (value) => {
          if (value.check === 'text-visible' && value.text === 'stop') {
            if (status === 'error') throw new IntegrityViolationError('Production assertion failed integrity validation.');
            return { passed: false, message: 'The final text is absent.' };
          }
          return { passed: true };
        });
      },
    });
    const outcome = await f.execute();
    expect(row(outcome)).toMatchObject({ status, warnings: [warning('z-first'), warning('a-second')] });
    assertZeroAiCalls(report(outcome).envelope);
  });

  it('TEST-WARN-6 omits warnings before a trusted plan is available', async () => {
    const f = await fixture([navigate(), check()]);
    await f.deps.storage.writeText(f.deps.layout.planPathFor(f.path), '{}');
    const outcome = await f.execute();
    expect(row(outcome)).not.toHaveProperty('warnings');
    expect(row(outcome).status).toBe('error');
    assertDiagnosable(report(outcome).envelope);
  });

  it('TEST-WARN-5 keeps heal replay free of observation reads and run-only warnings', async () => {
    const steps = [navigate(), check('loaded'), navigate('second'), check()].map((step) => Step.parse({ ...step, target: 'web' }));
    const f = await healScenario({ steps });
    const sessions: BrowserSession[] = [];
    const original = f.sessionFactory.getMockImplementation()!;
    f.sessionFactory.mockImplementation(() => {
      const session = original();
      vi.spyOn(session, 'evaluateAssert');
      sessions.push(session);
      return session;
    });
    const outcome = await heal(f.deps, HEAL_OPTIONS);
    expect(outcome.outcome.results[0]).toHaveProperty('repairOutcome', 'no-changes-needed');
    expect(outcome.outcome.results[0]).not.toHaveProperty('warnings');
    expect(sessions.length).toBeGreaterThan(0);
    for (const session of sessions) expect(session.evaluateAssert).toHaveBeenCalledTimes(2);
  });

  it('TEST-WARN-6 preserves generator assumptions on a healed row', async () => {
    const candidate = { steps: [{ id: 'regenerated', kind: 'action', target: 'web', action: 'navigate', url: '/dashboard' }], ambiguities: [], assumptions: ['The dashboard remains available.'] };
    const executor = createFakeAiExecutor({ execute: async (request) => {
      const frontier = (request.context as { trustedInputs?: { frontier?: unknown } } | undefined)?.trustedInputs?.frontier;
      const data = frontier === undefined ? candidate : { steps: [{ id: 'wrong-id', kind: 'action', target: 'web', action: 'navigate', url: '/ignored' }], ambiguities: [] };
      return { data, raw: JSON.stringify(data) };
    } });
    const f = await healScenario({ steps: [Step.parse({ id: 'broken', kind: 'action', target: 'web', action: 'navigate', url: 'http://[' })], grounding: {}, aiExecutor: executor });
    const result = await heal(f.deps, HEAL_OPTIONS);
    const expected = [{ kind: 'generator-assumption', message: candidate.assumptions[0] }];
    expect(result.outcome.results[0]).toMatchObject({ repairOutcome: 'healed', warnings: expected });
    const built = buildHealReport({ startedAt: '2026-11-20T00:00:00Z', durationMs: 0,
      options: { allowEmpty: false, list: false },
      outcome: { ...result.outcome, results: result.outcome.results.map((item) => ({ ...item, application: 'preview-only' as const })) },
    });
    expect(built.envelope.results[0]).toHaveProperty('warnings', expected);
    assertDiagnosable(built.envelope);
  });

  it('TEST-WARN-7 observes each eligible assertion once and skips trailing effects', async () => {
    const f = await fixture([check('premise'), navigate(), check('first'), check('second'), click(), check('third'), check('fourth'), navigate('trailing')]);
    const outcome = await f.execute();
    expect(row(outcome)).toMatchObject({ status: 'passed', warnings: ['first', 'second', 'third', 'fourth'].map(warning) });
    const texts = f.reads.flatMap((read) => read.check?.check === 'text-visible' ? [read.check.text] : []);
    expect(texts).toEqual(['premise', 'first', 'second', 'first', 'second', 'third', 'fourth', 'third', 'fourth']);
  });

  it.each([
    { name: 'empty', steps: [] },
    { name: 'effect only', steps: [navigate()] },
    { name: 'premise only', steps: [check('premise')] },
    { name: 'capture only', steps: [capture()] },
  ])('TEST-WARN-7 makes no extra reads for $name', async ({ steps }) => {
    const f = await fixture(steps);
    const baseline = await fixture(steps);
    const a = await f.execute();
    const b = await baseline.execute(true);
    expect(row(a)).toHaveProperty('warnings', []);
    expect(f.reads).toEqual(baseline.reads);
    expect(JSON.stringify(withoutWarnings(a))).toBe(JSON.stringify(withoutWarnings(b)));
  });

  it('TEST-WARN-7 samples before an AI step and excludes its internal assertions', async () => {
    const f = await fixture([navigate(), check('loaded'), aiStep(), check()]);
    const outcome = await f.execute(false, true);
    expect(row(outcome)).toMatchObject({ status: 'passed', warnings: [warning()] });
    expect(observationReads(f).filter((read) => read.kind === 'assert').map((read) => read.check)).toEqual([{ check: 'text-visible', text: 'warn' }]);
    expect(f.executor.agenticRequests).toHaveLength(1);
  });
});
