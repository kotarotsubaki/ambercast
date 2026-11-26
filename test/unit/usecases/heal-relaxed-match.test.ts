import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeAccessibilityFingerprint } from '#core/ir/fingerprint.js';
import { toCanonicalArtifactText } from '#core/ir/canonical-json.js';
import { GroundingEntry, Step, type ElementRef, type JsonValueT } from '#core/ir/schema.js';
import { heal } from '#usecases/heal.js';
import * as runModule from '#usecases/run.js';
import * as generateModule from '#usecases/generate.js';
import { buildHealReport } from '#usecases/heal-report.js';
import { createFakeAiExecutor } from '../../doubles/fake-ai-executor.js';
import { createFakeUiExecutor } from '../../doubles/fake-ui-executor.js';
import { createFakeBrowserSession, elementRefKey } from '../../doubles/fake-browser-session.js';
import * as healing from '../../support/heal-scenario.js';
import * as generating from '../../support/generate-scenario.js';
import { neighborTree, observation, RELAX_REF } from '../../support/relaxed-fingerprint.js';
import { assertDiagnosable } from '../../support/report-assertions.js';

afterEach(() => vi.restoreAllMocks());
const canonical = (value: unknown) => toCanonicalArtifactText(value as JsonValueT);
const action = (id = 'click-submit', ref: ElementRef = RELAX_REF) => Step.parse({ id, kind: 'action', target: 'web', action: 'click', intent: healing.committedIntent(ref) });
const confirmer = Step.parse({ id: 'confirm', kind: 'assert', target: 'web', check: 'text-visible', text: 'Dashboard', confirms: ['click-submit'] });
const proposal = (ref: ElementRef = RELAX_REF) => ({ data: { proposal: { outcome: 'found', role: ref.role, name: ref.name } }, raw: '{}' });
const none = () => ({ data: { proposal: { outcome: 'none' } }, raw: '{}' });
const generated = (id = 'click-submit') => ({ id, kind: 'action', target: 'web', action: 'click', intent: {
  description: 'Repaired submit', roleHint: 'button', startAnchor: 'L3', startColumn: 8, endAnchor: 'L3', endColumn: 14, citation: 'submit',
} });

