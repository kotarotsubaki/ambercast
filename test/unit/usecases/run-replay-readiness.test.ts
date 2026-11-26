/** Run results describe the persisted grounding after write-back without changing execution outcomes. Storage failures remain diagnostics, write restrictions are explicit, and healing assesses its isolated candidate rather than the original files. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FsIoError } from '#core/errors/fs-io-error.js';
import { IntegrityViolationError } from '#core/errors/integrity-violation-error.js';
import { SecretConsentRequiredError } from '#core/errors/secret-consent-required-error.js';
import { computeIntentDigest } from '#core/ir/digest.js';
import { computeAccessibilityFingerprint } from '#core/ir/fingerprint.js';
import { readGroundingDocument, GroundingDocument, type ElementRef, type JsonValueT } from '#core/ir/schema.js';
import { run, type RunDeps } from '#usecases/run.js';
import { heal } from '#usecases/heal.js';
import { buildRunReport } from '#usecases/run-report.js';
import { buildHealReport } from '#usecases/heal-report.js';
import { assessReplayReadiness } from '#usecases/replay-readiness.js';
import { createFakeAiExecutor } from '../../doubles/fake-ai-executor.js';
import { createFakeSecretsProvider } from '../../doubles/fake-secrets-provider.js';
import { createFakeUiExecutor } from '../../doubles/fake-ui-executor.js';
import { elementRefKey, type FakeBrowserSessionOptions } from '../../doubles/fake-browser-session.js';
import { assertDiagnosable, assertZeroAiCalls, assertNoSecretDisclosure, collectStorageArtifacts } from '../../support/report-assertions.js';
import { aiStep, createScenario, createFakeBrowserSession, DEFAULT_OPTIONS, liveEntries, RUNS_DIR, seedFreshArtifacts, writePrompt, type TestStep } from '../../support/run-scenario.js';
import { createScenario as createHealScenario, OPTIONS as HEAL_OPTIONS, REPAIRED_SUBMIT, FINGERPRINT as HEAL_FINGERPRINT, healAccessibilityTree } from '../../support/heal-scenario.js';

const observed = vi.hoisted(() => ({ runs: [] as { outcome: Awaited<ReturnType<typeof import('#usecases/run.js')['run']>>; text: string }[] }));
vi.mock('#usecases/run.js', async importOriginal => {
  const actual = await importOriginal<typeof import('#usecases/run.js')>();
  return { ...actual, run: async (...args: Parameters<typeof actual.run>) => {
    const outcome = await actual.run(...args);
    if (args[0].storage !== activeStorage && outcome.results[0]?.result.status === 'passed') {
      observed.runs.push({ outcome, text: await args[0].storage.readText(args[0].layout.groundingPathFor(HEAL_OPTIONS.files[0]!)) });
    }
    return outcome;
  } };
});
let activeStorage: RunDeps['storage'] | undefined;
afterEach(() => { observed.runs.length = 0; activeStorage = undefined; });

const PROMPT = '# Replay stored bindings\n\nUse "Submit", "Email", and "Password" to reach the dashboard.\n';
const SUBMIT = { strategy: 'accessibility', role: 'button', name: 'Submit' } as const;
const EMAIL = { strategy: 'accessibility', role: 'textbox', name: 'Email' } as const;
const PASSWORD = { strategy: 'accessibility', role: 'textbox', name: 'Password' } as const;
const REFS = [SUBMIT, EMAIL, PASSWORD];
const SECRET_REF = '{{secrets.password}}';
const SECRET = 'ReplayReadinessPrivateCredential_42!';
const tree: JsonValueT = { role: 'root', name: '', children: REFS.map(({ role, name }) => ({ role, name, children: [] })) };
function fingerprint(ref: ElementRef) {
  const result = computeAccessibilityFingerprint(tree, ref, []);
  if (result.kind !== 'ok') throw new Error('The fixture requires a unique element.');
  return result.fingerprint;
}
function components(ref: ElementRef) {
  const result = computeAccessibilityFingerprint(tree, ref, []);
  if (result.kind !== 'ok') throw new Error('The fixture requires unique component evidence.');
  return result.components;
}
function intent(ref: ElementRef) {
  const startColumn = PROMPT.split('\n')[2]!.indexOf(ref.name) + 1;
  const sourceSpan = { startLine: 3, startColumn, endLine: 3, endColumn: startColumn + ref.name.length };
  return { description: ref.name, roleHint: ref.role, sourceSpan, quote: { text: ref.name, sourceSpan } };
}
const click = (id = 'click'): TestStep => ({ id, kind: 'action', action: 'click', intent: intent(SUBMIT) });
const fill: TestStep = { id: 'fill', kind: 'action', action: 'fill', intent: intent(EMAIL), value: 'example' };
const secretFill: TestStep = { id: 'secret', kind: 'action', action: 'fill-secret', intent: intent(PASSWORD), secretRef: SECRET_REF };
const capture: TestStep = { id: 'capture', kind: 'capture', intent: intent(EMAIL), variable: 'email' };
const navigate: TestStep = { id: 'navigate', kind: 'action', action: 'navigate', url: '/' };
const check = (id = 'dashboard', confirms?: string[]): TestStep => ({ id, kind: 'assert', check: 'text-visible', text: 'Dashboard', timeoutMs: 0, ...(confirms === undefined ? {} : { confirms }) });
function entry(step: TestStep = click(), locator: ElementRef = SUBMIT) {
  if ((step.kind !== 'action' && step.kind !== 'capture') || !('intent' in step)) throw new Error('Expected an element fixture.');
  return { kind: 'element' as const, locator, fingerprint: fingerprint(locator), components: components(locator), provenance: 'quoted-match' as const,
    intentDigest: computeIntentDigest({ stepKind: step.kind, operation: step.kind === 'capture' ? 'capture' : step.action, intent: step.intent }) };
}
async function fixture(steps: readonly TestStep[] = [check(), click()], options: {
  entries?: GroundingDocument['entries']; browser?: FakeBrowserSessionOptions; coveredAi?: boolean;
} = {}) {
  const executor = createFakeAiExecutor({ executeAgentic: async request => {
    if (options.coveredAi === false) await request.controller.snapshotForResolution();
    else await request.controller.evaluateAssert({ type: 'assert', check: 'text-visible', text: 'Dashboard' }, 'dashboard-reached');
    return { outcome: 'success' };
  } });
  const base = createScenario({
    secrets: createFakeSecretsProvider(new Map([[SECRET_REF, SECRET]])),
    resolveAiExecutor: vi.fn(async () => executor),
    uiExecutor: vi.fn(() => createFakeUiExecutor(() => {
      const live = new Map(REFS.flatMap(ref => [...liveEntries([ref], fingerprint(ref))]));
      const session = createFakeBrowserSession(live, { snapshot: { accessibilityTree: tree, screenshot: new Uint8Array([1]) },
        captureValues: new Map([[elementRefKey(EMAIL), { text: 'Captured email', value: 'Captured email' }]]), ...options.browser });
      vi.spyOn(session, 'accessibilitySnapshot').mockResolvedValue({ tree, rawYaml: JSON.stringify(tree), scalarValues: [] });
      return session;
    })),
  });
  activeStorage = base.deps.storage;
  const path = await writePrompt(base.deps.storage, 'login.test.md', PROMPT);
  const plan = await seedFreshArtifacts(base.deps.storage, path, steps, options.entries ?? {}, steps.length === 0 ? {} : undefined);
  const groundingPath = base.deps.layout.groundingPathFor(path);
  const before = await base.deps.storage.readText(groundingPath);
  base.recordingStorage.writes.length = 0;
  return { ...base, path, plan, groundingPath, before,
    groundingWrites: () => base.recordingStorage.writes.filter(write => write.path === groundingPath) };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
type Outcome = Awaited<ReturnType<typeof run>>;
function report(outcome: Outcome) {
  const built = buildRunReport({ startedAt: '2026-11-20T00:00:00Z', durationMs: 0, options: DEFAULT_OPTIONS, outcome });
  assertDiagnosable(built.envelope);
  return built;
}
function readiness(outcome: Outcome) { return outcome.results[0]!.result.replayReadiness; }
const unresolved = (...ids: string[]) => ({ status: 'not-ready', reason: 'steps-unresolved', steps: ids.map(id => ({ id, reason: 'no-entry' })) });
async function execute(f: Fixture, deps: RunDeps = f.deps, options = DEFAULT_OPTIONS) {
  const outcome = await run(deps, options);
  report(outcome);
  return outcome;
}

describe('TEST-READY-2 persisted run readiness', () => {
  it('F01 retains readiness when secret consent rejects a trusted plan before execution preparation', async () => {
    const f = await fixture([secretFill]);
    const outcome = await execute(f, { ...f.deps, config: { ...f.deps.config, secrets: { allow: [] } } });
    const built = report(outcome);
    expect(outcome.results[0]!.error).toBeInstanceOf(SecretConsentRequiredError);
    expect(outcome.results[0]!.error).toMatchObject({
      kind: 'secret-consent-required', message: 'Secret consent is required.',
      details: { reason: 'consent-required', secrets: [{ name: 'password', stepId: 'secret', envVar: 'AMBERCAST_SECRET_PASSWORD', reason: 'not included in secrets.allow' }] },
    });
    expect(outcome.results[0]!.result).toMatchObject({ status: 'error', steps: [] });
    expect(built.exitCode).toBe(2);
    expect(built.envelope.errors).toMatchObject([{ scope: 'case', code: 'SECRET_CONSENT_REQUIRED', message: 'Secret consent is required.' }]);
    expect(f.deps.uiExecutor).not.toHaveBeenCalled();
    expect(f.deps.resolveAiExecutor).not.toHaveBeenCalled();
    expect(f.groundingWrites()).toEqual([]);
    // Consent fails before the grounding path is assigned, even though the fixture has a cache.
    const expected = { status: 'not-ready', reason: 'grounding-missing' };
    expect.soft(outcome.results[0]!.result).toHaveProperty('replayReadiness', expected);
    expect(built.envelope.results[0]).toHaveProperty('replayReadiness', expected);
  });

  const shapes: readonly [string, readonly TestStep[]][] = [
    ['trailing operation', [check(), click()]],
    ['intermediate operation', [click(), fill, check('confirm', ['click'])]],
    ['initial assertion', [check(), navigate, click()]],
    ['no assertions', [navigate, click()]],
    ['capture', [capture, click()]],
    ['covered AI', [click(), aiStep()]],
    ['press', [{ id: 'press', kind: 'action', action: 'press', intent: intent(SUBMIT), key: 'Enter' }]],
    ['secret fill', [secretFill]],
  ];
  it.each(shapes)('is explicitly ready after resolving %s and accepts the entries produced by run', async (_name, steps) => {
    const f = await fixture(steps);
    const outcome = await execute(f);
    expect(outcome.results[0]!.result.status).toBe('passed');
    expect(f.groundingWrites()).toHaveLength(1);
    const saved = await f.deps.storage.readText(f.groundingPath);
    GroundingDocument.parse(JSON.parse(saved));
    expect(readiness(outcome)).toEqual({ status: 'ready' });
    expect(assessReplayReadiness(f.plan, { kind: 'text', text: saved })).toEqual({ status: 'ready' });
    expect(report(outcome).envelope.results[0]).toHaveProperty('replayReadiness', { status: 'ready' });
    const replay = await execute(f, f.deps, { ...DEFAULT_OPTIONS, resolve: false });
    expect(replay.results[0]!.result.status).toBe('passed');
    expect(readiness(replay)).toEqual({ status: 'ready' });
    assertZeroAiCalls(report(replay).envelope);
  });

  it.each(['CI', 'explicit local'] as const)('reports an unsaved change under %s policy, with and without update-cache', async policy => {
    for (const updateCache of [false, true]) {
      const f = await fixture();
      const deps = { ...f.deps, isCI: policy === 'CI', config: { ...f.deps.config,
        grounding: { repositoryPolicy: 'committed' as const, localWriteBack: policy === 'CI' ? 'auto' as const : 'explicit' as const } } };
      const outcome = await execute(f, deps, { ...DEFAULT_OPTIONS, updateCache });
      expect(outcome.results[0]!.result.status).toBe('passed');
      expect(readiness(outcome)).toEqual(updateCache ? { status: 'ready' } : { ...unresolved('click'), unsavedReason: 'write-back-not-allowed' });
      expect(f.groundingWrites()).toHaveLength(updateCache ? 1 : 0);
      if (!updateCache) expect(await f.deps.storage.readText(f.groundingPath)).toBe(f.before);
      expect(report(outcome).exitCode).toBe(0);
    }
  });

  it('reports a missing artifact and the write restriction when resolution cannot save its first entries', async () => {
    const f = await fixture();
    const exists = f.deps.storage.exists.bind(f.deps.storage);
    vi.spyOn(f.deps.storage, 'exists').mockImplementation(async path => path === f.groundingPath ? false : exists(path));
    const outcome = await execute(f, { ...f.deps, isCI: true });
    expect(outcome.results[0]!.result.status).toBe('passed');
    expect(f.groundingWrites()).toEqual([]);
    expect(readiness(outcome)).toEqual({ status: 'not-ready', reason: 'grounding-missing', unsavedReason: 'write-back-not-allowed' });
  });

  it('omits unsavedReason when stored coverage is ready even though a live fingerprint repair cannot be saved', async () => {
    const cached = { ...entry(), fingerprint: { ...fingerprint(SUBMIT), hash: 'b'.repeat(64) } };
    const f = await fixture([click()], { entries: { click: cached } });
    const outcome = await execute(f, { ...f.deps, isCI: true });
    expect(outcome.results[0]!.result.status).toBe('passed');
    expect(outcome.results[0]!.result.steps[0]).toMatchObject({ binding: { provenance: 'quoted-match', confirmed: true } });
    expect(f.groundingWrites()).toEqual([]);
    expect(await f.deps.storage.readText(f.groundingPath)).toBe(f.before);
    expect(readiness(outcome)).toEqual({ status: 'ready' });
  });

  it('does not label unchanged incomplete grounding as an unsaved change', async () => {
    const f = await fixture([click()]);
    const outcome = await execute(f, { ...f.deps, isCI: true }, { ...DEFAULT_OPTIONS, resolve: false });
    expect(outcome.results[0]!.result.status).toBe('error');
    expect(outcome.results[0]!.error).toMatchObject({ kind: 'grounding-unresolved', details: { stepId: 'click', reason: 'missing' } });
    expect(readiness(outcome)).toEqual(unresolved('click'));
    assertZeroAiCalls(report(outcome).envelope);
  });

  it.each([false, true])('reports stored confirmations and unresolved trailing work after an assertion fails (skip observation=%s)', async (skipAssertObservation) => {
    let failingStepStarted = false;
    const f = await fixture([click(), check('confirm', ['click']), fill, check('failure')]);
    const executor = f.deps.uiExecutor;
    const emit = f.deps.events.emit.bind(f.deps.events);
    const outcome = await execute(f, { ...f.deps,
      events: { emit(event) {
        emit(event);
        if (event.type === 'step-start' && event.stepId === 'failure') failingStepStarted = true;
      } },
      uiExecutor(...args) {
        const driver = executor(...args);
        return { ...driver, async launch(...launchArgs) {
          const session = await driver.launch(...launchArgs);
          // Advisory reads cannot consume a later production verdict.
          vi.spyOn(session, 'evaluateAssert').mockImplementation(async () => failingStepStarted
            ? { passed: false, message: 'Dashboard absent.' } : { passed: true });
          return session;
        } };
      },
    }, { ...DEFAULT_OPTIONS, skipAssertObservation });
    expect(outcome.results[0]!.result.status).toBe('failed');
    expect(GroundingDocument.parse(JSON.parse(await f.deps.storage.readText(f.groundingPath))).entries).toEqual({ click: entry() });
    expect(readiness(outcome)).toEqual(unresolved('fill'));
    expect(report(outcome).exitCode).toBe(1);
  });

  it('stays ready when a fully grounded replay fails an assertion', async () => {
    const f = await fixture([click(), check()], { entries: { click: entry() }, browser: { assertOutcome: { passed: false, message: 'Dashboard absent.' } } });
    const outcome = await execute(f, f.deps, { ...DEFAULT_OPTIONS, resolve: false });
    expect(outcome.results[0]!.result.status).toBe('failed');
    expect(outcome.results[0]!.result.steps.at(-1)).toMatchObject({ status: 'failed', kind: 'assertion' });
    expect(readiness(outcome)).toEqual({ status: 'ready' });
    assertZeroAiCalls(report(outcome).envelope);
    expect(report(outcome).exitCode).toBe(1);
  });

  it('preserves the write error and assesses the unchanged file without an unsaved restriction', async () => {
    const f = await fixture();
    const original = f.deps.storage.writeText.bind(f.deps.storage);
    const fault = new FsIoError('The grounding destination is unwritable.');
    vi.spyOn(f.deps.storage, 'writeText').mockImplementation(async (path, text) => { if (path === f.groundingPath) throw fault; return original(path, text); });
    const outcome = await execute(f);
    expect(outcome.results[0]!.error).toBeInstanceOf(FsIoError);
    expect(outcome.results[0]!.error).toMatchObject({ message: 'The grounding cache could not be written.' });
    expect(outcome.results[0]!.result.status).toBe('error');
    expect(readiness(outcome)).toEqual(unresolved('click'));
    expect(await f.deps.storage.readText(f.groundingPath)).toBe(f.before);
  });

  it('preserves a secret-scan error and derives readiness from the existing file', async () => {
    const contaminated = { ...entry(), locator: { ...SUBMIT, name: SECRET } };
    const f = await fixture([secretFill, click()], { entries: { unrelated: contaminated } });
    const outcome = await execute(f);
    expect(outcome.results[0]!.error).toBeInstanceOf(IntegrityViolationError);
    expect(outcome.results[0]!.result.status).toBe('error');
    expect(readiness(outcome)).toEqual(unresolved('secret', 'click'));
    expect(f.groundingWrites()).toEqual([]);
    expect(await f.deps.storage.readText(f.groundingPath)).toBe(f.before);
    assertNoSecretDisclosure({ secrets: { password: SECRET }, report: report(outcome).envelope });
  });

  it.each(['read throws', 'exists false', 'exists throws'] as const)('reflects %s only after a successful write without changing status', async fault => {
    const f = await fixture();
    const originalRead = f.deps.storage.readText.bind(f.deps.storage);
    const originalExists = f.deps.storage.exists.bind(f.deps.storage);
    const originalWrite = f.deps.storage.writeText.bind(f.deps.storage);
    let written = false;
    vi.spyOn(f.deps.storage, 'writeText').mockImplementation(async (path, text) => { await originalWrite(path, text); if (path === f.groundingPath) written = true; });
    const read = vi.spyOn(f.deps.storage, 'readText').mockImplementation(async path => { if (written && path === f.groundingPath && fault === 'read throws') throw new FsIoError('The stored grounding could not be reread.'); return originalRead(path); });
    const exists = vi.spyOn(f.deps.storage, 'exists').mockImplementation(async path => {
      if (written && path === f.groundingPath && fault !== 'read throws') { if (fault === 'exists throws') throw new Error('Inspection failed.'); return false; }
      return originalExists(path);
    });
    const outcome = await execute(f);
    expect(written).toBe(true);
    expect(GroundingDocument.parse(JSON.parse(await originalRead(f.groundingPath))).entries.click).toBeDefined();
    expect(outcome.results[0]!.result.status).toBe('passed');
    expect(outcome.results[0]!.error).toBeUndefined();
    expect(report(outcome).exitCode).toBe(0);
    expect(readiness(outcome)).toEqual({ status: 'not-ready', reason: fault === 'read throws' ? 'grounding-unreadable' : 'grounding-missing' });
    expect(exists).toHaveBeenCalledWith(f.groundingPath);
    if (fault === 'read throws') expect(read.mock.calls.filter(([path]) => path === f.groundingPath).length).toBeGreaterThanOrEqual(2);
  });

  it.each(['passed', 'failed', 'error'] as const)('does not replace a %s outcome or error when read-back fails', async ending => {
    const f = await fixture([click(), check()], { entries: { click: entry() }, browser: { assertOutcome: ending === 'failed' ? { passed: false, message: 'Dashboard absent.' } : { passed: true } } });
    const original = f.deps.storage.readText.bind(f.deps.storage);
    let reads = 0;
    vi.spyOn(f.deps.storage, 'readText').mockImplementation(async path => {
      if (path === f.groundingPath && ++reads > 1) throw new FsIoError('Readiness inspection failed.');
      return original(path);
    });
    const fault = new FsIoError('The case browser failed.');
    let deps = f.deps;
    if (ending === 'error') {
      const executor = f.deps.uiExecutor;
      const uiExecutor: RunDeps['uiExecutor'] = (...args) => {
        const driver = executor(...args);
        return { ...driver, async launch(...launchArgs) { const session = await driver.launch(...launchArgs); vi.spyOn(session, 'evaluateAssert').mockRejectedValue(fault); return session; } };
      };
      deps = { ...f.deps, uiExecutor };
    }
    const outcome = await execute(f, deps, { ...DEFAULT_OPTIONS, resolve: false });
    expect(outcome.results[0]!.result.status).toBe(ending);
    if (ending === 'error') expect(outcome.results[0]!.error).toMatchObject({ kind: fault.kind, message: fault.message });
    else expect(outcome.results[0]!.error).toBeUndefined();
    expect(readiness(outcome)).toEqual({ status: 'not-ready', reason: 'grounding-unreadable' });
    assertZeroAiCalls(report(outcome).envelope);
  });

  it.each(['missing', 'stale', 'invalid'] as const)('omits readiness before a trusted plan is obtained (%s plan)', async state => {
    const f = await fixture();
    const path = f.deps.layout.planPathFor(f.path);
    if (state === 'missing') { const original = f.deps.storage.exists.bind(f.deps.storage); vi.spyOn(f.deps.storage, 'exists').mockImplementation(async candidate => candidate === path ? false : original(candidate)); }
    if (state === 'stale') await f.deps.storage.writeText(f.path, `${PROMPT}\nChanged intent.\n`);
    if (state === 'invalid') await f.deps.storage.writeText(path, '{');
    const outcome = await execute(f);
    expect(outcome.results[0]!.result.status).toBe('error');
    expect(outcome.results[0]!.result).not.toHaveProperty('replayReadiness');
    expect(report(outcome).envelope.results[0]).not.toHaveProperty('replayReadiness');
  });

  it.each([{ steps: [] }, { steps: [navigate, check()] }])('does not reread grounding for an entry-free plan ($steps)', async ({ steps }) => {
    const f = await fixture(steps);
    const original = f.deps.storage.readText.bind(f.deps.storage);
    const reads = vi.spyOn(f.deps.storage, 'readText').mockImplementation(async path => { if (path === f.groundingPath) throw new Error('Entry-free plans must not read grounding.'); return original(path); });
    const outcome = await execute(f);
    expect(outcome.results[0]!.result.status).toBe('passed');
    expect(readiness(outcome)).toEqual({ status: 'ready' });
    // Execution's existing cache load tolerates this fault. Readiness must
    // short-circuit before making a second storage read of its own.
    expect(reads.mock.calls.filter(([path]) => path === f.groundingPath)).toHaveLength(1);
  });

  it('reports an unrecorded successful AI step as no-entry and contains materialized values', async () => {
    const f = await fixture([capture, secretFill, click(), aiStep()], { coveredAi: false });
    const outcome = await execute(f);
    expect(outcome.results[0]!.result.status).toBe('passed');
    expect(readiness(outcome)).toEqual(unresolved('recorded-ai'));
    const envelope = report(outcome).envelope;
    await f.deps.storage.writeText(`${RUNS_DIR}/readiness-report.json`, JSON.stringify(envelope));
    assertNoSecretDisclosure({ secrets: { password: SECRET, captured: 'Captured email' }, report: envelope,
      artifacts: await collectStorageArtifacts(f.deps.storage, [RUNS_DIR, f.deps.layout.planPathFor(f.path), f.groundingPath]) });
  });

  it('assesses heal candidates in overlay storage and leaves heal rows without readiness', async () => {
    const entries = new Map([[elementRefKey(REPAIRED_SUBMIT), { exists: true, currentFingerprint: HEAL_FINGERPRINT }]]);
    const fp = computeAccessibilityFingerprint(healAccessibilityTree(entries), REPAIRED_SUBMIT, []);
    if (fp.kind !== 'ok') throw new Error('The repaired fixture must be unique.');
    entries.get(elementRefKey(REPAIRED_SUBMIT))!.currentFingerprint = fp.fingerprint;
    const executor = createFakeAiExecutor({ execute: async request => {
      if (request.prompt.includes('Return one ElementBindingProposal outcome.')) return (request.context as { description?: string } | undefined)?.description === REPAIRED_SUBMIT.name
        ? { data: { proposal: { outcome: 'found', role: 'button', name: REPAIRED_SUBMIT.name } }, raw: '{}' }
        : { data: { proposal: { outcome: 'none' } }, raw: '{}' };
      return { data: { steps: [{ id: 'click-submit', kind: 'action', target: 'web', action: 'click', intent: {
        description: REPAIRED_SUBMIT.name, roleHint: 'button', startAnchor: 'L3', startColumn: 8, endAnchor: 'L3', endColumn: 14, citation: 'submit',
      } }], ambiguities: [] }, raw: '{}' };
    } });
    const f = await createHealScenario({ sessionEntries: entries, aiExecutor: executor });
    activeStorage = f.storage;
    const path = f.deps.layout.groundingPathFor(HEAL_OPTIONS.files[0]!);
    const before = await f.storage.readText(path);
    const result = await heal(f.deps, { ...HEAL_OPTIONS, dryRun: true });
    expect(result.outcome.results[0]).toMatchObject({ repairOutcome: 'healed' });
    expect(observed.runs.length).toBeGreaterThan(0);
    const candidate = observed.runs.at(-1)!;
    expect(GroundingDocument.parse(JSON.parse(candidate.text)).entries['click-submit']).toMatchObject({ locator: REPAIRED_SUBMIT });
    expect(candidate.text).not.toBe(before);
    expect(readiness(candidate.outcome)).toEqual({ status: 'ready' });
    expect(await f.storage.readText(path)).toBe(before);
    expect(result.outcome.results[0]).not.toHaveProperty('replayReadiness');
    const built = buildHealReport({ startedAt: '2026-11-20T00:00:00Z', durationMs: 0, options: { allowEmpty: false, list: false },
      outcome: { ...result.outcome, results: result.outcome.results.map(row => ({ ...row, application: 'preview-only' as const })) } });
    assertDiagnosable(built.envelope);
    expect(built.envelope.results[0]).not.toHaveProperty('replayReadiness');
  });
});

describe('TEST-READY-3 run assessment of valid grounding', () => {
  const aiEntry = { kind: 'ai' as const, trace: { events: [], verification: [{ type: 'assert' as const, check: 'text-visible' as const, text: 'Dashboard' }], verificationCoverage: { 'dashboard-reached': 0 } } };
  const complete = () => ({ click: entry(), fill: entry(fill, EMAIL), capture: entry(capture, EMAIL), 'recorded-ai': aiEntry });
  const rows: { name: string; entries: () => GroundingDocument['entries']; expected: object; status: 'passed' | 'error' }[] = [
    { name: 'all entries', entries: complete, expected: { status: 'ready' }, status: 'passed' },
    { name: 'one missing entry', entries: () => { const { fill: _missing, ...rest } = complete(); return rest; }, expected: unresolved('fill'), status: 'error' },
    { name: 'AI entry on an action', entries: () => ({ ...complete(), click: aiEntry }), expected: { status: 'not-ready', reason: 'steps-unresolved', steps: [{ id: 'click', reason: 'entry-mismatch' }] }, status: 'error' },
    { name: 'element entry on AI', entries: () => ({ ...complete(), 'recorded-ai': entry() }), expected: { status: 'not-ready', reason: 'steps-unresolved', steps: [{ id: 'recorded-ai', reason: 'entry-mismatch' }] }, status: 'error' },
    ...(['click', 'fill', 'capture'] as const).map(id => ({ name: `${id} intent mismatch`, entries: () => { const entries = complete(); return { ...entries, [id]: { ...entries[id], intentDigest: 'b'.repeat(64) } }; }, expected: { status: 'not-ready', reason: 'steps-unresolved', steps: [{ id, reason: 'entry-mismatch' }] }, status: 'error' as const })),
    { name: 'legacy trace', entries: () => ({ ...complete(), 'recorded-ai': { kind: 'ai', trace: { events: [], verification: aiEntry.trace.verification } } }), expected: { status: 'not-ready', reason: 'steps-unresolved', steps: [{ id: 'recorded-ai', reason: 'trace-uncovered' }] }, status: 'error' },
    { name: 'multiple unresolved steps in plan order', entries: () => ({ fill: aiEntry }), expected: { status: 'not-ready', reason: 'steps-unresolved', steps: [
      { id: 'click', reason: 'no-entry' }, { id: 'fill', reason: 'entry-mismatch' }, { id: 'capture', reason: 'no-entry' }, { id: 'recorded-ai', reason: 'no-entry' },
    ] }, status: 'error' },
  ];
  it.each(rows)('reports $name independently of the execution frontier', async ({ entries, expected, status }) => {
    const f = await fixture([navigate, click(), fill, capture, aiStep()], { entries: entries() });
    readGroundingDocument(JSON.parse(f.before));
    const outcome = await execute(f, f.deps, { ...DEFAULT_OPTIONS, resolve: false });
    expect(outcome.results[0]!.result.status).toBe(status);
    if (status === 'error') expect(outcome.results[0]!.error).toMatchObject({ kind: 'grounding-unresolved' });
    else expect(outcome.results[0]!.error).toBeUndefined();
    expect(f.groundingWrites()).toEqual([]);
    expect(await f.deps.storage.readText(f.groundingPath)).toBe(f.before);
    assertZeroAiCalls(report(outcome).envelope);
    expect(readiness(outcome)).toEqual(expected);
  });
});
