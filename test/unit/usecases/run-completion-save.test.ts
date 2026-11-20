/*
 * Successful cases save every completed element binding for deterministic
 * replay, while incomplete cases retain only independently confirmed work.
 * Completion planning is atomic and persistence retains its existing policy,
 * secret containment, and failure contracts.
 */
import { describe, expect, it, vi } from 'vitest';
import { FsIoError } from '#core/errors/fs-io-error.js';
import { IntegrityViolationError } from '#core/errors/integrity-violation-error.js';
import { computeIntentDigest } from '#core/ir/digest.js';
import { computeAccessibilityFingerprint } from '#core/ir/fingerprint.js';
import { GroundingDocument, Step, type ElementRef, type JsonValueT, type PlanDocument } from '#core/ir/schema.js';
import { planCompletionPromotions, run, type RunDeps } from '#usecases/run.js';
import { buildRunReport } from '#usecases/run-report.js';
import { createFakeAiExecutor } from '../../doubles/fake-ai-executor.js';
import { elementRefKey, type FakeBrowserSessionOptions } from '../../doubles/fake-browser-session.js';
import { createFakeSecretsProvider } from '../../doubles/fake-secrets-provider.js';
import { createFakeUiExecutor } from '../../doubles/fake-ui-executor.js';
import { assertDiagnosable, assertNoSecretDisclosure, assertZeroAiCalls, collectStorageArtifacts } from '../../support/report-assertions.js';
import {
  aiStep, createFakeBrowserSession, createScenario, DEFAULT_OPTIONS,
  liveEntries, RESOLVED_TARGETS, RUNS_DIR, seedFreshArtifacts, writePrompt,
  type TestStep,
} from '../../support/run-scenario.js';

const PROMPT = '# Save completed bindings\n\nUse "Submit", "Email", and "Password" to reach the dashboard.\n';
const SUBMIT = { strategy: 'accessibility', role: 'button', name: 'Submit' } as const;
const EMAIL = { strategy: 'accessibility', role: 'textbox', name: 'Email' } as const;
const PASSWORD = { strategy: 'accessibility', role: 'textbox', name: 'Password' } as const;
const REFS = [SUBMIT, EMAIL, PASSWORD];
const SOURCE = { startLine: 3, startColumn: 1, endLine: 3, endColumn: PROMPT.split('\n')[2]!.length + 1 } as const;
const SECRET_REF = '{{secrets.password}}';
const SECRET = 'CompletionSecretValue_29!';
const tree = (refs: readonly ElementRef[] = REFS): JsonValueT => ({
  role: 'root', name: '', children: refs.map(({ role, name }) => ({ role, name, children: [] })),
});
const snapshot = (refs: readonly ElementRef[] = REFS) => ({ tree: tree(refs), rawYaml: JSON.stringify(refs), scalarValues: [] });
function fingerprint(ref: ElementRef, refs: readonly ElementRef[] = REFS) {
  const result = computeAccessibilityFingerprint(tree(refs), ref, []);
  if (result.kind !== 'ok') throw new Error('The fixture needs a unique fingerprintable element.');
  return result.fingerprint;
}
function intent(ref: ElementRef): ReturnType<typeof quotedIntent>;
function intent(ref: ElementRef, quoted: boolean): ReturnType<typeof unquotedIntent> & { quote?: ReturnType<typeof quotedIntent>['quote'] };
function intent(ref: ElementRef, quoted = true) {
  return quoted ? quotedIntent(ref) : unquotedIntent(ref);
}
function unquotedIntent(ref: ElementRef) {
  return { description: `${ref.name} control`, roleHint: ref.role, sourceSpan: SOURCE };
}
function quotedIntent(ref: ElementRef) {
  const startColumn = PROMPT.split('\n')[2]!.indexOf(ref.name) + 1;
  return {
    description: `${ref.name} control`, roleHint: ref.role, sourceSpan: SOURCE,
    quote: { text: ref.name, sourceSpan: { startLine: 3, startColumn, endLine: 3, endColumn: startColumn + ref.name.length } },
  };
}
const click = (id = 'click-submit', quoted = true): TestStep => ({ id, kind: 'action', action: 'click', intent: intent(SUBMIT, quoted) });
const fill = (id = 'fill-email'): TestStep => ({ id, kind: 'action', action: 'fill', intent: intent(EMAIL), value: 'example' });
const capture: TestStep = { id: 'capture-email', kind: 'capture', intent: intent(EMAIL), variable: 'email' };
const navigate: TestStep = { id: 'navigate', kind: 'action', action: 'navigate', url: '/' };
const check = (id = 'check-dashboard', confirms?: string[]): TestStep => ({ id, kind: 'assert', check: 'text-visible', text: 'Dashboard', timeoutMs: 0, ...(confirms === undefined ? {} : { confirms }) });
const visible = (confirms = ['click-submit']): TestStep => ({ id: 'visible-submit', kind: 'assert', check: 'element-visible', intent: intent(SUBMIT), confirms, timeoutMs: 0 });
const secretFill: TestStep = { id: 'fill-password', kind: 'action', action: 'fill-secret', intent: intent(PASSWORD), secretRef: SECRET_REF };

