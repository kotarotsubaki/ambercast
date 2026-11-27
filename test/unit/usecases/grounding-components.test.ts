/** Legacy reads preserve replay assets; only newly confirmed evidence advances their storage format. */
import { describe, expect, it, vi } from 'vitest';
import { toCanonicalArtifactText, toCanonicalDigestBytes } from '#core/ir/canonical-json.js';
import { createHash } from 'node:crypto';
import { computeIntentDigest, computePlanDigest } from '#core/ir/digest.js';
import { computeAccessibilityFingerprint } from '#core/ir/fingerprint.js';
import { readGroundingDocument, Step, type ElementRef, type JsonValueT } from '#core/ir/schema.js';
import { elementRefKey } from '../../doubles/fake-browser-session.js';
import { createFakeAiExecutor } from '../../doubles/fake-ai-executor.js';
import { inspectGroundingArtifactText } from '#usecases/check-grounding.js';
import { assessReplayReadiness } from '#usecases/replay-readiness.js';
import { run } from '#usecases/run.js';
import * as runModule from '#usecases/run.js';
import { buildRunReport } from '#usecases/run-report.js';
import { heal } from '#usecases/heal.js';
import { generate } from '#usecases/generate.js';
import { createFakeUiExecutor } from '../../doubles/fake-ui-executor.js';
import { createScenario, createFakeBrowserSession, liveEntries, writePrompt, createFreshPlan, DEFAULT_OPTIONS, aiStep, type TestStep } from '../../support/run-scenario.js';
import * as healing from '../../support/heal-scenario.js';
import * as generating from '../../support/generate-scenario.js';
import { assertDiagnosable, assertZeroAiCalls } from '../../support/report-assertions.js';

const PROMPT = '# Submit\n\nClick "Submit" and "Other".\n';
const SUBMIT = { strategy: 'accessibility', role: 'button', name: 'Submit' } as const;
const OTHER = { ...SUBMIT, name: 'Other' };
const span = { startLine: 3, startColumn: 1, endLine: 3, endColumn: 28 };
const click = (id = 'click', name = 'Submit'): TestStep => ({ id, kind: 'action', action: 'click', intent: { description: 'Click control', roleHint: 'button', sourceSpan: span, quote: { text: name, sourceSpan: { ...span, startColumn: name === 'Submit' ? 8 : 21, endColumn: name === 'Submit' ? 14 : 26 } } } });
const tree: JsonValueT = { role: 'root', name: '', children: [SUBMIT, OTHER].map(ref => ({ role: ref.role, name: ref.name, children: [] })) };
function fingerprint(ref: ElementRef = SUBMIT) {
  const result = computeAccessibilityFingerprint(tree, ref, []);
  if (result.kind !== 'ok') throw new Error('Fixture must have unique hashable evidence.');
  return result.fingerprint;
}
const hash = (v: JsonValueT) => createHash('sha256').update(toCanonicalDigestBytes(v)).digest('hex');
const components = { algorithm: 'a11y-components-v1', structure: hash({ role: 'button', name: 'Submit', parentRole: 'root', siblingBeforeRole: null, siblingAfterRole: 'button' }), parentName: hash({ slot: 'parent', name: '' }), siblingBeforeName: null, siblingAfterName: hash({ slot: 'siblingAfter', name: 'Other' }) } as const;
function entry(step: TestStep = click(), ref: ElementRef = SUBMIT) {
  if (step.kind !== 'action' || !('intent' in step)) throw new Error('Fixture requires an element action.');
  return { kind: 'element' as const, locator: ref, fingerprint: fingerprint(ref), provenance: 'quoted-match' as const, intentDigest: computeIntentDigest({ stepKind: 'action', operation: step.action, intent: step.intent }) };
}
const canonical = (v: unknown) => toCanonicalArtifactText(v as JsonValueT);
async function fixture(options: { version?: number; entries?: Record<string, unknown>; steps?: TestStep[]; noncanonical?: boolean; failed?: boolean } = {}) {
  const session = createFakeBrowserSession(liveEntries([SUBMIT], fingerprint()), { assertOutcome: { passed: !options.failed, message: 'Dashboard absent.' }, snapshot: { accessibilityTree: tree, screenshot: new Uint8Array([1]) } });
  vi.spyOn(session, 'accessibilitySnapshot').mockResolvedValue({ tree, rawYaml: '', scalarValues: [] });
  const scenario = createScenario({ uiExecutor: () => createFakeUiExecutor(() => session) });
  const path = await writePrompt(scenario.deps.storage, 'login.test.md', PROMPT);
  const plan = await createFreshPlan(scenario.deps.storage, path, options.steps ?? [click()]);
  const groundingPath = scenario.deps.layout.groundingPathFor(path);
  const document = { schemaVersion: options.version ?? 4, planDigest: computePlanDigest(plan), entries: options.entries ?? { click: entry() } };
  const before = options.noncanonical ? JSON.stringify(document, null, 4) : canonical(document);
  await scenario.deps.storage.writeText(groundingPath, before);
  scenario.recordingStorage.writes.length = 0;
  return { ...scenario, path, groundingPath, plan, document, before, session };
}
async function replay(f: Awaited<ReturnType<typeof fixture>>, resolve = false, updateCache = false) {
  const outcome = await run(f.deps, { ...DEFAULT_OPTIONS, resolve, updateCache });
  const report = buildRunReport({ startedAt: '2026-11-26T00:00:00Z', durationMs: 0, options: DEFAULT_OPTIONS, outcome });
  assertDiagnosable(report.envelope);
  if (!resolve) assertZeroAiCalls(report.envelope);
  return outcome;
}

