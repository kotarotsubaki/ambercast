/** Stored grounding determines replay readiness without consulting the current screen or repairing artifacts. Every required step is assessed in plan order, and diagnostic reads preserve the distinction between absence and unreadability. */
import { describe, expect, it, vi } from 'vitest';
import { toCanonicalArtifactText } from '#core/ir/canonical-json.js';
import { computeIntentDigest, computePlanDigest } from '#core/ir/digest.js';
import { AiGroundingEntry, readGroundingDocument, GroundingDocument, PlanDocument, Step, type JsonValueT } from '#core/ir/schema.js';
import type { ReadStorageAdapter } from '#ports/storage.js';
import { assessReplayReadiness, readReplayReadiness, replayEntrySteps, type GroundingSource } from '#usecases/replay-readiness.js';
import { planCompletionPromotions, run } from '#usecases/run.js';
import { buildRunReport } from '#usecases/run-report.js';
import { createFakeAiExecutor } from '../../doubles/fake-ai-executor.js';
import { assertDiagnosable } from '../../support/report-assertions.js';
import { FINGERPRINT, SUBMIT, aiStep, createScenario, DEFAULT_OPTIONS, seedFreshArtifacts, writePrompt } from '../../support/run-scenario.js';

const intent = { description: 'Submit control', roleHint: 'button', sourceSpan: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 7 } };
const click = Step.parse({ id: 'click', kind: 'action', target: 'web', action: 'click', intent });
const fill = Step.parse({ id: 'fill', kind: 'action', target: 'web', action: 'fill', intent, value: 'example' });
const capture = Step.parse({ id: 'capture', kind: 'capture', target: 'web', intent, variable: 'captured' });
const ai = Step.parse({ ...aiStep('ai'), target: 'web' });
const navigate = Step.parse({ id: 'navigate', kind: 'action', target: 'web', action: 'navigate', url: '/' });
const assertion = Step.parse({ id: 'assert', kind: 'assert', target: 'web', check: 'text-visible', text: 'Dashboard' });
function plan(steps: readonly Step[] = [click]) {
  return PlanDocument.parse({ schemaVersion: 5, source: { inputsDigest: 'a'.repeat(64) }, targets: steps.length === 0 ? {} : { web: { surface: 'web', baseUrl: 'https://example.test' } }, steps });
}
function element(step: Step = click) {
  if ((step.kind !== 'action' && step.kind !== 'capture') || !('intent' in step)) throw new Error('An element fixture needs an intent.');
  return { kind: 'element' as const, locator: SUBMIT, fingerprint: FINGERPRINT, provenance: 'quoted-match' as const,
    intentDigest: computeIntentDigest({ stepKind: step.kind, operation: step.kind === 'capture' ? 'capture' : step.action, intent: step.intent }) };
}
const coveredAi = AiGroundingEntry.parse({ kind: 'ai', trace: { events: [], verification: [{ type: 'assert', check: 'text-visible', text: 'Dashboard' }], verificationCoverage: { 'dashboard-reached': 0 } } });
const legacyAi = AiGroundingEntry.parse({ kind: 'ai', trace: { events: [], verification: [{ type: 'assert', check: 'text-visible', text: 'Dashboard' }] } });
function text(p: PlanDocument, entries: GroundingDocument['entries'] = {}, overrides: Record<string, unknown> = {}): GroundingSource {
  // Coverage claims require canonical artifact bytes as well as schema-valid entries.
  return { kind: 'text', text: toCanonicalArtifactText({ schemaVersion: 4, planDigest: computePlanDigest(p), entries, ...overrides } as JsonValueT) };
}
const unresolved = (...steps: { id: string; reason: string }[]) => ({ status: 'not-ready', reason: 'steps-unresolved', steps });
const artifactFailure = (reason: string) => ({ status: 'not-ready', reason });

