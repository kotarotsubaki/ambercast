import { afterEach, describe, expect, it, vi } from 'vitest';
import * as canonicalJson from '#core/ir/canonical-json.js';
import { FsIoError } from '#core/errors/fs-io-error.js';
import { IntegrityViolationError } from '#core/errors/integrity-violation-error.js';
import { elementRefKey } from '../../doubles/fake-browser-session.js';
import { createFakeSecretsProvider } from '../../doubles/fake-secrets-provider.js';
import { toCanonicalArtifactText } from '#core/ir/canonical-json.js';
import { computeIntentDigest, computePlanDigest } from '#core/ir/digest.js';
import type { JsonValueT, FingerprintNameSlot } from '#core/ir/schema.js';
import { run } from '#usecases/run.js';
import { buildRunReport } from '#usecases/run-report.js';
import { createFakeAiExecutor } from '../../doubles/fake-ai-executor.js';
import { createFakeUiExecutor } from '../../doubles/fake-ui-executor.js';
import { createScenario, createFakeBrowserSession, liveEntries, writePrompt, createFreshPlan, DEFAULT_OPTIONS, type TestStep } from '../../support/run-scenario.js';
import { neighborTree, observation, RELAX_REF } from '../../support/relaxed-fingerprint.js';
import { assertDiagnosable, assertNoSecretDisclosure, assertZeroAiCalls } from '../../support/report-assertions.js';

const PROMPT = '# Submit\n\nClick "Submit".\n';
afterEach(() => vi.restoreAllMocks());
const SECRET = 'RelaxedPersistenceSecret_29!';
const SPAN = { startLine: 3, startColumn: 1, endLine: 3, endColumn: 16 };
function click(quoted = true, id = 'click'): TestStep {
  return { id, kind: 'action', action: 'click', intent: { description: 'Click Submit', roleHint: 'button', sourceSpan: SPAN,
    ...(quoted ? { quote: { text: 'Submit', sourceSpan: { ...SPAN, startColumn: 8, endColumn: 14 } } } : {}),
  } };
}
const check = (id: string, confirms?: string[]): TestStep => ({ id, kind: 'assert', check: 'text-visible', text: 'Done', timeoutMs: 0, ...(confirms ? { confirms } : {}) });
const canonical = (value: unknown) => toCanonicalArtifactText(value as JsonValueT);
function entry(step: TestStep = click(), ignoredNames?: FingerprintNameSlot[], tree = neighborTree()) {
  if (step.kind !== 'action' || !('intent' in step)) throw new Error('Fixture needs an element action.');
  return { kind: 'element' as const, locator: RELAX_REF, ...observation(tree), provenance: 'quoted-match' as const,
    intentDigest: computeIntentDigest({ stepKind: 'action', operation: 'click', intent: step.intent }), ...(ignoredNames ? { ignoredNames } : {}) };
}

