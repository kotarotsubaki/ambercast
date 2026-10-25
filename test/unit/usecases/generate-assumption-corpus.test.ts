import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { generate } from '#usecases/generate.js';
import { buildGenerateReport } from '#usecases/generate-report.js';
import { loadCorpus } from '../../support/corpus.js';
import { createScenario, DEFAULT_OPTIONS, RUNS_DIR, writePrompt } from '../../support/generate-scenario.js';
import { assertDiagnosable, assertNoSecretDisclosure, collectStorageArtifacts } from '../../support/report-assertions.js';

const schemas = { value: z.string().min(1), expected: z.enum(['kept', 'replaced']) };
const before = 'A safe preceding assumption.';
const after = 'A safe following assumption.';
const omitted = 'An assumption was omitted because it looked like a secret.';

describe.each([
  { dryRun: false, multiTarget: false },
  { dryRun: true, multiTarget: false },
  { dryRun: false, multiTarget: true },
  { dryRun: true, multiTarget: true },
])('SG-1 corpus (TEST-4f): dryRun=$dryRun multiTarget=$multiTarget', ({ dryRun, multiTarget }) => {
  it.each(loadCorpus(new URL('../../fixtures/corpus/generator-assumptions/secret-boundaries.jsonl', import.meta.url), schemas))('line $line: $note', async (entry) => {
    const scenario = createScenario({}, multiTarget ? { targets: {
      admin: { surface: 'web', baseUrl: 'https://admin.example.test', description: 'Administration console' },
      shop: { surface: 'web', baseUrl: 'https://shop.example.test', description: 'Customer storefront' },
    }, defaultTarget: undefined } : {});
    const file = await writePrompt(scenario.deps.storage);
    const plan = scenario.deps.layout.planPathFor(file);
    const grounding = scenario.deps.layout.groundingPathFor(file);
    const data = { steps: [], ambiguities: [], assumptions: [before, entry.value, after, entry.value] };
    scenario.execute.mockResolvedValue({ data, raw: JSON.stringify(data) });
    scenario.recordingStorage.reset();
    const options = { ...DEFAULT_OPTIONS, dryRun };
    const outcome = await generate(scenario.deps, options);
    expect(scenario.execute).toHaveBeenCalledTimes(1);
    const context = scenario.execute.mock.calls[0]?.[0].context as { targets: Record<string, unknown>; defaultTarget?: string };
    expect(Object.keys(context.targets)).toEqual(multiTarget ? ['admin', 'shop'] : ['web']);
    if (multiTarget) expect(context).not.toHaveProperty('defaultTarget');
    expect(outcome.results[0]).toMatchObject({ status: dryRun ? 'would-generate' : 'generated', aiCalls: 1, ambiguities: [] });
    const built = buildGenerateReport({ outcome, options, startedAt: '2026-10-14T00:00:00Z', durationMs: 0 });
    expect(built.exitCode).toBe(0);
    assertDiagnosable(built.envelope);
    const message = entry.expected === 'replaced' ? omitted : entry.value;
    expect(built.envelope.results[0]).toMatchObject({ warnings: [
      { kind: 'generator-assumption', message: before },
      { kind: 'generator-assumption', message },
      { kind: 'generator-assumption', message: after },
      { kind: 'generator-assumption', message },
    ] });
    const roots = [RUNS_DIR];
    if (dryRun) {
      expect(await scenario.deps.storage.exists(plan)).toBe(false);
      expect(await scenario.deps.storage.exists(grounding)).toBe(false);
      expect(scenario.recordingStorage.writes.filter(({ path }) => path === plan || path === grounding)).toEqual([]);
    } else {
      expect(await scenario.deps.storage.exists(plan)).toBe(true);
      expect(await scenario.deps.storage.exists(grounding)).toBe(true);
      roots.push(plan, grounding);
      const savedPlan = JSON.parse(await scenario.deps.storage.readText(plan));
      expect(savedPlan).not.toHaveProperty('assumptions');
      expect(savedPlan).not.toHaveProperty('warnings');
      for (const path of [plan, grounding]) {
        const text = await scenario.deps.storage.readText(path);
        for (const assumption of [before, entry.value, after, omitted]) expect(text).not.toContain(assumption);
      }
    }
    // Persist the consumer's report so the disclosure scan includes every output root.
    await scenario.deps.storage.writeText(`${RUNS_DIR}/corpus/report.json`, JSON.stringify(built.envelope));
    const artifacts = await collectStorageArtifacts(scenario.deps.storage, roots);
    if (entry.expected === 'replaced') assertNoSecretDisclosure({ secrets: { assumption: entry.value }, report: built.envelope, artifacts });
    else assertNoSecretDisclosure({ secrets: { unrelated: 'UNRESOLVED_PRIVATE_CREDENTIAL_VALUE' }, report: built.envelope, artifacts });
  });
});