describe('TEST-READY-1 artifact assessment', () => {
  const p = plan();
  const cases = [
    { name: 'missing grounding', p, source: { kind: 'absent' } as GroundingSource, expected: artifactFailure('grounding-missing') },
    { name: 'unreadable grounding', p, source: { kind: 'unreadable' } as GroundingSource, expected: artifactFailure('grounding-unreadable') },
    { name: 'invalid JSON', p, source: { kind: 'text', text: '{' } as GroundingSource, expected: artifactFailure('grounding-invalid') },
    { name: 'schema violation', p, source: text(p, {}, { entries: { click: { kind: 'element' } } }), expected: artifactFailure('grounding-invalid') },
    ...[2, 3].map(schemaVersion => ({ name: `retired version ${schemaVersion}`, p, source: text(p, {}, { schemaVersion }), expected: artifactFailure('grounding-stale') })),
    { name: 'different plan digest', p, source: text(p, {}, { planDigest: 'b'.repeat(64) }), expected: artifactFailure('grounding-stale') },
    { name: 'all entries present', p, source: text(p, { click: element() }), expected: { status: 'ready' } },
    { name: 'one missing element', p, source: text(p), expected: unresolved({ id: 'click', reason: 'no-entry' }) },
    { name: 'AI entry for an element', p, source: text(p, { click: coveredAi }), expected: unresolved({ id: 'click', reason: 'entry-mismatch' }) },
    ...[click, fill, capture].map(step => { const p = plan([step]); return { name: `${step.id} intent mismatch`, p, source: text(p, { [step.id]: { ...element(step), intentDigest: 'b'.repeat(64) } }), expected: unresolved({ id: step.id, reason: 'entry-mismatch' }) }; }),
    ...[
      { name: 'element entry for AI', entry: element(), expected: unresolved({ id: 'ai', reason: 'entry-mismatch' }) },
      { name: 'legacy AI trace', entry: legacyAi, expected: unresolved({ id: 'ai', reason: 'trace-uncovered' }) },
      { name: 'covered AI trace', entry: coveredAi, expected: { status: 'ready' } },
    ].map(row => { const p = plan([ai]); return { ...row, p, source: text(p, { ai: row.entry }) }; }),
  ];
  it.each(cases)('$name', ({ p, source, expected }) => {
    if (source.kind === 'text' && 'reason' in expected && expected.reason === 'steps-unresolved') readGroundingDocument(JSON.parse(source.text));
    const before = JSON.stringify({ p, source });
    expect(assessReplayReadiness(p, source)).toEqual(expected);
    expect(JSON.stringify({ p, source })).toBe(before);
  });

  it.each([{ steps: [] }, { steps: [navigate, assertion] }])('ignores every artifact state when no steps require entries ($steps)', ({ steps }) => {
    const p = plan(steps);
    for (const source of [{ kind: 'absent' }, { kind: 'unreadable' }, { kind: 'text', text: '{' }, text(p, {}, { schemaVersion: 2 }), text(p, {}, { planDigest: 'b'.repeat(64) })] as GroundingSource[]) {
      expect(assessReplayReadiness(p, source)).toEqual({ status: 'ready' });
    }
  });

  it('retains every unresolved step in plan order, independently of entry insertion order', () => {
    const steps = [navigate, ai, assertion, capture, fill, click, ...Array.from({ length: 40 }, (_, n) => Step.parse({ ...click, id: `extra-${n}` }))];
    const p = plan(steps);
    const source = text(p, { click: coveredAi, fill: { ...element(fill), intentDigest: 'b'.repeat(64) }, ai: legacyAi });
    expect(replayEntrySteps(p).map(step => step.id)).toEqual(steps.filter(step => step !== navigate && step !== assertion).map(step => step.id));
    expect(assessReplayReadiness(p, source)).toEqual(unresolved(
      { id: 'ai', reason: 'trace-uncovered' }, { id: 'capture', reason: 'no-entry' }, { id: 'fill', reason: 'entry-mismatch' }, { id: 'click', reason: 'entry-mismatch' },
      ...Array.from({ length: 40 }, (_, n) => ({ id: `extra-${n}`, reason: 'no-entry' })),
    ));
  });

  it('requires no entries for navigate or element assertions alongside a covered action', () => {
    const p = plan([navigate, click, Step.parse({ id: 'visible', kind: 'assert', target: 'web', check: 'element-visible', intent: { ...intent, quote: { text: 'Submit', sourceSpan: intent.sourceSpan } } })]);
    expect(assessReplayReadiness(p, text(p, { click: element() }))).toEqual({ status: 'ready' });
  });

  const promotedSteps = [click, Step.parse({ ...click, id: 'press', action: 'press', key: 'Enter' }), fill,
    Step.parse({ id: 'secret', kind: 'action', target: 'web', action: 'fill-secret', intent, secretRef: '{{secrets.password}}' }), capture];
  it.each(promotedSteps)('accepts the actual completion promotion entry for $id', step => {
    type Context = Parameters<typeof planCompletionPromotions>[0];
    const state = { stage: 'acted', locator: SUBMIT, fingerprint: FINGERPRINT, provenance: 'quoted-match', quoteWaitMs: 0 } as const;
    const context = { bindingStates: new Map([[step.id, state]]), actionSteps: new Map([[step.id, step]]) } as Context;
    const promotions = planCompletionPromotions(context);
    expect(promotions).toHaveLength(1);
    const p = plan([step]);
    expect(assessReplayReadiness(p, text(p, { [step.id]: promotions[0]!.entry }))).toEqual({ status: 'ready' });
  });

  it('accepts the covered AI entry actually saved by run', async () => {
    const executor = createFakeAiExecutor({ executeAgentic: async request => {
      await request.controller.evaluateAssert({ type: 'assert', check: 'text-visible', text: 'Dashboard' }, 'dashboard-reached');
      return { outcome: 'success' };
    } });
    const scenario = createScenario({ resolveAiExecutor: vi.fn(async () => executor) });
    const path = await writePrompt(scenario.deps.storage);
    const p = await seedFreshArtifacts(scenario.deps.storage, path, [aiStep()]);
    const outcome = await run(scenario.deps, DEFAULT_OPTIONS);
    expect(outcome.results[0]!.result.status).toBe('passed');
    const report = buildRunReport({ startedAt: '2026-11-20T00:00:00Z', durationMs: 0, options: DEFAULT_OPTIONS, outcome });
    assertDiagnosable(report.envelope);
    const saved = await scenario.deps.storage.readText(scenario.deps.layout.groundingPathFor(path));
    expect(GroundingDocument.parse(JSON.parse(saved)).entries['recorded-ai']).toMatchObject({ kind: 'ai' });
    expect(assessReplayReadiness(p, { kind: 'text', text: saved })).toEqual({ status: 'ready' });
  });
});