async function fixture(options: {
  quoted?: boolean; ignored?: FingerprintNameSlot[]; change?: Record<string, string | boolean>;
  stored?: Record<string, unknown>; steps?: TestStep[]; signal?: AbortSignal;
  ending?: 'failure' | 'interrupted'; disabledWrite?: boolean; transientVerify?: boolean; secret?: boolean;
} = {}) {
  const step = click(options.quoted ?? true);
  let tree = neighborTree(options.change ?? { siblingBefore: 'Beta' });
  const stored = options.stored ?? entry(step, options.ignored);
  const retained = { ...entry(click(true, 'untouched')), ...(options.secret ? { locator: { ...RELAX_REF, name: SECRET } } : {}) };
  let finalStarted = false;
  const sessions: ReturnType<typeof createFakeBrowserSession>[] = [];
  const executor = createFakeAiExecutor({ execute: async () => ({ data: { proposal: { outcome: 'found', role: 'button', name: 'Submit' } }, raw: '{}' }) });
  const scenario = createScenario({
    ...(options.secret ? { secrets: createFakeSecretsProvider(new Map([['{{secrets.password}}', SECRET]])) } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    resolveAiExecutor: vi.fn(async () => executor),
    uiExecutor: () => createFakeUiExecutor(() => {
      const snapshot = { accessibilityTree: tree, screenshot: new Uint8Array([1]) };
      const live = liveEntries([RELAX_REF], observation(tree).fingerprint);
      const session = createFakeBrowserSession(live, { snapshot });
      if (options.transientVerify) {
        const resolve = session.resolveGrounded.bind(session);
        vi.spyOn(session, 'resolveGrounded').mockImplementation(async (ref, query) => {
          const result = await resolve(ref, query);
          if (query.mode === 'verify') {
            // Re-resolution must learn from its own observation after a transient mismatch.
            snapshot.accessibilityTree = neighborTree();
            live.get(elementRefKey(RELAX_REF))!.currentFingerprint = observation().fingerprint;
          }
          return result;
        });
      }
      vi.spyOn(session, 'evaluateAssert').mockImplementation(async () => {
        if (!finalStarted) return { passed: true };
        if (options.ending === 'interrupted') {
          controller.abort();
          controller.signal.throwIfAborted();
        }
        return { passed: false, message: 'Done was absent.' };
      });
      sessions.push(session);
      return session;
    }),
  });
  const controller = new AbortController();
  if (options.ending === 'interrupted') Object.assign(scenario.deps, { signal: controller.signal });
  const path = await writePrompt(scenario.deps.storage, 'login.test.md', PROMPT);
  const plan = await createFreshPlan(scenario.deps.storage, path, options.steps ?? [step]);
  const groundingPath = scenario.deps.layout.groundingPathFor(path);
  const before = JSON.stringify({ schemaVersion: 5, planDigest: computePlanDigest(plan), entries: { click: stored, untouched: retained } }, null, 4);
  await scenario.deps.storage.writeText(groundingPath, before);
  scenario.recordingStorage.writes.length = 0;
  const emit = scenario.deps.events.emit.bind(scenario.deps.events);
  const deps = { ...scenario.deps, events: { emit(event: Parameters<typeof emit>[0]) {
    emit(event);
    if (event.type === 'step-start' && event.stepId === 'ending') finalStarted = true;
  } }, ...(options.disabledWrite ? { config: { ...scenario.deps.config, grounding: { repositoryPolicy: 'committed' as const, localWriteBack: 'explicit' as const } } } : {}) };
  return { ...scenario, deps, sessions, executor, stored, retained, before, groundingPath,
    change(change: Record<string, string | boolean>) { tree = neighborTree(change); finalStarted = false; },
    read: async () => JSON.parse(await deps.storage.readText(groundingPath)),
    writes: () => scenario.recordingStorage.writes.filter(write => write.path === groundingPath),
    async execute(resolve = true) {
      const outcome = await run(deps, { ...DEFAULT_OPTIONS, resolve, updateCache: resolve && !options.disabledWrite });
      const report = buildRunReport({ startedAt: '2026-11-26T00:00:00Z', durationMs: 0, options: DEFAULT_OPTIONS, outcome });
      assertDiagnosable(report.envelope);
      if (!resolve) assertZeroAiCalls(report.envelope);
      return { outcome, report, status: outcome.results[0]?.result.status };
    },
  };
}

describe('TEST-RELAX-5 learned exclusions', () => {
  it.each([true, false])('learns from a completed replacement and replays further drift (quoted=%s)', async quoted => {
    const f = await fixture({ quoted });
    expect((await f.execute()).status).toBe('passed');
    const saved = await f.read();
    expect(saved.entries.click).toEqual({ ...entry(click(quoted), ['siblingBefore'], neighborTree({ siblingBefore: 'Beta' })), provenance: quoted ? 'quoted-match' : 'ai-proposed' });
    expect(canonical(saved.entries.untouched)).toBe(canonical(f.retained));
    expect(f.executor.structuredRequests).toHaveLength(quoted ? 0 : 1);
    const bytes = await f.deps.storage.readText(f.groundingPath);
    f.recordingStorage.writes.length = 0;
    f.change({ siblingBefore: 'Gamma' });
    expect((await f.execute(false)).status).toBe('passed');
    expect(await f.deps.storage.readText(f.groundingPath)).toBe(bytes);
    expect(f.writes()).toEqual([]);
  });
});

describe('TEST-RELAX-6 replacement prerequisites', () => {
  it('learns when locator names become equal after normalization', async () => {
    const f = await fixture({ stored: { ...entry(), locator: { ...RELAX_REF, name: '  Submit\t ' } } });
    expect(f.stored.locator).not.toEqual(RELAX_REF);
    expect((await f.execute()).status).toBe('passed');
    expect((await f.read()).entries.click).toMatchObject({ locator: RELAX_REF, ignoredNames: ['siblingBefore'] });
  });
  it.each(['locator', 'structure', 'legacy', 'not-found', 'intent'] as const)('does not learn when %s differs', async fault => {
    const base = entry();
    const stored = fault === 'locator' ? { ...base, locator: { ...RELAX_REF, name: 'Elsewhere' } }
      : fault === 'legacy' ? (({ components: _components, ...rest }) => rest)(base)
      : fault === 'intent' ? { ...base, intentDigest: 'f'.repeat(64) } : base;
    const f = await fixture({ stored, change: fault === 'structure' ? { parentRole: 'form', siblingBefore: 'Beta' } : { siblingBefore: 'Beta' } });
    if (fault === 'not-found' || fault === 'locator') {
      const launch = f.deps.uiExecutor;
      f.deps.uiExecutor = (...args) => {
        const executor = launch(...args);
        return { ...executor, async launch(target) {
          const session = await executor.launch(target);
          const original = session.resolveGrounded.bind(session);
          let firstVerify = true;
          vi.spyOn(session, 'resolveGrounded').mockImplementation((ref, query) => {
            if (query.mode === 'verify' && firstVerify) {
              firstVerify = false;
              return Promise.resolve({ kind: 'miss', reason: fault === 'not-found' ? 'element-not-found' : 'fingerprint-mismatch' });
            }
            return original(ref, query);
          });
          return session;
        } };
      };
    }
    expect((await f.execute()).status).toBe('passed');
    const saved = await f.read();
    expect(saved.entries.click).toHaveProperty('components');
    expect(saved.entries.click).not.toHaveProperty('ignoredNames');
    expect(canonical(saved.entries.untouched)).toBe(canonical(f.retained));
    expect(f.writes()).toHaveLength(1);
  });
});

describe('TEST-RELAX-7 exclusion union', () => {
  it.each([
    { change: { parent: 'New container', siblingBefore: 'Beta' }, expected: ['parent', 'siblingBefore'] },
    { change: { parent: 'New container', siblingBefore: 'Beta', siblingAfter: 'Delta' }, expected: ['parent', 'siblingBefore', 'siblingAfter'] },
  ])('retains overlapping stored exclusions in canonical order: $expected', async ({ change, expected }) => {
    const f = await fixture({ ignored: ['siblingBefore'], change });
    expect((await f.execute()).status).toBe('passed');
    expect((await f.read()).entries.click.ignoredNames).toEqual(expected);
  });
  it('adds parent before an already excluded previous sibling without duplicates', async () => {
    const f = await fixture({ ignored: ['siblingBefore'], change: { parent: 'New container' } });
    expect((await f.execute()).status).toBe('passed');
    expect((await f.read()).entries.click.ignoredNames).toEqual(['parent', 'siblingBefore']);
  });
  it.each([undefined, ['siblingBefore'] as FingerprintNameSlot[]])('retains exclusions when replacement observes no changed names (%s)', async ignored => {
    const f = await fixture({ ...(ignored ? { ignored } : {}), transientVerify: true, change: { parent: 'Transient container' } });
    expect((await f.execute()).status).toBe('passed');
    const saved = (await f.read()).entries.click;
    if (ignored) expect(saved.ignoredNames).toEqual(ignored);
    else expect(saved).not.toHaveProperty('ignoredNames');
    expect(saved.components).toEqual(observation().components);
  });
});

describe('TEST-RELAX-8 structural replacement', () => {
  it('drops all prior exclusions after structural drift', async () => {
    const f = await fixture({ ignored: ['parent', 'siblingBefore', 'siblingAfter'], change: { parentRole: 'form', siblingBefore: 'Beta' } });
    expect((await f.execute()).status).toBe('passed');
    expect((await f.read()).entries.click).not.toHaveProperty('ignoredNames');
    expect((await f.read()).entries.click.components).toEqual(observation(neighborTree({ parentRole: 'form', siblingBefore: 'Beta' })).components);
  });
});

describe('TEST-RELAX-9 confirmation and persistence', () => {
  it.each(['secret', 'serialization', 'write'] as const)('preserves exact bytes after confirmed learning and %s rejection', async fault => {
    const secretStep: TestStep = { id: 'secret', kind: 'action', action: 'fill-secret', intent: { description: 'Click Submit', roleHint: 'button', sourceSpan: SPAN }, secretRef: '{{secrets.password}}' };
    const f = await fixture({ secret: fault === 'secret', steps: [click(), check('confirm', ['click']), ...(fault === 'secret' ? [secretStep] : [])] });
    let attempts = 0;
    if (fault === 'serialization') {
      const serialize = canonicalJson.toCanonicalArtifactText;
      vi.spyOn(canonicalJson, 'toCanonicalArtifactText').mockImplementation(value => {
        const document = value as unknown as { schemaVersion?: number; entries?: { click?: { ignoredNames?: string[] } } };
        // Only the learned payload is rejected, so earlier artifact checks remain real.
        if (document.schemaVersion === 5 && document.entries?.click?.ignoredNames?.includes('siblingBefore')) {
          attempts++;
          throw new RangeError('Cannot canonicalize a string with an unpaired surrogate.');
        }
        return serialize(value);
      });
    }
    if (fault === 'write') {
      const write = f.deps.storage.writeText.bind(f.deps.storage);
      vi.spyOn(f.deps.storage, 'writeText').mockImplementation(async (path, text) => {
        if (path === f.groundingPath) { attempts++; throw new FsIoError('The grounding destination is unwritable.'); }
        return write(path, text);
      });
    }
    const result = await f.execute();
    expect(await f.deps.storage.readText(f.groundingPath)).toBe(f.before);
    expect(f.writes()).toEqual([]);
    expect(result.status).toBe('error');
    expect(result.outcome.results[0]?.error).toBeInstanceOf(fault === 'secret' ? IntegrityViolationError : FsIoError);
    expect(result.outcome.results[0]?.result.steps[0]?.binding).toMatchObject({ confirmed: true });
    if (fault !== 'secret') expect(attempts).toBe(1);
    // The fixture seeds the secret into a retained entry on purpose, so the unchanged grounding file is not scanned; only the report is.
    else assertNoSecretDisclosure({ secrets: { relaxedPersistence: SECRET }, report: result.report.envelope });
  });
  it.each([
    { confirms: false, ending: 'failure', saved: false },
    { confirms: true, ending: 'failure', saved: true },
    { confirms: false, ending: 'interrupted', saved: false },
    { confirms: true, ending: 'interrupted', saved: true },
    { confirms: true, ending: 'failure', saved: false, disabledWrite: true },
    { confirms: true, ending: 'interrupted', saved: false, disabledWrite: true },
  ] as const)('preserves confirmation boundaries: $confirms / $ending / saved=$saved', async ({ confirms, ending, saved, ...policy }) => {
    const f = await fixture({ ending, ...policy, steps: [click(), ...(confirms ? [check('confirm', ['click'])] : []), check('ending')] });
    const result = await f.execute();
    expect(result.status).toBe(ending === 'failure' ? 'failed' : 'error');
    expect(result.outcome.results[0]?.result.steps[0]?.binding?.confirmed).toBe(confirms);
    if (ending === 'interrupted') expect(result.report.envelope.errors).toContainEqual(expect.objectContaining({ code: 'INTERRUPTED', scope: 'run' }));
    if (saved) {
      expect((await f.read()).entries.click.ignoredNames).toEqual(['siblingBefore']);
      expect(canonical((await f.read()).entries.untouched)).toBe(canonical(f.retained));
      expect(f.writes()).toHaveLength(1);
    } else {
      expect(await f.deps.storage.readText(f.groundingPath)).toBe(f.before);
      expect(f.writes()).toEqual([]);
    }
  });
});

describe('TEST-RELAX-10 replay persistence', () => {
  it('preserves stored hit evidence through confirmation and a different step write', async () => {
    const f = await fixture({ ignored: ['siblingBefore'], steps: [click(), check('confirm', ['click']), click(true, 'fresh')] });
    expect((await f.execute()).status).toBe('passed');
    const saved = await f.read();
    expect(canonical(saved.entries.click)).toBe(canonical(f.stored));
    expect(canonical(saved.entries.untouched)).toBe(canonical(f.retained));
    expect(saved.entries.fresh).toHaveProperty('components');
    expect(f.writes()).toHaveLength(1);
  });
  it.each([
    { ignored: undefined, change: { siblingBefore: 'Beta' }, status: 'error' },
    { ignored: ['siblingBefore'], change: { parent: 'New container' }, status: 'error' },
    { ignored: ['siblingBefore'], change: { siblingBefore: 'Beta' }, status: 'passed' },
  ] as const)('uses only stored exclusions without resolve: $status ($change)', async ({ ignored, change, status }) => {
    const f = await fixture({ ...(ignored ? { ignored: [...ignored] } : {}), change });
    const result = await f.execute(false);
    expect(result.status).toBe(status);
    if (status === 'error') expect(result.report.envelope.errors).toContainEqual(expect.objectContaining({ code: 'GROUNDING_UNRESOLVED' }));
    expect(await f.deps.storage.readText(f.groundingPath)).toBe(f.before);
    expect(f.writes()).toEqual([]);
    expect(f.resolveAiExecutor).not.toHaveBeenCalled();
  });
});