function evidence(tree: JsonValueT, ref: ElementRef) {
  const result = computeAccessibilityFingerprint(tree, ref, []);
  if (result.kind !== 'ok') throw new Error('Heal fixture must have unique evidence.');
  return { fingerprint: result.fingerprint, components: result.components };
}
function report(result: Awaited<ReturnType<typeof heal>>) {
  const built = buildHealReport({ startedAt: '2026-11-26T00:00:00Z', durationMs: 0, options: { allowEmpty: false, list: false }, outcome: {
    ...result.outcome, results: result.outcome.results.map(row => ({ ...row, application: row.repairOutcome === 'healed' || row.repairOutcome === 'partially-healed' ? 'preview-only' as const : row.repairOutcome === 'no-changes-needed' ? 'no-artifact-change' as const : 'not-eligible' as const })),
  } });
  assertDiagnosable(built.envelope);
}
async function fixture(options: { stage?: 'stage1' | 'confirms' | 'stage2' | 'stage3' | 'rejected'; retained?: boolean } = {}) {
  const other = { ...RELAX_REF, name: 'Other' };
  function tree(before: string): JsonValueT {
    const first = neighborTree({ siblingBefore: before });
    return options.retained ? { role: 'root', name: '', children: [first, { role: 'group', name: 'Other container', children: [
      { role: 'button', name: before, children: [] }, { role: 'button', name: 'Other', children: [] },
    ] }] } : first;
  }
  const previous = tree('Alpha');
  const current = tree('Beta');
  const grounding = {
    'click-submit': GroundingEntry.parse({ ...healing.groundingEntry(RELAX_REF, evidence(previous, RELAX_REF).fingerprint), components: evidence(previous, RELAX_REF).components,
      ...(options.stage === 'rejected' || options.stage === 'confirms' ? { ignoredNames: ['siblingAfter'] } : {}) }),
    ...(options.retained ? { other: { ...healing.groundingEntry(other, evidence(previous, other).fingerprint), components: evidence(previous, other).components } } : {}),
  };
  let bindings = 0;
  const executor = createFakeAiExecutor({ execute: async request => {
    if (request.prompt.includes('Return one ElementBindingProposal outcome.')) {
      const description = (request.context as { description?: string } | undefined)?.description;
      if (options.stage === 'stage1' && bindings++ === 0) return none();
      if ((options.stage === 'stage2' || options.stage === 'stage3' || options.stage === 'rejected') && description !== 'Repaired submit') return none();
      return proposal(description === 'Other' ? other : RELAX_REF);
    }
    const frontier = (request.context as { trustedInputs?: { frontier?: unknown } } | undefined)?.trustedInputs?.frontier;
    return { data: { steps: options.stage === 'rejected'
      ? [{ id: frontier === undefined ? 'broken' : 'click-submit', kind: 'action', target: 'web', action: 'navigate', url: 'http://[' }]
      : options.stage === 'stage3' && frontier !== undefined
        ? [{ id: 'wrong-id', kind: 'action', target: 'web', action: 'navigate', url: '/ignored' }]
        : [generated(options.stage === 'stage3' ? 'regenerated-submit' : 'click-submit')], ambiguities: [] }, raw: '{}' };
  } });
  const scenario = await healing.createScenario({
    grounding,
    steps: [action(), ...(options.stage === 'stage1' || options.stage === 'confirms' ? [confirmer] : []), ...(options.retained ? [action('other', other)] : [])],
    aiExecutor: executor,
    uiExecutor: () => createFakeUiExecutor(() => {
      const refs = options.retained ? [RELAX_REF, other] : [RELAX_REF];
      const entries = new Map(refs.map(ref => [elementRefKey(ref), { exists: true, currentFingerprint: evidence(current, ref).fingerprint }]));
      const session = createFakeBrowserSession(entries, { baseUrl: healing.TARGETS.web.baseUrl, currentUrl: healing.TARGETS.web.baseUrl,
        snapshot: { accessibilityTree: current, screenshot: new Uint8Array([1]) } });
      if (options.stage === 'confirms') {
        const evaluate = session.evaluateAssert.bind(session);
        vi.spyOn(session, 'evaluateAssert').mockImplementation(async (...args) => {
          // The stale action succeeds, but its consequence only appears after a fresh binding.
          if (!repairedReplay) return { passed: false, message: 'Dashboard was absent.' };
          return evaluate(...args);
        });
      }
      return session;
    }),
  });
  const path = scenario.deps.layout.groundingPathFor(healing.OPTIONS.files[0]!);
  const before = await scenario.storage.readText(path);
  const overlays: { before: string; after: string; resolve: boolean }[] = [];
  let repairedReplay = false;
  const confirmsStage = options.stage === 'confirms';
  const actualRun = runModule.run;
  vi.spyOn(runModule, 'run').mockImplementation(async (deps, options) => {
    const before = await deps.storage.readText(path);
    repairedReplay ||= confirmsStage && !Object.hasOwn(JSON.parse(before).entries, 'click-submit');
    const result = await actualRun(deps, options);
    overlays.push({ before, after: await deps.storage.readText(path), resolve: options.resolve });
    return result;
  });
  return { ...scenario, path, before, overlays };
}

