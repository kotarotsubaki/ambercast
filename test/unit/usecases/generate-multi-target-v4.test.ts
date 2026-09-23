import { describe, expect, it, vi } from 'vitest';
import { createCallIdAllocator } from '#core/ai/call-id-allocator.js';
import { deriveCurrentPlanInputProvenance } from '#core/ai/plan-input-provenance.js';
import { normalizeTestMd } from '#core/ir/normalize.js';
import { createLayoutResolver } from '#core/layout/resolve.js';
import type { AiExecuteRequest } from '#ports/ai.js';
import { generate, type GenerateDeps, type GenerateOptions } from '#usecases/generate.js';
import { createFakeAiExecutor } from '../../doubles/fake-ai-executor.js';
import { createInMemoryStorage } from '../../doubles/create-in-memory-storage.js';
import { createRecordingEventSink } from '../../doubles/create-recording-event-sink.js';

const prompt = '# Visit B\n\nOpen the dashboard.\n';
const file = '/workspace/tests/dashboard.test.md';
const targetA = { baseUrl: 'https://a.example.test', browser: 'chromium' as const, surface: 'web' as const, description: 'Admin app', healReplayIsolation: 'stateful' as const, resolveTimeoutMs: 5000 };
const targetB = { baseUrl: 'https://b.example.test', browser: 'chromium' as const, surface: 'web' as const, healReplayIsolation: 'stateful' as const, resolveTimeoutMs: 5000 };
const stepB = { id: 'visit-b', kind: 'action', action: 'navigate', target: 'B', url: 'https://b.example.test/dashboard' };
const options: GenerateOptions = { files: [file], strict: false, force: false, maxAttempts: 1, dryRun: false, allowEmpty: false, list: false };

async function scenario(response: unknown) {
  const storage = createInMemoryStorage();
  const layout = createLayoutResolver({ testDir: '/workspace/tests', runsDir: '/workspace/tests/.runs' });
  await storage.writeText(file, prompt);
  const execute = vi.fn(async (_request: AiExecuteRequest<unknown>) => ({ data: response, raw: JSON.stringify(response) }));
  const deps: GenerateDeps = {
    storage,
    layout,
    resolveAiExecutor: async () => createFakeAiExecutor({ execute }),
    events: createRecordingEventSink().sink,
    clock: { now: () => new Date(0), monotonicMs: () => 0, sleep: async () => {} },
    allocateCallId: createCallIdAllocator(),
    discoverTestFiles: async () => [file],
    config: {
      testDir: '/workspace/tests', testMatch: ['**/*.test.md'], testIgnore: [],
      targets: { A: targetA, B: targetB }, defaultTarget: 'A',
      ai: { provider: 'codex', timeoutMs: 1000, maxGenerateAttempts: 1 },
    },
  };
  return { storage, layout, execute, deps };
}

describe('TEST-10: v4 generation Target selection and Plan projection', () => {
  it('sends both Target descriptions and the separate default, then writes only the referenced Target and its digest', async () => {
    const { storage, layout, execute, deps } = await scenario({ steps: [stepB], ambiguities: [] });
    const outcome = await generate(deps, options);
    expect(outcome.results).toMatchObject([{ status: 'generated' }]);
    const request = execute.mock.calls[0]?.[0];
    const context = request?.context as Record<string, unknown>;
    expect(context.targets).toEqual({
      A: { surface: 'web', baseUrl: targetA.baseUrl, description: targetA.description },
      B: { surface: 'web', baseUrl: targetB.baseUrl },
    });
    expect(context.defaultTarget).toBe('A');
    expect(JSON.stringify(context.targets)).not.toContain('browser');
    const plan = JSON.parse(await storage.readText(layout.planPathFor(file))) as { targets: unknown; source: { inputsDigest: string } };
    const referenced = { B: { surface: 'web' as const, baseUrl: targetB.baseUrl } };
    expect(plan.targets).toEqual(referenced);
    expect(plan.source.inputsDigest).toBe(deriveCurrentPlanInputProvenance({
      normalizedTestMd: normalizeTestMd(prompt), targetDefinitions: referenced,
    }).inputsDigest);
  });

  it('restricts --target B, instructs assignment on every step, and accepts an explicitly targeted response without ambiguity', async () => {
    const { storage, layout, execute, deps } = await scenario({ steps: [stepB], ambiguities: [] });
    const outcome = await generate(deps, { ...options, target: 'B' });
    expect(outcome.results).toMatchObject([{ status: 'generated', ambiguities: [] }]);
    const request = execute.mock.calls[0]?.[0];
    const context = request?.context as Record<string, unknown>;
    expect(context.targets).toEqual({ B: { surface: 'web', baseUrl: targetB.baseUrl } });
    expect(context).not.toHaveProperty('defaultTarget');
    expect(request?.prompt).toMatch(/every step[\s\S]*target[\s\S]*B|target[\s\S]*B[\s\S]*every step/i);
    expect(JSON.parse(await storage.readText(layout.planPathFor(file)))).toMatchObject({ targets: { B: { surface: 'web' } }, steps: [stepB] });
  });

  it.each([
    ['missing target with one allowed Target', { id: 'visit-b', kind: 'action', action: 'navigate', url: stepB.url }],
    ['target outside the allowed set', { ...stepB, target: 'A' }],
  ])('rejects %s as ai-response-invalid without writing a Plan', async (_name, step) => {
    const { storage, layout, deps } = await scenario({ steps: [step], ambiguities: [] });
    const outcome = await generate(deps, { ...options, target: 'B' });
    expect(outcome.results).toMatchObject([{ status: 'failed', error: { kind: 'ai-response-invalid', exitCode: 3 } }]);
    expect(await storage.exists(layout.planPathFor(file))).toBe(false);
  });
});

describe('TEST-11: unresolved generation Target ambiguities', () => {
  it.each([false, true])('fails without writing a Plan when strict is %s', async (strict) => {
    const { storage, layout, deps } = await scenario({ steps: [stepB], ambiguities: ['Target for visit-b is unclear'] });
    const outcome = await generate(deps, { ...options, strict });
    expect(outcome.results).toMatchObject([{ status: 'failed', error: { message: 'The generated plan has unresolved target ambiguities.', exitCode: 1 } }]);
    expect(await storage.exists(layout.planPathFor(file))).toBe(false);
  });

  it('preserves existing Plan bytes when ambiguities prevent replacement', async () => {
    const { storage, layout, deps } = await scenario({ steps: [stepB], ambiguities: ['Target for visit-b is unclear'] });
    const planPath = layout.planPathFor(file);
    const previousBytes = 'existing plan bytes\n';
    await storage.writeText(planPath, previousBytes);
    const outcome = await generate(deps, { ...options, force: true });
    expect(outcome.results).toMatchObject([{ status: 'failed', error: { message: 'The generated plan has unresolved target ambiguities.', exitCode: 1 } }]);
    expect(await storage.readText(planPath)).toBe(previousBytes);
  });

  it('reports schema invalidity before ambiguities', async () => {
    const { storage, layout, deps } = await scenario({ steps: [{ ...stepB, target: undefined }], ambiguities: ['Target for visit-b is unclear'] });
    const outcome = await generate(deps, { ...options, target: 'B' });
    expect(outcome.results).toMatchObject([{ status: 'failed', error: { kind: 'ai-response-invalid', exitCode: 3 } }]);
    expect(await storage.exists(layout.planPathFor(file))).toBe(false);
  });
});