function entry(step: TestStep, locator: ElementRef = SUBMIT, provenance: 'quoted-match' | 'ai-proposed' = 'quoted-match') {
  if ((step.kind !== 'action' && step.kind !== 'capture') || !('intent' in step)) throw new Error('Expected an element step.');
  return {
    kind: 'element' as const, locator, fingerprint: fingerprint(locator), provenance,
    intentDigest: computeIntentDigest({ stepKind: step.kind, operation: step.kind === 'capture' ? 'capture' : step.action, intent: step.intent }),
  };
}

async function fixture(steps: readonly TestStep[], options: {
  entries?: GroundingDocument['entries'];
  browser?: FakeBrowserSessionOptions;
  configureSession?: (session: ReturnType<typeof createFakeBrowserSession>) => void;
  coveredAi?: boolean;
  signal?: AbortSignal;
  targets?: PlanDocument['targets'];
  bindingRef?: ElementRef;
} = {}) {
  const refs = options.bindingRef === undefined ? REFS : [...REFS, options.bindingRef];
  const proposal = options.bindingRef ?? SUBMIT;
  const sessions: ReturnType<typeof createFakeBrowserSession>[] = [];
  const executor = createFakeAiExecutor({
    execute: async () => ({ data: { proposal: { outcome: 'found', role: proposal.role, name: proposal.name } }, raw: JSON.stringify({ proposal: { outcome: 'found', role: proposal.role, name: proposal.name } }) }),
    async executeAgentic(request) {
      if (options.coveredAi !== false) {
        await request.controller.evaluateAssert({ type: 'assert', check: 'text-visible', text: 'Dashboard' }, 'dashboard-reached');
      } else {
        await request.controller.snapshotForResolution();
      }
      return { outcome: 'success' };
    },
  });
  const makeSession = () => {
    const entries = new Map(refs.flatMap((ref) => [...liveEntries([ref], fingerprint(ref, ref === options.bindingRef ? refs : REFS))]));
    const session = createFakeBrowserSession(entries, {
      assertOutcome: { passed: true },
      snapshot: { accessibilityTree: tree(refs), screenshot: new Uint8Array([1, 2, 3]) },
      captureValues: new Map([[elementRefKey(EMAIL), { text: 'Captured value', value: 'Captured value' }]]),
      ...options.browser,
    });
    vi.spyOn(session, 'accessibilitySnapshot').mockResolvedValue(snapshot(refs));
    options.configureSession?.(session);
    sessions.push(session);
    return session;
  };
  const base = createScenario({
    uiExecutor: vi.fn(() => createFakeUiExecutor(makeSession)),
    resolveAiExecutor: vi.fn(async () => executor),
    secrets: createFakeSecretsProvider(new Map([[SECRET_REF, SECRET]])),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  const deps: RunDeps = options.targets === undefined ? base.deps : {
    ...base.deps,
    config: { ...base.deps.config, targets: Object.fromEntries(Object.entries(options.targets).map(([name, target]) => [name, { ...RESOLVED_TARGETS.web, ...target }])) },
  };
  const testPath = await writePrompt(deps.storage, 'login.test.md', PROMPT);
  await seedFreshArtifacts(deps.storage, testPath, steps, options.entries ?? {}, options.targets ?? (steps.length === 0 ? {} : undefined));
  const groundingPath = deps.layout.groundingPathFor(testPath);
  const before = await deps.storage.readText(groundingPath);
  base.recordingStorage.writes.length = 0;
  return {
    ...base, deps, sessions, executor, testPath, groundingPath, before,
    groundingWrites: () => base.recordingStorage.writes.filter(({ path }) => path === groundingPath),
    grounding: async () => GroundingDocument.parse(JSON.parse(await deps.storage.readText(groundingPath))),
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
type Outcome = Awaited<ReturnType<typeof run>>;
function report(outcome: Outcome) {
  const built = buildRunReport({ startedAt: '2026-11-20T00:00:00Z', durationMs: 0, options: { allowEmpty: false, list: false }, outcome });
  assertDiagnosable(built.envelope);
  return built;
}
function confirmed(outcome: Outcome, ids: readonly string[]) {
  const steps = outcome.results[0]!.result.steps;
  for (const id of ids) expect(steps.find((step) => step.id === id), id).toMatchObject({ status: 'passed', binding: { confirmed: true } });
}
async function execute(f: Fixture) {
  const outcome = await run(f.deps, DEFAULT_OPTIONS);
  report(outcome);
  return outcome;
}
async function assertContainedArtifacts(f: Fixture, outcome: Outcome) {
  const envelope = report(outcome).envelope;
  // The command layer persists reports; a successful use case alone leaves
  // no run files. Model that boundary so the scan includes the report artifact.
  await f.deps.storage.writeText(`${RUNS_DIR}/completion-report.json`, JSON.stringify(envelope));
  const artifacts = await collectStorageArtifacts(f.deps.storage, [RUNS_DIR, f.deps.layout.planPathFor(f.testPath), f.groundingPath]);
  assertNoSecretDisclosure({ secrets: { password: SECRET, captured: 'Captured value' }, report: envelope, artifacts });
}

describe('completion save', () => {
  it('TEST-SAVE-1 saves a trailing click identically to the confirms trigger', async () => {
    const completion = await fixture([check(), click()]);
    const triggered = await fixture([click(), check('confirm', ['click-submit'])]);
    const outcome = await execute(completion);
    expect(outcome.results[0]!.result.status).toBe('passed');
    confirmed(outcome, ['click-submit']);
    await execute(triggered);
    expect((await completion.grounding()).entries['click-submit']).toEqual(entry(click()));
    expect((await completion.grounding()).entries['click-submit']).toEqual((await triggered.grounding()).entries['click-submit']);
    expect(completion.groundingWrites()).toHaveLength(1);
  });

  it('TEST-SAVE-2 saves an intermediate operation absent from confirms', async () => {
    const f = await fixture([click(), fill(), check('confirm', ['click-submit'])]);
    const outcome = await execute(f);
    expect(outcome.results[0]!.result.status).toBe('passed');
    confirmed(outcome, ['click-submit', 'fill-email']);
    expect((await f.grounding()).entries).toEqual({ 'click-submit': entry(click()), 'fill-email': entry(fill(), EMAIL) });
    expect(f.groundingWrites()).toHaveLength(1);
  });

  it('TEST-SAVE-2 promotes at completion after an ambiguous element-visible confirmation', async () => {
    const f = await fixture([click(), visible()], {
      configureSession(session) {
        vi.mocked(session.accessibilitySnapshot).mockResolvedValueOnce(snapshot()).mockResolvedValue(snapshot([SUBMIT, SUBMIT]));
      },
    });
    const outcome = await execute(f);
    expect(outcome.results[0]!.result.status).toBe('passed');
    confirmed(outcome, ['click-submit']);
    expect((await f.grounding()).entries['click-submit']).toEqual(entry(click()));
  });

  const shapes: readonly [string, readonly TestStep[], readonly string[]][] = [
    ['after the last assertion', [check(), click()], ['click-submit']],
    ['uncovered intermediate operation', [click(), fill(), check('confirm', ['click-submit'])], ['click-submit', 'fill-email']],
    ['assertion only at the start', [check(), navigate, fill(), click()], ['fill-email', 'click-submit']],
    ['no assertions', [navigate, click()], ['click-submit']],
    ['capture', [capture, click()], ['capture-email', 'click-submit']],
    ['covered AI trace', [click(), aiStep()], ['click-submit']],
  ];
  it.each(shapes)('TEST-SAVE-3/9 saves and replays %s without AI', async (_name, steps, ids) => {
    const f = await fixture(steps);
    const first = await execute(f);
    expect(first.results[0]!.result.status).toBe('passed');
    confirmed(first, ids);
    const saved = await f.grounding();
    for (const id of ids) expect(saved.entries[id], id).toBeDefined();
    if (steps.some((step) => step.kind === 'ai')) expect(saved.entries['recorded-ai']).toMatchObject({ kind: 'ai' });
    const noAi = vi.fn<RunDeps['resolveAiExecutor']>(async () => { throw new Error('Replay must not request an AI executor.'); });
    const second = await run({ ...f.deps, resolveAiExecutor: noAi }, { ...DEFAULT_OPTIONS, resolve: false });
    expect(second.results[0]!.result.status).toBe('passed');
    assertZeroAiCalls(report(second).envelope);
    expect(report(second).envelope.errors).toEqual([]);
    expect(noAi).not.toHaveBeenCalled();
  });

  it('TEST-SAVE-3 preserves an existing entry and its provenance beside a fresh binding', async () => {
    const cached = entry(click(), SUBMIT, 'ai-proposed');
    const f = await fixture([click(), fill()], { entries: { 'click-submit': cached } });
    const outcome = await execute(f);
    confirmed(outcome, ['click-submit', 'fill-email']);
    expect((await f.grounding()).entries).toEqual({ 'click-submit': cached, 'fill-email': entry(fill(), EMAIL) });
  });

  it.each(['missing step', 'navigate step', 'grounding provenance', 'missing provenance'] as const)(
    'TEST-SAVE-4 rejects a second %s without mutating any binding', (fault) => {
      type Context = Parameters<typeof planCompletionPromotions>[0];
      const first = { stage: 'acted', locator: SUBMIT, fingerprint: fingerprint(SUBMIT), provenance: 'quoted-match', quoteWaitMs: 0 } as const;
      const second = { ...first, provenance: fault === 'grounding provenance' ? 'grounding' : fault === 'missing provenance' ? undefined : 'ai-proposed' };
      const preserved = { ...first, stage: 'confirmed' } as const;
      const context = {
        bindingStates: new Map<string, unknown>([['earlier-confirmed', preserved], ['first', first], ['second', second]]),
        actionSteps: new Map([
          ['earlier-confirmed', Step.parse({ ...click('earlier-confirmed'), target: 'web' })],
          ['first', Step.parse({ ...click('first'), target: 'web' })],
          ...(fault === 'missing step' ? [] : [['second', Step.parse({ ...(fault === 'navigate step' ? { ...navigate, id: 'second' } : click('second')), target: 'web' })] as const]),
        ]),
      } as unknown as Context;
      const beforeBindings = [...context.bindingStates].map(([id, state]) => [id, { ...state }]);
      const beforeSteps = [...context.actionSteps];
      let returned: ReturnType<typeof planCompletionPromotions> | undefined;
      expect(() => { returned = planCompletionPromotions(context); }).toThrow(IntegrityViolationError);
      expect(returned).toBeUndefined();
      expect([...context.bindingStates]).toEqual(beforeBindings);
      expect([...context.actionSteps]).toEqual(beforeSteps);
      expect(context.bindingStates.get('first')).toBe(first);
      expect(context.bindingStates.get('earlier-confirmed')).toBe(preserved);
    },
  );

  it('plans only acted bindings in insertion order without changing metadata or cached entries', () => {
    type Context = Parameters<typeof planCompletionPromotions>[0];
    const state = { stage: 'acted', locator: SUBMIT, fingerprint: fingerprint(SUBMIT), provenance: 'quoted-match', quoteWaitMs: 12 } as const;
    const proposed = { ...state, provenance: 'ai-proposed', aiProposalMs: 34 } as const;
    const context: Context = {
      bindingStates: new Map<string, Context['bindingStates'] extends ReadonlyMap<string, infer Value> ? Value : never>([
        ['candidate', { ...state, stage: 'candidate' }],
        ['first', state],
        ['cached', { ...state, stage: 'confirmed', provenance: 'grounding' }],
        ['second', proposed],
      ]),
      actionSteps: new Map(['candidate', 'first', 'cached', 'second'].map((id) => [id, Step.parse({ ...click(id), target: 'web' }) as Context['actionSteps'] extends ReadonlyMap<string, infer Value> ? Value : never])),
    };
    const before = [...context.bindingStates].map(([id, binding]) => [id, { ...binding }]);
    const planned = planCompletionPromotions(context);
    expect(planned).toEqual([
      { stepId: 'first', state, entry: entry(click('first')) },
      { stepId: 'second', state: proposed, entry: entry(click('second'), SUBMIT, 'ai-proposed') },
    ]);
    expect(planned[0]!.state).toBe(state);
    expect(planned[1]!.state).toBe(proposed);
    expect([...context.bindingStates]).toEqual(before);
  });

  it('plans no promotions for an empty binding set', () => {
    expect(planCompletionPromotions({ bindingStates: new Map(), actionSteps: new Map() })).toEqual([]);
  });

  it('TEST-SAVE-5 retains the exact entry from a unique confirms assertion', async () => {
    const f = await fixture([click(), visible()]);
    const outcome = await execute(f);
    expect(outcome.results[0]!.result.status).toBe('passed');
    expect((await f.grounding()).entries).toEqual({ 'click-submit': entry(click()) });
    expect(f.groundingWrites()).toHaveLength(1);
  });

  it.each([true, false])('TEST-SAVE-5 retains only a unique mid-case confirmation (unique=%s)', async (unique) => {
    const f = await fixture([click(), visible(), check('failure')], {
      browser: { assertOutcome: { passed: false, message: 'Dashboard was absent.' } },
      configureSession(session) {
        vi.mocked(session.accessibilitySnapshot).mockResolvedValueOnce(snapshot()).mockResolvedValue(snapshot(unique ? REFS : [SUBMIT, SUBMIT]));
      },
    });
    const outcome = await execute(f);
    expect(outcome.results[0]!.result.status).toBe('failed');
    expect((await f.grounding()).entries).toEqual(unique ? { 'click-submit': entry(click()) } : {});
    expect(outcome.results[0]!.result.steps[0]).toMatchObject({ binding: { confirmed: unique } });
  });

  it.each(['assertion', 'classified', 'exception', 'interrupted'] as const)(
    'TEST-SAVE-6 retains confirmed and AI entries but discards acted bindings on %s', async (ending) => {
      for (const withConfirmer of [true, false]) {
        const controller = new AbortController();
        const steps = [click(), ...(withConfirmer ? [check('confirm', ['click-submit'])] : []), fill(), aiStep(), check('failure')];
        const f = await fixture(steps, {
          signal: controller.signal,
          configureSession(session) {
            let calls = 0;
            vi.spyOn(session, 'evaluateAssert').mockImplementation(async () => {
              calls += 1;
              if (calls <= (withConfirmer ? 2 : 1)) return { passed: true };
              if (ending === 'classified') throw new FsIoError('Final observation failed.');
              if (ending === 'exception') throw new Error('Final observation crashed.');
              if (ending === 'interrupted') { controller.abort(); controller.signal.throwIfAborted(); }
              return { passed: false, message: 'Dashboard was absent.' };
            });
          },
        });
        const outcome = await execute(f);
        expect(outcome.results[0]!.result.status).toBe(ending === 'assertion' ? 'failed' : 'error');
        const results = outcome.results[0]!.result.steps;
        expect(results.slice(0, -1).every((step) => step.status === 'passed')).toBe(true);
        expect(results.at(-1)).toMatchObject({ id: 'failure', status: ending === 'assertion' ? 'failed' : 'error' });
        expect(new Set(results.map((step) => step.id)).size).toBe(steps.length);
        if (ending === 'classified') expect(outcome.results[0]!.error).toBeInstanceOf(FsIoError);
        if (ending === 'exception') expect(outcome.results[0]!.error).toMatchObject({ kind: 'unexpected-crash' });
        if (ending === 'interrupted') expect(report(outcome).envelope.errors).toContainEqual(expect.objectContaining({ code: 'INTERRUPTED', scope: 'run' }));
        const saved = (await f.grounding()).entries;
        expect(saved['click-submit']).toEqual(withConfirmer ? entry(click()) : undefined);
        expect(saved['recorded-ai']).toMatchObject({ kind: 'ai' });
        expect(saved['fill-email']).toBeUndefined();
        expect(outcome.results[0]!.result.steps.find((step) => step.id === 'fill-email')).toMatchObject({ binding: { confirmed: false } });
      }
    },
  );

  it('TEST-SAVE-7 preserves successful statuses, exit code, AI count, and lifecycle events', async () => {
    const f = await fixture([check(), click()]);
    const outcome = await execute(f);
    expect(outcome.results[0]!.result).toMatchObject({ status: 'passed', aiCalls: 0, steps: [{ id: 'check-dashboard', status: 'passed' }, { id: 'click-submit', status: 'passed' }] });
    expect(report(outcome).exitCode).toBe(0);
    assertZeroAiCalls(report(outcome).envelope);
    expect(f.events.emitted()).toEqual([
      { type: 'step-start', stepId: 'check-dashboard' },
      { type: 'step-result', stepId: 'check-dashboard', via: 'grounding' },
      { type: 'step-start', stepId: 'click-submit' },
      { type: 'step-result', stepId: 'click-submit', via: 'quoted-match' },
    ]);
  });

  it.each(['CI', 'explicit local'] as const)('TEST-SAVE-8 confirms without writing under %s policy', async (policy) => {
    const f = await fixture([check(), click()]);
    const deps: RunDeps = { ...f.deps, isCI: policy === 'CI', config: { ...f.deps.config, grounding: { repositoryPolicy: 'committed', localWriteBack: policy === 'CI' ? 'auto' : 'explicit' } } };
    const outcome = await run(deps, DEFAULT_OPTIONS);
    expect(outcome.results[0]!.result.status).toBe('passed');
    confirmed(outcome, ['click-submit']);
    report(outcome);
    expect(f.groundingWrites()).toEqual([]);
    expect(await deps.storage.readText(f.groundingPath)).toBe(f.before);
  });

  it.each([{ steps: [check(), click()] }, { steps: [navigate, click()] }])('TEST-SAVE-8 reports a case error on a completion write failure ($steps)', async ({ steps }) => {
    const f = await fixture(steps);
    const original = f.deps.storage.writeText.bind(f.deps.storage);
    const writes = vi.spyOn(f.deps.storage, 'writeText').mockImplementation(async (path, text) => {
      if (path === f.groundingPath) throw new FsIoError('The grounding destination is unwritable.');
      return original(path, text);
    });
    const outcome = await execute(f);
    expect(outcome.results[0]!.result.status).toBe('error');
    expect(outcome.results[0]!.error).toBeInstanceOf(FsIoError);
    confirmed(outcome, ['click-submit']);
    expect(writes.mock.calls.filter(([path]) => path === f.groundingPath)).toHaveLength(1);
    expect(await f.deps.storage.readText(f.groundingPath)).toBe(f.before);
  });

  it('TEST-SAVE-8 rejects a secret-bearing payload before writing completion entries', async () => {
    const contaminated = { ...entry(click()), locator: { ...SUBMIT, name: SECRET } };
    const f = await fixture([secretFill, click()], { entries: { unrelated: contaminated } });
    const outcome = await execute(f);
    expect(outcome.results[0]!.result.status).toBe('error');
    expect(outcome.results[0]!.error).toBeInstanceOf(IntegrityViolationError);
    confirmed(outcome, ['fill-password', 'click-submit']);
    expect(f.groundingWrites()).toEqual([]);
    expect(await f.deps.storage.readText(f.groundingPath)).toBe(f.before);
    assertNoSecretDisclosure({ secrets: { password: SECRET }, report: report(outcome).envelope });
  });

  it('TEST-SAVE-8 scans a newly promoted locator containing a subsequently resolved secret', async () => {
    const locator = { ...SUBMIT, name: `Account ${SECRET}` };
    // Resolve this fresh binding before the secret is known, then materialize
    // the secret so only the completion payload scan can reject its locator.
    const f = await fixture([click('click-account', false), secretFill], {
      bindingRef: locator,
      configureSession(session) {
        const perform = session.perform.bind(session);
        vi.spyOn(session, 'perform').mockImplementation(async (action) => {
          await perform(action);
          vi.mocked(session.accessibilitySnapshot).mockResolvedValue(snapshot());
        });
      },
    });
    expect((await f.grounding()).entries).toEqual({});
    const writes = vi.spyOn(f.deps.storage, 'writeText');
    const outcome = await execute(f);
    expect(f.sessions[0]!.operations()).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'resolve-grounded', target: locator }),
      expect.objectContaining({ type: 'fill-secret', value: SECRET }),
    ]));
    expect(outcome.results[0]!.result.status).toBe('error');
    expect(outcome.results[0]!.error).toBeInstanceOf(IntegrityViolationError);
    confirmed(outcome, ['click-account', 'fill-password']);
    expect(writes.mock.calls.filter(([path]) => path === f.groundingPath)).toEqual([]);
    expect(f.groundingWrites()).toEqual([]);
    expect(await f.deps.storage.readText(f.groundingPath)).toBe(f.before);
    await assertContainedArtifacts(f, outcome);
  });

  it('TEST-SAVE-9 saves a click but leaves an uncovered AI step missing on replay', async () => {
    const f = await fixture([click(), aiStep()], { coveredAi: false });
    const first = await execute(f);
    expect(first.results[0]!.result.status).toBe('passed');
    expect((await f.grounding()).entries['click-submit']).toEqual(entry(click()));
    expect((await f.grounding()).entries['recorded-ai']).toBeUndefined();
    const second = await run(f.deps, { ...DEFAULT_OPTIONS, resolve: false });
    expect(second.results[0]!.error).toMatchObject({ kind: 'grounding-unresolved', details: { stepId: 'recorded-ai', reason: 'missing' } });
    assertZeroAiCalls(report(second).envelope);
  });

  it('TEST-SAVE-10 performs no grounding write or AI call on a second resolve', async () => {
    const f = await fixture([click(), fill()]);
    expect((await execute(f)).results[0]!.result.status).toBe('passed');
    expect(f.groundingWrites()).toHaveLength(1);
    const saved = await f.deps.storage.readText(f.groundingPath);
    f.recordingStorage.writes.length = 0;
    f.resolveAiExecutor.mockClear();
    const second = await execute(f);
    expect(second.results[0]!.result.status).toBe('passed');
    assertZeroAiCalls(report(second).envelope);
    expect(f.resolveAiExecutor).not.toHaveBeenCalled();
    expect(f.groundingWrites()).toEqual([]);
    expect(await f.deps.storage.readText(f.groundingPath)).toBe(saved);
  });

  it('TEST-SAVE-10 leaves matching committed entries byte-identical on resolve', async () => {
    const f = await fixture([click(), fill()], { entries: { 'click-submit': entry(click(), SUBMIT, 'ai-proposed'), 'fill-email': entry(fill(), EMAIL) } });
    const outcome = await execute(f);
    expect(outcome.results[0]!.result.status).toBe('passed');
    confirmed(outcome, ['click-submit', 'fill-email']);
    assertZeroAiCalls(report(outcome).envelope);
    expect(f.resolveAiExecutor).not.toHaveBeenCalled();
    expect(f.groundingWrites()).toEqual([]);
    expect(await f.deps.storage.readText(f.groundingPath)).toBe(f.before);
  });

  it('TEST-SAVE-10 resolves and rewrites a stale fingerprint', async () => {
    const stale = { ...entry(click()), fingerprint: { ...fingerprint(SUBMIT), hash: 'f'.repeat(64) } };
    const f = await fixture([click()], { entries: { 'click-submit': stale } });
    const outcome = await execute(f);
    expect(outcome.results[0]!.result.status).toBe('passed');
    expect((await f.grounding()).entries['click-submit']).toEqual(entry(click()));
    expect(f.groundingWrites()).toHaveLength(1);
  });

  it.each([true, false])('persists the fresh binding provenance (quoted=%s)', async (quoted) => {
    const step = click('click-submit', quoted);
    const f = await fixture([step]);
    const outcome = await execute(f);
    expect(outcome.results[0]!.result.status).toBe('passed');
    expect((await f.grounding()).entries['click-submit']).toEqual(entry(step, SUBMIT, quoted ? 'quoted-match' : 'ai-proposed'));
    expect(f.executor.structuredRequests).toHaveLength(quoted ? 0 : 1);
  });

  it('saves press, fill-secret, and a capture-to-fill reference without leaking materialized values', async () => {
    const press: TestStep = { id: 'press-submit', kind: 'action', action: 'press', intent: intent(SUBMIT), key: 'Enter' };
    const referenceFill: TestStep = { ...fill(), value: '{{run.email}}' } as TestStep;
    const f = await fixture([capture, referenceFill, secretFill, press]);
    const outcome = await execute(f);
    expect(outcome.results[0]!.result.status).toBe('passed');
    confirmed(outcome, ['capture-email', 'fill-email', 'fill-password', 'press-submit']);
    expect((await f.grounding()).entries).toEqual({
      'capture-email': entry(capture, EMAIL), 'fill-email': entry(referenceFill, EMAIL),
      'fill-password': entry(secretFill, PASSWORD), 'press-submit': entry(press),
    });
    expect(f.sessions[0]!.operations()).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'perform', action: expect.objectContaining({ type: 'fill', value: 'Captured value' }) }),
      expect.objectContaining({ type: 'fill-secret', value: SECRET }),
    ]));
    await assertContainedArtifacts(f, outcome);
  });

  it('TEST-SAVE-5 preserves confirmed capture, fill, secret-fill, and press entries and reference containment', async () => {
    const press: TestStep = { id: 'press-submit', kind: 'action', action: 'press', intent: intent(SUBMIT), key: 'Enter' };
    const referenceFill: TestStep = { ...fill(), value: '{{run.email}}' } as TestStep;
    const f = await fixture([capture, referenceFill, secretFill, press, check('confirm-all', ['capture-email', 'fill-email', 'fill-password', 'press-submit'])]);
    const outcome = await execute(f);
    expect(outcome.results[0]!.result.status).toBe('passed');
    confirmed(outcome, ['capture-email', 'fill-email', 'fill-password', 'press-submit']);
    expect((await f.grounding()).entries).toEqual({
      'capture-email': entry(capture, EMAIL), 'fill-email': entry(referenceFill, EMAIL),
      'fill-password': entry(secretFill, PASSWORD), 'press-submit': entry(press),
    });
    await assertContainedArtifacts(f, outcome);
  });

  it('saves bindings for each target independently', async () => {
    const targets = { web: { surface: 'web', baseUrl: 'https://example.test' }, admin: { surface: 'web', baseUrl: 'https://admin.example.test' } } as const;
    const f = await fixture([{ ...click(), target: 'web' }, { ...fill(), target: 'admin' }], { targets });
    const outcome = await execute(f);
    expect(outcome.results[0]!.result.status).toBe('passed');
    confirmed(outcome, ['click-submit', 'fill-email']);
    expect((await f.grounding()).entries).toEqual({ 'click-submit': entry(click()), 'fill-email': entry(fill(), EMAIL) });
    expect(f.sessions).toHaveLength(2);
  });

  it('does not promote when the signal aborts during the final operation', async () => {
    const controller = new AbortController();
    const f = await fixture([click()], { signal: controller.signal, browser: { onPerform: () => controller.abort() } });
    const outcome = await execute(f);
    expect(outcome.results[0]!.result.status).toBe('error');
    expect(f.groundingWrites()).toEqual([]);
    expect(await f.deps.storage.readText(f.groundingPath)).toBe(f.before);
  });

  it.each([{ steps: [] }, { steps: [navigate] }])('does not write grounding for a plan without element steps ($steps)', async ({ steps }) => {
    const f = await fixture(steps);
    const outcome = await execute(f);
    expect(outcome.results[0]!.result.status).toBe('passed');
    expect(f.groundingWrites()).toEqual([]);
    expect(await f.deps.storage.readText(f.groundingPath)).toBe(f.before);
  });
});
