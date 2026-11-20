/** Healing retains every completed element binding in its candidate and persists it only after authorization, so subsequent replay needs no AI. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeAccessibilityFingerprint, matchQuotedCandidates } from '#core/ir/fingerprint.js';
import type { AccessibilityNode } from '#core/ir/aria-snapshot.js';
import { GroundingDocument, Step, type ElementRef, type JsonValueT } from '#core/ir/schema.js';
import type { StorageAdapter } from '#ports/storage.js';
import { heal } from '#usecases/heal.js';
import { run } from '#usecases/run.js';
import { buildRunReport } from '#usecases/run-report.js';
import { buildHealReport } from '#usecases/heal-report.js';
import { promptForHealConfirmation } from '../../../src/runtime/heal-command.js';
import { createFakeAiExecutor } from '../../doubles/fake-ai-executor.js';
import { createFakeBrowserSession, elementRefKey, type FakeBrowserSessionEntry } from '../../doubles/fake-browser-session.js';
import { createFakeUiExecutor } from '../../doubles/fake-ui-executor.js';
import { createScenario, committedIntent, groundingEntry, healAccessibilityTree, FINGERPRINT, SUBMIT, REPAIRED_SUBMIT, OPTIONS, TARGETS } from '../../support/heal-scenario.js';
import { DEFAULT_OPTIONS } from '../../support/run-scenario.js';
import { assertDiagnosable, assertZeroAiCalls, assertNoSecretDisclosure, collectStorageArtifacts } from '../../support/report-assertions.js';

const observed = vi.hoisted(() => ({ candidates: [] as string[] }));
vi.mock('#usecases/run.js', async importOriginal => {
  const actual = await importOriginal<typeof import('#usecases/run.js')>();
  return { ...actual, run: async (...args: Parameters<typeof actual.run>) => {
    const outcome = await actual.run(...args);
    if (outcome.results[0]?.result.status === 'passed') {
      observed.candidates.push(await args[0].storage.readText(args[0].layout.groundingPathFor(OPTIONS.files[0]!)));
    }
    return outcome;
  } };
});
afterEach(() => { observed.candidates.length = 0; });

const generatedClick = (id: string) => ({ id, kind: 'action', target: 'web', action: 'click', intent: {
  description: REPAIRED_SUBMIT.name, roleHint: 'button', startAnchor: 'L3', startColumn: 8,
  endAnchor: 'L3', endColumn: 14, citation: 'submit',
} });
function entriesFor(tree?: JsonValueT): Map<string, FakeBrowserSessionEntry> {
  const entries = new Map([[elementRefKey(REPAIRED_SUBMIT), { exists: true, currentFingerprint: FINGERPRINT }]]);
  const fingerprint = computeAccessibilityFingerprint(tree ?? healAccessibilityTree(entries), REPAIRED_SUBMIT, []);
  if (fingerprint.kind !== 'ok') throw new Error('The repaired action must be unique.');
  entries.get(elementRefKey(REPAIRED_SUBMIT))!.currentFingerprint = fingerprint.fingerprint;
  return entries;
}
function proposal(ref: ElementRef = REPAIRED_SUBMIT) {
  return { data: { proposal: { outcome: 'found', role: ref.role, name: ref.name } }, raw: '{}' };
}
async function readGrounding(storage: StorageAdapter, path: string) {
  return GroundingDocument.parse(JSON.parse(await storage.readText(path)));
}

describe('TEST-SAVE-11 completion saving through heal', () => {
  for (const stage of ['stage2', 'stage3'] as const) {
    it.each(['applied', 'preview-only', 'declined'] as const)(`${stage} retains a complete overlay with application %s`, async application => {
      const executor = createFakeAiExecutor({ execute: async request => {
        if (request.prompt.includes('Return one ElementBindingProposal outcome.')) {
          return (request.context as { description?: string } | undefined)?.description === REPAIRED_SUBMIT.name
            ? proposal() : { data: { proposal: { outcome: 'none' } }, raw: '{}' };
        }
        const frontier = (request.context as { trustedInputs?: { frontier?: unknown } } | undefined)?.trustedInputs?.frontier;
        return { data: { steps: stage === 'stage3' && frontier !== undefined
          ? [{ id: 'wrong-id', kind: 'action', target: 'web', action: 'navigate', url: '/ignored' }]
          : [generatedClick(stage === 'stage2' ? 'click-submit' : 'regenerated-submit')], ambiguities: [] }, raw: '{}' };
      } });
      const scenario = await createScenario({
        ...(stage === 'stage3' ? { steps: [Step.parse({ id: 'broken', kind: 'action', target: 'web', action: 'navigate', url: 'http://[' })], grounding: {} } : {}),
        sessionEntries: entriesFor(), aiExecutor: executor,
      });
      const path = scenario.deps.layout.groundingPathFor(OPTIONS.files[0]!);
      const planPath = scenario.deps.layout.planPathFor(OPTIONS.files[0]!);
      const before = [await scenario.storage.readText(planPath), await scenario.storage.readText(path)];
      const options = { ...OPTIONS, dryRun: application === 'preview-only', yes: application === 'applied' };
      const result = await heal(scenario.deps, options);
      expect(result.outcome.errors).toEqual([]);
      expect(result.outcome.results[0]?.repairOutcome).toBe('healed');
      expect(result.outcome.results[0]?.repairTrace).toContainEqual(expect.objectContaining({ stage, outcome: 'accepted' }));
      const id = stage === 'stage2' ? 'click-submit' : 'regenerated-submit';
      expect(observed.candidates.length).toBeGreaterThan(0);
      const overlay = GroundingDocument.parse(JSON.parse(observed.candidates.at(-1)!));
      expect(Object.keys(overlay.entries)).toEqual([id]);
      expect(overlay.entries[id]).toMatchObject({ kind: 'element', locator: REPAIRED_SUBMIT });
      expect([await scenario.storage.readText(planPath), await scenario.storage.readText(path)]).toEqual(before);
      const readConfirmationAnswer = vi.fn(async () => 'declined' as const);
      const confirmation = await promptForHealConfirmation(result.commits, options, {
        isCI: false, isInteractive: () => true, readConfirmationAnswer,
      });
      expect(confirmation).toBe(application === 'applied' ? 'authorized' : application === 'preview-only' ? 'not-required' : 'declined');
      expect(readConfirmationAnswer).toHaveBeenCalledTimes(application === 'declined' ? 1 : 0);
      if (confirmation === 'authorized') {
        await expect(result.commits.get(OPTIONS.files[0]!)?.commit()).resolves.toEqual({ outcome: 'committed' });
        expect(await readGrounding(scenario.storage, path)).toEqual(overlay);
        const resolveAiExecutor = vi.fn(async () => { throw new Error('Replay must not request AI.'); });
        const outcome = await run({ ...scenario.deps, resolveAiExecutor }, { ...DEFAULT_OPTIONS, files: OPTIONS.files, resolve: false });
        const report = buildRunReport({ startedAt: '2026-11-20T00:00:00Z', durationMs: 0, options: DEFAULT_OPTIONS, outcome });
        expect(report.envelope.results[0]).toMatchObject({ status: 'passed' });
        assertDiagnosable(report.envelope);
        assertZeroAiCalls(report.envelope);
        expect(resolveAiExecutor).not.toHaveBeenCalled();
        assertNoSecretDisclosure({ secrets: { sentinel: 'private-completion-save-credential' }, report: report.envelope,
          artifacts: await collectStorageArtifacts(scenario.storage, [planPath, path]) });
      } else {
        expect([await scenario.storage.readText(planPath), await scenario.storage.readText(path)]).toEqual(before);
        expect(scenario.textWrites.mock.calls.filter(([name]) => name === path || name === planPath)).toEqual([]);
      }
      const report = buildHealReport({ startedAt: '2026-11-20T00:00:00Z', durationMs: 0,
        options: { allowEmpty: false, list: false },
        outcome: { ...result.outcome, results: result.outcome.results.map(row => ({ ...row, application })) },
      });
      expect(report.envelope.results[0]).toMatchObject({ repairOutcome: 'healed', application });
      assertDiagnosable(report.envelope);
    });
  }

  it('keeps a stale unconfirmed entry ineligible for Stage 1 and proceeds to Stage 2', async () => {
    const scenario = await createScenario({
      grounding: { 'click-submit': groundingEntry(SUBMIT, FINGERPRINT) }, sessionEntries: entriesFor(),
      aiExecutor: createFakeAiExecutor({ execute: async request => request.prompt.includes('Return one ElementBindingProposal outcome.')
        ? (request.context as { description?: string } | undefined)?.description === REPAIRED_SUBMIT.name
          ? proposal() : { data: { proposal: { outcome: 'none' } }, raw: '{}' }
        : { data: { steps: [generatedClick('click-submit')], ambiguities: [] }, raw: '{}' } }),
    });
    const result = await heal(scenario.deps, OPTIONS);
    expect(result.outcome.results[0]?.repairTrace).toEqual(expect.arrayContaining([
      { stage: 'stage1', stepId: 'click-submit', outcome: 'not-eligible', reason: 'no-confirming-step' },
      { stage: 'stage2', stepId: 'click-submit', outcome: 'accepted' },
    ]));
  });

  it('adopts the Stage 1 repair when the only element-visible confirmer matches twice', async () => {
    // This pins the current outcome required by the specification; it is not a design decision.
    const base = healAccessibilityTree(entriesFor());
    const tree: JsonValueT = { role: 'root', name: '', children: [base,
      { role: 'group', name: 'First', children: [{ role: 'button', name: 'submit', children: [] }] },
      { role: 'group', name: 'Second', children: [{ role: 'button', name: 'submit', children: [] }] },
    ] };
    const entries = entriesFor(tree);
    expect(matchQuotedCandidates(tree as AccessibilityNode, { text: 'submit', roleHint: 'button' })).toHaveLength(2);
    let bindingRequests = 0;
    const quotedSpan = { startLine: 3, startColumn: 15, endLine: 3, endColumn: 21 } as const;
    const scenario = await createScenario({
      prompt: '# Sign in\n\nWhen I click "submit", I reach the dashboard.\n',
      grounding: {},
      steps: [Step.parse({ id: 'click-submit', kind: 'action', target: 'web', action: 'click', intent: { ...committedIntent(SUBMIT), sourceSpan: quotedSpan } }),
        Step.parse({ id: 'visible', kind: 'assert', target: 'web', check: 'element-visible',
          intent: { ...committedIntent(SUBMIT), sourceSpan: quotedSpan, quote: { text: 'submit', sourceSpan: quotedSpan } }, confirms: ['click-submit'] })],
      sessionEntries: entries,
      uiExecutor: () => createFakeUiExecutor(() => createFakeBrowserSession(entries, {
        baseUrl: TARGETS.web.baseUrl, snapshot: { accessibilityTree: tree, screenshot: new Uint8Array([1]) },
      })),
      aiExecutor: createFakeAiExecutor({ execute: async request => {
        if (!request.prompt.includes('Return one ElementBindingProposal outcome.')) {
          return { data: { steps: [], ambiguities: ['No later-stage repair is available.'] }, raw: '{}' };
        }
        return bindingRequests++ === 0 ? { data: { proposal: { outcome: 'none' } }, raw: '{}' } : proposal();
      } }),
    });
    const result = await heal(scenario.deps, OPTIONS);
    expect(result.outcome.errors).toEqual([]);
    expect(result.outcome.results[0]?.repairOutcome).toBe('healed');
    expect(result.outcome.results[0]?.repairTrace).toContainEqual({ stage: 'stage1', stepId: 'click-submit', outcome: 'accepted' });
    expect(result.outcome.results[0]?.repairTrace?.some(entry => entry.stage === 'stage2' || entry.stage === 'stage3')).toBe(false);
    await expect(result.commits.get(OPTIONS.files[0]!)?.commit()).resolves.toEqual({ outcome: 'committed' });
    expect((await readGrounding(scenario.storage, scenario.deps.layout.groundingPathFor(OPTIONS.files[0]!))).entries['click-submit']).toMatchObject({ kind: 'element', locator: REPAIRED_SUBMIT });
  });
});