describe('TEST-READY-1 diagnostic storage ordering', () => {
  const fail = vi.fn(async (): Promise<never> => { throw new Error('Storage must not be touched.'); });
  const throwing: ReadStorageAdapter = { exists: fail, readText: fail, readTextSnapshotIfExists: fail, realPath: fail, listDirectories: fail };
  it.each([{ steps: [] }, { steps: [navigate, assertion] }])('does not call any storage method for a plan without required entries ($steps)', async ({ steps }) => {
    fail.mockClear();
    for (const path of [undefined, '/grounding.json']) await expect(readReplayReadiness(throwing, path, plan(steps))).resolves.toEqual({ status: 'ready' });
    expect(fail).not.toHaveBeenCalled();
  });
  it('does not touch storage when the companion path is unknown', async () => {
    fail.mockClear();
    await expect(readReplayReadiness(throwing, undefined, plan())).resolves.toEqual(artifactFailure('grounding-missing'));
    expect(fail).not.toHaveBeenCalled();
  });
  it.each(['absent', 'exists throws', 'read throws', 'valid', 'invalid', 'stale', 'unresolved'] as const)('never throws when the artifact is %s', async mode => {
    const p = plan();
    const calls: string[] = [];
    const source = text(p, mode === 'unresolved' ? {} : { click: element() }, mode === 'stale' ? { planDigest: 'b'.repeat(64) } : {});
    if (source.kind !== 'text') throw new Error('Expected a text fixture.');
    const storage: ReadStorageAdapter = { ...throwing,
      exists: vi.fn(async path => { calls.push(`exists:${path}`); if (mode === 'exists throws') throw new Error('Inspection failed.'); return mode !== 'absent'; }),
      readText: vi.fn(async path => { calls.push(`read:${path}`); if (mode === 'read throws') throw new Error('Reading failed.'); return mode === 'invalid' ? '{' : source.text; }),
    };
    const expected = mode === 'valid' ? { status: 'ready' } : mode === 'unresolved' ? unresolved({ id: 'click', reason: 'no-entry' })
      : artifactFailure(mode === 'absent' || mode === 'exists throws' ? 'grounding-missing' : mode === 'read throws' ? 'grounding-unreadable' : mode === 'invalid' ? 'grounding-invalid' : 'grounding-stale');
    await expect(readReplayReadiness(storage, '/grounding.json', p)).resolves.toEqual(expected);
    expect(calls).toEqual(mode === 'absent' || mode === 'exists throws' ? ['exists:/grounding.json'] : ['exists:/grounding.json', 'read:/grounding.json']);
  });
});
