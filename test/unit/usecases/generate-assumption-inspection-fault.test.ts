import { describe, expect, it, vi } from 'vitest';
import { generate } from '#usecases/generate.js';
import { buildGenerateReport } from '#usecases/generate-report.js';
import { assertNoLiteralSecrets } from '#usecases/generator-secret-policy.js';
import { createScenario, DEFAULT_OPTIONS, RUNS_DIR, seedFreshArtifacts, writePrompt } from '../../support/generate-scenario.js';
import { assertDiagnosable, assertNoSecretDisclosure, collectStorageArtifacts } from '../../support/report-assertions.js';

const seam = vi.hoisted(() => ({ assumption: 'Inspection fault sentinel for one assumption.', ambiguity: 'Inspection fault sentinel for the ambiguity array.' }));

vi.mock('#usecases/generator-secret-policy.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('#usecases/generator-secret-policy.js')>();
  return { ...original, assertNoLiteralSecrets: vi.fn((value: unknown) => {
    if (value === seam.assumption) throw new Error('Synthetic assumption inspection failure.');
    if (Array.isArray(value) && value.length === 1 && value[0] === seam.ambiguity) throw new Error('Synthetic ambiguity inspection failure.');
    return original.assertNoLiteralSecrets(value);
  }) };
});

describe('assumption inspection fault isolation (TEST-4f, SG-1)', () => {
  it.each([
    { dryRun: false, force: false, maxAttempts: 1 },
    { dryRun: false, force: false, maxAttempts: 2 },
    { dryRun: true, force: false, maxAttempts: 2 },
    { dryRun: false, force: true, maxAttempts: 2 },
    { dryRun: true, force: true, maxAttempts: 2 },
  ])('fails closed without artifact changes: $dryRun dry-run, $force force, $maxAttempts attempts', async (policy) => {
    vi.mocked(assertNoLiteralSecrets).mockClear();
    const scenario = createScenario();
    const file = await writePrompt(scenario.deps.storage);
    const plan = scenario.deps.layout.planPathFor(file);
    const grounding = scenario.deps.layout.groundingPathFor(file);
    if (policy.force) await seedFreshArtifacts(scenario.deps.storage, file);
    const before = policy.force ? await collectStorageArtifacts(scenario.deps.storage, [plan, grounding]) : [];
    scenario.recordingStorage.reset();
    const data = { steps: [], ambiguities: [], assumptions: ['A safe preceding assumption.', seam.assumption, 'A safe following assumption.'] };
    scenario.execute.mockResolvedValue({ data, raw: JSON.stringify(data) });
    const options = { ...DEFAULT_OPTIONS, ...policy };
    const outcome = await generate(scenario.deps, options);
    expect(scenario.execute).toHaveBeenCalledTimes(1);
    expect(assertNoLiteralSecrets).toHaveBeenCalledWith(seam.assumption);
    expect(outcome.results[0]).toMatchObject({ status: 'failed', aiCalls: 1 });
    const built = buildGenerateReport({ outcome, options, startedAt: '2026-10-14T00:00:00Z', durationMs: 0 });
    // SG-1's exact fallback is inspected directly; its diagnosability is a separate contract question.
    expect(built.envelope.errors).toEqual([expect.objectContaining({ code: 'FS_IO_ERROR', message: 'The generated assumptions could not be inspected.' })]);
    expect(built.exitCode).toBe(3);
    expect(built.envelope.results[0]).not.toHaveProperty('warnings');
    expect(scenario.recordingStorage.writes.filter(({ path }) => path === plan || path === grounding)).toEqual([]);
    if (policy.force) expect(await collectStorageArtifacts(scenario.deps.storage, [plan, grounding])).toEqual(before);
    else {
      expect(await scenario.deps.storage.exists(plan)).toBe(false);
      expect(await scenario.deps.storage.exists(grounding)).toBe(false);
    }
    await scenario.deps.storage.writeText(`${RUNS_DIR}/fault/report.json`, JSON.stringify(built.envelope));
    const artifacts = await collectStorageArtifacts(scenario.deps.storage, policy.force ? [RUNS_DIR, plan, grounding] : [RUNS_DIR]);
    assertNoSecretDisclosure({ secrets: { fault: seam.assumption }, report: built.envelope, artifacts });
  });

  it('delegates other assumptions to the real detector and preserves their order', async () => {
    const scenario = createScenario();
    const file = await writePrompt(scenario.deps.storage);
    const data = { steps: [], ambiguities: [], assumptions: ['Before.', 'Typed {{secrets.password}} into the field.', 'After.'] };
    scenario.execute.mockResolvedValue({ data, raw: JSON.stringify(data) });
    const outcome = await generate(scenario.deps, DEFAULT_OPTIONS);
    expect(scenario.execute).toHaveBeenCalledTimes(1);
    expect(outcome.results[0]).toMatchObject({ status: 'generated', warnings: [
      { kind: 'generator-assumption', message: 'Before.' },
      { kind: 'generator-assumption', message: 'An assumption was omitted because it looked like a secret.' },
      { kind: 'generator-assumption', message: 'After.' },
    ] });
    const built = buildGenerateReport({ outcome, options: DEFAULT_OPTIONS, startedAt: '2026-10-14T00:00:00Z', durationMs: 0 });
    assertDiagnosable(built.envelope);
    await scenario.deps.storage.writeText(`${RUNS_DIR}/fault/report.json`, JSON.stringify(built.envelope));
    const artifacts = await collectStorageArtifacts(scenario.deps.storage, [RUNS_DIR, scenario.deps.layout.planPathFor(file), scenario.deps.layout.groundingPathFor(file)]);
    assertNoSecretDisclosure({ secrets: { assumption: data.assumptions[1]! }, report: built.envelope, artifacts });
  });

  it('does not inject the scalar assumption fault into ambiguity-array inspection', async () => {
    vi.mocked(assertNoLiteralSecrets).mockClear();
    const scenario = createScenario({}, { targets: {
      admin: { surface: 'web', baseUrl: 'https://admin.example.test' },
      shop: { surface: 'web', baseUrl: 'https://shop.example.test' },
    }, defaultTarget: undefined });
    await writePrompt(scenario.deps.storage);
    const data = { steps: [], ambiguities: [seam.assumption] };
    scenario.execute.mockResolvedValue({ data, raw: JSON.stringify(data) });
    const outcome = await generate(scenario.deps, DEFAULT_OPTIONS);
    expect(scenario.execute).toHaveBeenCalledTimes(1);
    expect(assertNoLiteralSecrets).toHaveBeenCalledWith([seam.assumption]);
    expect(outcome.results[0]).toMatchObject({ status: 'failed', error: { kind: 'prompt-ambiguous' } });
    const built = buildGenerateReport({ outcome, options: DEFAULT_OPTIONS, startedAt: '2026-10-14T00:00:00Z', durationMs: 0 });
    expect(built.envelope.errors).toEqual([expect.objectContaining({ code: 'PROMPT_AMBIGUOUS', details: { ambiguities: 1 } })]);
    assertDiagnosable(built.envelope);
  });

  it('retains the distinct non-secret ambiguity inspection fallback', async () => {
    vi.mocked(assertNoLiteralSecrets).mockClear();
    const scenario = createScenario();
    const file = await writePrompt(scenario.deps.storage);
    const data = { steps: [], ambiguities: [seam.ambiguity] };
    scenario.execute.mockResolvedValue({ data, raw: JSON.stringify(data) });
    const outcome = await generate(scenario.deps, DEFAULT_OPTIONS);
    expect(scenario.execute).toHaveBeenCalledTimes(1);
    expect(assertNoLiteralSecrets).toHaveBeenCalledWith([seam.ambiguity]);
    expect(outcome.results[0]?.status).toBe('failed');
    const built = buildGenerateReport({ outcome, options: DEFAULT_OPTIONS, startedAt: '2026-10-14T00:00:00Z', durationMs: 0 });
    expect(built.envelope.errors).toEqual([expect.objectContaining({ code: 'FS_IO_ERROR', message: 'The generated ambiguities could not be inspected.' })]);
    assertDiagnosable(built.envelope);
    expect(await scenario.deps.storage.exists(scenario.deps.layout.planPathFor(file))).toBe(false);
    expect(await scenario.deps.storage.exists(scenario.deps.layout.groundingPathFor(file))).toBe(false);
  });
});