describe('TEST-COMP-6 declared-version readers', () => {
  it.each([4, 5])('accepts v%s in check, readiness, and zero-AI replay', async version => {
    const f = await fixture({ version });
    expect(inspectGroundingArtifactText(f.before, f.plan)).toEqual({ kind: 'valid' });
    expect(assessReplayReadiness(f.plan, { kind: 'text', text: f.before })).toEqual({ status: 'ready' });
    expect((await replay(f)).results[0]?.result.status).toBe('passed');
    expect(await f.deps.storage.readText(f.groundingPath)).toBe(f.before);
  });
  it('preserves the declared v4 shape in the shared reader', async () => {
    const f = await fixture();
    expect(readGroundingDocument(f.document)).toEqual(f.document);
  });
  it.each(['components', 'ignoredNames'])('rejects a v4 declaration containing %s', async field => {
    const f = await fixture({ entries: { click: { ...entry(), [field]: field === 'components' ? components : ['parent'] } } });
    expect(() => readGroundingDocument(f.document)).toThrow();
    expect(inspectGroundingArtifactText(f.before, f.plan)).toEqual({ kind: 'invalid' });
    expect(assessReplayReadiness(f.plan, { kind: 'text', text: f.before })).toEqual({ status: 'not-ready', reason: 'grounding-invalid' });
    const result = await replay(f);
    expect(result.results[0]?.result.status).toBe('error');
    expect(result.results[0]?.error).toMatchObject({ kind: 'grounding-unresolved', details: { reason: 'missing' } });
  });
  it.each([2, 3, 1, 6, 999])('retains existing retirement and unknown-version classification for v%s', async version => {
    const f = await fixture({ version });
    expect(inspectGroundingArtifactText(f.before, f.plan)).toEqual({ kind: version === 2 || version === 3 ? 'stale' : 'invalid' });
    expect(() => readGroundingDocument(f.document)).toThrow();
    const retired = version === 2 || version === 3;
    expect(assessReplayReadiness(f.plan, { kind: 'text', text: f.before })).toEqual({ status: 'not-ready', reason: retired ? 'grounding-stale' : 'grounding-invalid' });
    const result = await replay(f);
    expect(result.results[0]?.result.status).toBe('error');
    expect(result.results[0]?.error).toMatchObject({ kind: 'grounding-unresolved', details: { reason: retired ? 'recoverable-miss' : 'missing' } });
  });
  it.each(['components', 'ignoredNames'])('does not trust v4 %s in heal or generate', async field => {
    const extra = { [field]: field === 'components' ? components : ['parent'] };
    const h = await healing.createScenario();
    const healPath = h.deps.layout.groundingPathFor(healing.OPTIONS.files[0]!);
    const original = JSON.parse(await h.storage.readText(healPath));
    const invalid = canonical({ ...original, schemaVersion: 4, entries: Object.fromEntries(Object.entries(original.entries).map(([id, value]) => [id, { ...(value as object), ...extra }])) });
    await h.storage.writeText(healPath, invalid);
    const healed = await heal(h.deps, healing.OPTIONS);
    expect(healed.outcome.results).toEqual([]);
    expect(healed.outcome.errors[0]?.error).toMatchObject({ kind: 'fs-io-error' });
    expect(healed.commits.size).toBe(0);
    expect(await h.storage.readText(healPath)).toBe(invalid);

    const g = generating.createScenario();
    const path = await generating.writePrompt(g.deps.storage);
    const plan = await generating.createFreshPlan(g.deps.storage, path);
    const groundingPath = g.deps.layout.groundingPathFor(path);
    await g.deps.storage.writeText(groundingPath, canonical({ schemaVersion: 4, planDigest: computePlanDigest(plan), entries: { click: { ...entry(), ...extra } } }));
    g.recordingStorage.reset();
    await generate(g.deps, generating.DEFAULT_OPTIONS);
    expect(g.recordingStorage.writes.some(w => w.path === groundingPath)).toBe(true);
    expect(JSON.parse(await g.deps.storage.readText(groundingPath)).entries).toEqual({});
  });
  it.each([false, true])('checks coverage bytes before migration (noncanonical=%s)', async noncanonical => {
    const f = await fixture({ steps: [{ ...aiStep(), instructionCoverage: [{ id: 'dashboard-reached', kind: 'success', sourceSpan: span }] }], noncanonical, entries: { 'recorded-ai': { kind: 'ai', trace: { events: [], verification: [{ type: 'assert', check: 'text-visible', text: 'Dashboard' }], verificationCoverage: { 'dashboard-reached': 0 } } } } });
    expect(inspectGroundingArtifactText(f.before, f.plan)).toEqual({ kind: noncanonical ? 'invalid' : 'valid' });
    const result = await replay(f);
    expect(result.results[0]?.result.status, JSON.stringify(result.results[0])).toBe(noncanonical ? 'error' : 'passed');
  });
  it.each([4, 5])('allows v%s heal preflight and retained-entry reads without migrating a cache hit', async version => {
    const f = await healing.createScenario({ sessionEntries: new Map([[elementRefKey(SUBMIT), { exists: true, currentFingerprint: healing.FINGERPRINT }]]) });
    const path = f.deps.layout.groundingPathFor(healing.OPTIONS.files[0]!);
    const document = JSON.parse(await f.storage.readText(path));
    await f.storage.writeText(path, canonical({ ...document, schemaVersion: version }));
    const result = await heal(f.deps, healing.OPTIONS);
    expect(result.outcome.results[0]).toMatchObject({ repairOutcome: 'no-changes-needed' });
    expect(result.commits.size).toBe(0);
  });
  it.each([4, 5])('does not replace fresh v%s grounding during generate', async version => {
    const f = generating.createScenario();
    const path = await generating.writePrompt(f.deps.storage);
    const plan = await generating.createFreshPlan(f.deps.storage, path);
    const groundingPath = f.deps.layout.groundingPathFor(path);
    const before = canonical({ schemaVersion: version, planDigest: computePlanDigest(plan), entries: {} });
    await f.deps.storage.writeText(groundingPath, before);
    f.recordingStorage.reset();
    await generate(f.deps, generating.DEFAULT_OPTIONS);
    expect(await f.deps.storage.readText(groundingPath)).toBe(before);
    expect(f.recordingStorage.writes.filter(w => w.path === groundingPath)).toEqual([]);
    expect(f.execute).not.toHaveBeenCalled();
  });
  it('keeps v4 during heal Stage 1 deletion and writes v5 only for the repaired candidate', async () => {
    const entries = new Map([[elementRefKey(SUBMIT), { exists: true, currentFingerprint: healing.FINGERPRINT }]]);
    const observed = computeAccessibilityFingerprint(healing.healAccessibilityTree(entries), SUBMIT, []);
    if (observed.kind !== 'ok') throw new Error('Fixture needs a unique live target.');
    entries.get(elementRefKey(SUBMIT))!.currentFingerprint = observed.fingerprint;
    let proposals = 0;
    const executor = createFakeAiExecutor({ execute: async () => {
      const proposal = ++proposals === 1 ? { outcome: 'none' } : { outcome: 'found', role: 'button', name: 'Submit' };
      return { data: { proposal }, raw: JSON.stringify({ proposal }) };
    } });
    const f = await healing.createScenario({ sessionEntries: entries, aiExecutor: executor, steps: [
      Step.parse({ id: 'click-submit', kind: 'action', target: 'web', action: 'click', intent: healing.committedIntent(SUBMIT) }),
      Step.parse({ id: 'confirm', kind: 'assert', target: 'web', check: 'text-visible', text: 'Dashboard', confirms: ['click-submit'] }),
    ] });
    const path = f.deps.layout.groundingPathFor(healing.OPTIONS.files[0]!);
    const original = { ...JSON.parse(await f.storage.readText(path)), schemaVersion: 4 };
    await f.storage.writeText(path, canonical(original));
    const actualRun = runModule.run;
    const overlays: unknown[] = [];
    const spy = vi.spyOn(runModule, 'run').mockImplementation(async (deps, options) => {
      if (options.resolve) overlays.push(JSON.parse(await deps.storage.readText(path)));
      return actualRun(deps, options);
    });
    try {
      const result = await heal(f.deps, healing.OPTIONS);
      expect(overlays).toContainEqual({ ...original, entries: {} });
      expect(result.outcome.results[0]).toMatchObject({ repairOutcome: 'healed' });
      const commit = result.commits.get(healing.OPTIONS.files[0]!);
      expect(commit).toBeDefined();
      await expect(commit!.commit()).resolves.toEqual({ outcome: 'committed' });
      expect(JSON.parse(await f.storage.readText(path))).toMatchObject({ schemaVersion: 5, entries: { 'click-submit': { components: { algorithm: 'a11y-components-v1' } } } });
    } finally { spy.mockRestore(); }
  });
});

