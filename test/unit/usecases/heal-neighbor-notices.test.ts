import { describe, expect, it } from 'vitest';
import { GroundingEntry, Step } from '#core/ir/schema.js';
import { heal } from '#usecases/heal.js';
import { buildHealReport } from '#usecases/heal-report.js';
import { createFakeUiExecutor } from '../../doubles/fake-ui-executor.js';
import { createFakeBrowserSession, elementRefKey } from '../../doubles/fake-browser-session.js';
import * as healing from '../../support/heal-scenario.js';
import { neighborTree, observation, RELAX_REF } from '../../support/relaxed-fingerprint.js';
import { assertDiagnosable, assertNoSecretDisclosure } from '../../support/report-assertions.js';

const SCREEN_TEXT = 'Private customer balance 78529';
const SECRET = 'notice-heal-secret-93284';

async function fixture(mode: 'stored' | 'learned' | 'strict') {
  const previous = neighborTree({ siblingBefore: SCREEN_TEXT, parent: SECRET });
  const current = mode === 'strict' ? previous : neighborTree({ siblingBefore: 'Updated balance', parent: SECRET });
  const prior = observation(previous);
  const live = observation(current);
  return healing.createScenario({
    steps: [Step.parse({ id: 'click-submit', kind: 'action', target: 'web', action: 'click', intent: healing.committedIntent(RELAX_REF) })],
    grounding: {
      'click-submit': GroundingEntry.parse({
        ...healing.groundingEntry(RELAX_REF, prior.fingerprint),
        components: prior.components,
        ...(mode === 'stored' ? { ignoredNames: ['siblingBefore'] } : {}),
      }),
    },
    uiExecutor: () => createFakeUiExecutor(() => createFakeBrowserSession(
      new Map([[elementRefKey(RELAX_REF), { exists: true, currentFingerprint: live.fingerprint }]]),
      { baseUrl: healing.TARGETS.web.baseUrl, currentUrl: healing.TARGETS.web.baseUrl,
        snapshot: { accessibilityTree: current, screenshot: new Uint8Array([1]) } },
    )),
  });
}

function report(result: Awaited<ReturnType<typeof heal>>) {
  return buildHealReport({
    startedAt: '2026-11-26T00:00:00Z', durationMs: 0,
    options: { allowEmpty: false, list: false },
    outcome: {
      ...result.outcome,
      results: result.outcome.results.map(row => ({
        ...row,
        application: row.repairOutcome === 'healed' || row.repairOutcome === 'partially-healed'
          ? 'preview-only' as const
          : row.repairOutcome === 'no-changes-needed' ? 'no-artifact-change' as const : 'not-eligible' as const,
      })),
    },
  });
}

function reportedBinding(built: ReturnType<typeof report>) {
  const row = built.envelope.results[0];
  if (row?.status !== 'completed') throw new Error('Heal fixture must produce a completed result.');
  return row.steps[0]?.binding;
}

describe('heal neighbor binding notices', () => {
  it('retains saved ignored slots in every heal result and report', async () => {
    const f = await fixture('stored');
    for (let replay = 0; replay < 2; replay++) {
      const result = await heal(f.deps, healing.OPTIONS);
      const built = report(result);
      assertDiagnosable(built.envelope);
      expect(result.outcome.results[0]?.steps[0]?.binding).toHaveProperty('ignoredNames', ['siblingBefore']);
      expect(reportedBinding(built)).toHaveProperty('ignoredNames', ['siblingBefore']);
    }
  });

  it('includes slots decided during heal in both the outcome and report', async () => {
    const f = await fixture('learned');
    const result = await heal(f.deps, healing.OPTIONS);
    const built = report(result);
    assertDiagnosable(built.envelope);
    expect(result.outcome.results[0]?.repairOutcome).toBe('healed');
    expect(result.outcome.results[0]?.steps[0]?.binding).toHaveProperty('ignoredNames', ['siblingBefore']);
    expect(reportedBinding(built)).toHaveProperty('ignoredNames', ['siblingBefore']);
  });

  it('omits ignored slots from strict heal bindings', async () => {
    const f = await fixture('strict');
    const result = await heal(f.deps, healing.OPTIONS);
    const built = report(result);
    assertDiagnosable(built.envelope);
    expect(result.outcome.results[0]?.steps[0]?.binding).toBeDefined();
    expect(result.outcome.results[0]?.steps[0]?.binding).not.toHaveProperty('ignoredNames');
    expect(reportedBinding(built)).not.toHaveProperty('ignoredNames');
  });

  it('reports only slot identifiers without copying neighboring screen text or secrets', async () => {
    const f = await fixture('learned');
    const result = await heal(f.deps, healing.OPTIONS);
    const built = report(result);
    assertDiagnosable(built.envelope);
    assertNoSecretDisclosure({ secrets: { screenText: SCREEN_TEXT, credential: SECRET }, report: built.envelope });
    const binding = reportedBinding(built);
    expect(binding).toHaveProperty('ignoredNames', ['siblingBefore']);
    expect(JSON.stringify(binding)).not.toContain(SCREEN_TEXT);
    expect(JSON.stringify(binding)).not.toContain(SECRET);
  });
});