describe('TEST-RELAX-11 heal and generation boundaries', () => {
  it('Stage 1 rebuilds entries referenced by a failed confirmer while retained steps can learn', async () => {
    const f = await fixture({ stage: 'confirms', retained: true });
    const result = await heal(f.deps, healing.OPTIONS);
    report(result);
    expect(result.outcome.results[0]?.repairTrace).toContainEqual({ stage: 'stage1', stepId: 'confirm', outcome: 'accepted' });
    const attempt = f.overlays.find(row => row.resolve && !Object.hasOwn(JSON.parse(row.before).entries, 'click-submit'));
    expect(attempt).toBeDefined();
    expect(JSON.parse(attempt!.before).entries.other).toEqual(JSON.parse(f.before).entries.other);
    const entries = JSON.parse(attempt!.after).entries;
    expect(entries['click-submit']).toHaveProperty('components');
    expect(entries['click-submit']).not.toHaveProperty('ignoredNames');
    expect(entries.other.ignoredNames).toEqual(['siblingBefore']);
  });
  it('learns exclusions during the first resolve-enabled heal replay', async () => {
    const f = await fixture();
    const result = await heal(f.deps, healing.OPTIONS);
    report(result);
    expect(result.outcome.results[0]?.repairOutcome).toBe('healed');
    const candidate = f.overlays.find(row => row.resolve);
    expect(candidate).toBeDefined();
    expect(JSON.parse(candidate!.after).entries['click-submit'].ignoredNames).toEqual(['siblingBefore']);
    expect(await f.storage.readText(f.path)).toBe(f.before);
    await expect(result.commits.get(healing.OPTIONS.files[0]!)?.commit()).resolves.toEqual({ outcome: 'committed' });
    expect(JSON.parse(await f.storage.readText(f.path)).entries['click-submit'].ignoredNames).toEqual(['siblingBefore']);
  });

  it.each([false, true])('Stage 1 discards only the repaired entry (retained other step=%s)', async retained => {
    const f = await fixture({ stage: 'stage1', retained });
    const result = await heal(f.deps, healing.OPTIONS);
    report(result);
    expect(result.outcome.results[0]?.repairTrace).toContainEqual({ stage: 'stage1', stepId: 'click-submit', outcome: 'accepted' });
    const attempt = f.overlays.find(row => row.resolve && !Object.hasOwn(JSON.parse(row.before).entries, 'click-submit'));
    expect(attempt).toBeDefined();
    const entries = JSON.parse(attempt!.after).entries;
    expect(entries['click-submit']).toHaveProperty('components');
    expect(entries['click-submit']).not.toHaveProperty('ignoredNames');
    if (retained) {
      expect(JSON.parse(attempt!.before).entries.other).toEqual(JSON.parse(f.before).entries.other);
      expect(entries.other.ignoredNames).toEqual(['siblingBefore']);
    }
  });

  it.each(['stage2', 'stage3'] as const)('%s produces strict replacement entries', async stage => {
    const f = await fixture({ stage });
    const result = await heal(f.deps, healing.OPTIONS);
    report(result);
    expect(result.outcome.results[0]?.repairTrace).toContainEqual(expect.objectContaining({ stage, outcome: 'accepted' }));
    await expect(result.commits.get(healing.OPTIONS.files[0]!)?.commit()).resolves.toEqual({ outcome: 'committed' });
    const id = stage === 'stage2' ? 'click-submit' : 'regenerated-submit';
    const saved = JSON.parse(await f.storage.readText(f.path)).entries[id];
    expect(saved).toHaveProperty('components');
    expect(saved).not.toHaveProperty('ignoredNames');
  });

  it('restores exact overlay bytes after a rejected attempt before whole-case regeneration', async () => {
    const f = await fixture({ stage: 'rejected' });
    const actual = generateModule.generate;
    const restored: string[] = [];
    vi.spyOn(generateModule, 'generate').mockImplementation(async (deps, options) => {
      restored.push(await deps.storage.readText(f.path));
      return actual(deps, options);
    });
    const result = await heal(f.deps, healing.OPTIONS);
    report(result);
    expect(result.outcome.results[0]?.repairTrace).toContainEqual(expect.objectContaining({ stage: 'stage2', outcome: 'rejected' }));
    const rejected = f.overlays.find(row => row.resolve && row.before !== f.before);
    expect(rejected).toBeDefined();
    expect(rejected!.before).not.toBe(f.before);
    expect(JSON.parse(rejected!.before).entries['click-submit']).toBeUndefined();
    expect(JSON.parse(f.before)).toMatchObject({ schemaVersion: 5, entries: { 'click-submit': { ignoredNames: ['siblingAfter'] } } });
    expect(restored).toEqual([f.before]);
    expect(await f.storage.readText(f.path)).toBe(f.before);
    expect(result.commits.size).toBe(0);
  });

  it('generate replaces old exclusions with empty grounding', async () => {
    const f = generating.createScenario();
    const path = await generating.writePrompt(f.deps.storage);
    await generating.createFreshPlan(f.deps.storage, path);
    const groundingPath = f.deps.layout.groundingPathFor(path);
    await f.deps.storage.writeText(groundingPath, canonical({ schemaVersion: 5, planDigest: 'a'.repeat(64), entries: {
      click: { ...healing.groundingEntry(RELAX_REF, observation().fingerprint), components: observation().components, ignoredNames: ['siblingBefore'] },
    } }));
    await generateModule.generate(f.deps, { ...generating.DEFAULT_OPTIONS, force: true });
    expect(JSON.parse(await f.deps.storage.readText(groundingPath)).entries).toEqual({});
    expect(f.execute).toHaveBeenCalled();
  });
});