describe('TEST-COMP-7 confirmed write-back', () => {
  it('saves bind-time evidence after the neighboring name changes following the action', async () => {
    const f = await fixture({ entries: {}, steps: [click()] });
    const laterTree: JsonValueT = { role: 'root', name: '', children: [{ role: 'button', name: 'Submit', children: [] }, { role: 'button', name: 'Later', children: [] }] };
    const perform = f.session.perform.bind(f.session);
    const action = vi.spyOn(f.session, 'perform').mockImplementation(async request => {
      await perform(request);
      // An action may change its neighbors without changing the evidence that justified it.
      vi.mocked(f.session.accessibilitySnapshot).mockResolvedValue({ tree: laterTree, rawYaml: '', scalarValues: [] });
      vi.spyOn(f.session, 'snapshotForResolution').mockResolvedValue({ accessibilityTree: laterTree, screenshot: new Uint8Array([1]) });
    });
    expect((await replay(f, true, true)).results[0]?.result.status).toBe('passed');
    expect(action).toHaveBeenCalledTimes(1);
    expect((await f.session.accessibilitySnapshot()).tree).toEqual(laterTree);
    const saved = JSON.parse(await f.deps.storage.readText(f.groundingPath));
    expect(saved.entries.click.components).toEqual(components);
    expect(saved.entries.click.components.siblingAfterName).not.toBe(hash({ slot: 'siblingAfter', name: 'Later' }));
  });
  it('writes v5 with bind-time components while retaining untouched legacy entry values', async () => {
    const retained = entry(click('other', 'Other'), OTHER);
    const f = await fixture({ entries: { click: { ...entry(), fingerprint: { ...fingerprint(), hash: 'b'.repeat(64) } }, other: retained } });
    expect((await replay(f, true, true)).results[0]?.result.status).toBe('passed');
    const saved = JSON.parse(await f.deps.storage.readText(f.groundingPath));
    expect.soft(saved.schemaVersion).toBe(5);
    expect.soft(saved.entries.click).toMatchObject({ ...entry(), components });
    expect(canonical(saved.entries.other)).toBe(canonical(retained));
  });
  it.each(['unconfirmed', 'write-back-disabled'] as const)('retains original bytes when %s', async mode => {
    const f = await fixture({ entries: { click: { ...entry(), fingerprint: { ...fingerprint(), hash: 'b'.repeat(64) } } }, failed: mode === 'unconfirmed', steps: [click(), { id: 'assert', kind: 'assert', check: 'text-visible', text: 'Dashboard', timeoutMs: 0 }] });
    const deps = mode === 'write-back-disabled' ? { ...f.deps, config: { ...f.deps.config, grounding: { repositoryPolicy: 'committed' as const, localWriteBack: 'explicit' as const } } } : f.deps;
    const outcome = await run(deps, { ...DEFAULT_OPTIONS, resolve: true, updateCache: mode !== 'write-back-disabled' });
    expect(outcome.results[0]?.result.status).toBe(mode === 'unconfirmed' ? 'failed' : 'passed');
    expect(await f.deps.storage.readText(f.groundingPath)).toBe(f.before);
  });
  it('leaves noncanonical original bytes untouched when nothing is re-resolved', async () => {
    const f = await fixture({ noncanonical: true });
    expect((await replay(f, true, true)).results[0]?.result.status).toBe('passed');
    expect(await f.deps.storage.readText(f.groundingPath)).toBe(f.before);
    expect(f.recordingStorage.writes.filter(w => w.path === f.groundingPath)).toEqual([]);
  });
});

describe('TEST-COMP-8 stable cache-hit evidence', () => {
  it('preserves all three hit entry shapes when a different step forces a document write', async () => {
    const staleComponents = { ...components, parentName: 'd'.repeat(64), siblingAfterName: 'e'.repeat(64) };
    const hits = {
      legacy: entry(click('legacy')),
      components: { ...entry(click('components')), components: staleComponents },
      ignored: { ...entry(click('ignored')), components: staleComponents, ignoredNames: ['siblingAfter'] },
    };
    const f = await fixture({ version: 5, steps: [...Object.keys(hits).map(id => click(id)), click('different')], entries: hits });
    expect((await replay(f, true, true)).results[0]?.result.status).toBe('passed');
    expect(f.recordingStorage.writes.some(w => w.path === f.groundingPath)).toBe(true);
    const saved = JSON.parse(await f.deps.storage.readText(f.groundingPath));
    expect.soft(saved.entries.different).toMatchObject({ components });
    for (const [id, before] of Object.entries(hits)) {
      expect.soft(canonical(saved.entries[id]), id).toBe(canonical(before));
    }
  });
  it.each((['legacy', 'components', 'ignored'] as const).flatMap(shape => [false, true].map(resolve => ({ shape, resolve }))))('retains $shape entry bytes across two runs (resolve=$resolve)', async ({ shape, resolve }) => {
    // A hit must preserve recorded evidence even when its component hashes no
    // longer describe the live screen; schema validation promises shape only.
    const staleComponents = { ...components, structure: 'c'.repeat(64), parentName: 'd'.repeat(64), siblingAfterName: 'e'.repeat(64) };
    const stored = { ...entry(), ...(shape === 'legacy' ? {} : { components: staleComponents }), ...(shape === 'ignored' ? { ignoredNames: ['siblingAfter'] } : {}) };
    const f = await fixture({ version: 5, entries: { click: stored } });
    for (let n = 0; n < 2; n++) {
      expect((await replay(f, resolve, true)).results[0]?.result.status).toBe('passed');
      expect(await f.deps.storage.readText(f.groundingPath)).toBe(f.before);
    }
    expect(f.recordingStorage.writes.filter(w => w.path === f.groundingPath)).toEqual([]);
  });
});

// This temporary layer-1 contract is replaced by TEST-RELAX-2 in layer 2.
describe('TEST-COMP-10 strict matching despite stored ignored names', () => {
  it('accepts the entry shape but rejects neighbor-name drift with fingerprint-mismatch', async () => {
    const f = await fixture({ version: 5, entries: { click: { ...entry(), components, ignoredNames: ['siblingAfter'] } } });
    expect(readGroundingDocument(f.document)).toEqual(f.document);
    const changedTree: JsonValueT = { role: 'root', name: '', children: [{ role: 'button', name: 'Submit', children: [] }, { role: 'button', name: 'Changed', children: [] }] };
    const observed = computeAccessibilityFingerprint(changedTree, SUBMIT, []);
    if (observed.kind !== 'ok') throw new Error('Changed fixture must remain uniquely hashable.');
    const changed = createFakeBrowserSession(liveEntries([SUBMIT], observed.fingerprint), { snapshot: { accessibilityTree: changedTree, screenshot: new Uint8Array([1]) } });
    const verify = vi.spyOn(changed, 'resolveGrounded');
    const outcome = await run({ ...f.deps, uiExecutor: () => createFakeUiExecutor(() => changed) }, { ...DEFAULT_OPTIONS, resolve: false });
    expect(outcome.results[0]?.error).toMatchObject({ details: { reason: 'recoverable-miss' } });
    expect(outcome.results[0]?.result.status).toBe('error');
    expect(verify).toHaveBeenCalled();
    await expect(verify.mock.results[0]!.value).resolves.toMatchObject({ kind: 'miss', reason: 'fingerprint-mismatch' });
    expect(f.resolveAiExecutor).not.toHaveBeenCalled();
  });
});
