import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { generate } from '#usecases/generate.js';
import type { GeneratedPlanResponse } from '#core/ir/schema.js';
import { CONFIRMS_LIVE_CASES, countConfirmsLiveMatches, matchesConfirmsLiveCase } from '../../support/confirms-live-check.js';
import { loadCorpus } from '../../support/corpus.js';
import { createScenario } from '../../support/generate-scenario.js';
import { createFakeAiExecutor } from '../../doubles/fake-ai-executor.js';

vi.mock('#usecases/generate.js', { spy: true });
vi.mock('../../support/generate-scenario.js', { spy: true });

const { generate: realGenerate } = await vi.importActual<typeof import('#usecases/generate.js')>('#usecases/generate.js');

function positiveResponse(): GeneratedPlanResponse {
  const line = CONFIRMS_LIVE_CASES.P;
  const intent = (description: string) => ({
    description, roleHint: 'textbox', startAnchor: 'L3', startColumn: 1,
    endAnchor: 'L3', endColumn: line.length + 1, citation: line,
  });
  return { steps: [
    { id: 'open', kind: 'action', action: 'navigate', target: 'web', url: '/sign-in' },
    { id: 'fill-username', kind: 'action', action: 'fill', target: 'web', intent: intent('Username field'), value: 'verifier' },
    { id: 'fill-password', kind: 'action', action: 'fill-secret', target: 'web', intent: intent('Password field'), secret: { nameHint: 'password' } },
    { id: 'verify-user', kind: 'assert', check: 'text-visible', target: 'web', text: 'Signed in as verifier', confirms: ['fill-username', 'fill-password'] },
  ], ambiguities: [] };
}

function positiveExecutor() {
  return createFakeAiExecutor({ execute: async () => {
    const data = positiveResponse();
    return { data, raw: JSON.stringify(data) };
  } });
}

const schemas = {
  value: z.object({
    name: z.enum(['P', 'N1', 'N2', 'N3']),
    steps: z.array(z.object({
      id: z.string(),
      kind: z.string(),
      action: z.string().optional(),
      value: z.string().optional(),
      confirms: z.array(z.string()).optional(),
    })),
  }),
  expected: z.boolean(),
};

describe('Issue #598 TEST-11 deterministic live-check scoring', () => {
  // Cardinality failures must not pass negative cases through an empty evidence set.
  it.each(loadCorpus(new URL('../../fixtures/corpus/confirms/live-check.jsonl', import.meta.url), schemas))('line $line: $note', (entry) => {
    expect(matchesConfirmsLiveCase(entry.value.name, entry.value.steps)).toBe(entry.expected);
  });
});

describe('Issue #598 TEST-11 independent generation attempts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(generate).mockImplementation(realGenerate);
  });

  it('counts success, failed interpretation, success as two matches from three isolated requests', async () => {
    let calls = 0;
    const executor = createFakeAiExecutor({ execute: async () => {
      const data = positiveResponse();
      calls += 1;
      if (calls === 2) data.steps = data.steps.filter(step => step.id !== 'verify-user');
      return { data, raw: JSON.stringify(data) };
    } });

    expect(await countConfirmsLiveMatches(executor, 'P')).toBe(2);
    expect(executor.structuredRequests).toHaveLength(3);
    expect(generate).toHaveBeenCalledTimes(3);
    expect(createScenario).toHaveBeenCalledTimes(3);
    const scenarios = vi.mocked(createScenario).mock.results.map(result => result.value as ReturnType<typeof createScenario>);
    expect(new Set(scenarios.map(scenario => scenario.deps.storage)).size).toBe(3);
    for (const scenario of scenarios) {
      const planPath = scenario.deps.layout.planPathFor('/workspace/tests/login.test.md');
      expect(scenario.recordingStorage.exists.filter(path => path === planPath)).toHaveLength(1);
      expect(scenario.recordingStorage.writes.filter(write => write.path === planPath)).toHaveLength(1);
    }
    // Distinct adapters alone would not expose a shared backing store.
    await scenarios[0]!.deps.storage.writeText('/workspace/tests/isolation-marker', 'first attempt');
    expect(await scenarios[1]!.deps.storage.exists('/workspace/tests/isolation-marker')).toBe(false);
    expect(await scenarios[2]!.deps.storage.exists('/workspace/tests/isolation-marker')).toBe(false);
    for (const call of vi.mocked(generate).mock.calls) {
      expect(call[0].config.ai.timeoutMs).toBe(300_000);
      expect(call[1]).toMatchObject({ maxAttempts: 1 });
    }
  });

  it.each(['failed', 'skipped-fresh', 'would-generate', 'listed', 'skipped'] as const)('does not score a matching plan with status %s', async (status) => {
    const planReads: ReturnType<typeof vi.spyOn>[] = [];
    vi.mocked(generate).mockImplementation(async (deps, options) => {
      const outcome = await realGenerate(deps, options);
      planReads.push(vi.spyOn(deps.storage, 'readText'));
      return { ...outcome, results: outcome.results.map(result => ({ ...result, status })) };
    });
    const executor = positiveExecutor();
    expect(await countConfirmsLiveMatches(executor, 'P')).toBe(0);
    expect(executor.structuredRequests).toHaveLength(3);
    expect(generate).toHaveBeenCalledTimes(3);
    expect(planReads).toHaveLength(3);
    for (const read of planReads) expect(read).not.toHaveBeenCalled();
  });

  it.each([0, undefined])('does not score a matching generated plan with aiCalls=%s', async (aiCalls) => {
    const planReads: ReturnType<typeof vi.spyOn>[] = [];
    vi.mocked(generate).mockImplementation(async (deps, options) => {
      const outcome = await realGenerate(deps, options);
      planReads.push(vi.spyOn(deps.storage, 'readText'));
      return { ...outcome, results: outcome.results.map(({ aiCalls: _calls, ...result }) => ({ ...result, ...(aiCalls === undefined ? {} : { aiCalls }) })) };
    });
    const executor = positiveExecutor();
    expect(await countConfirmsLiveMatches(executor, 'P')).toBe(0);
    expect(executor.structuredRequests).toHaveLength(3);
    expect(planReads).toHaveLength(3);
    for (const read of planReads) expect(read).not.toHaveBeenCalled();
  });

  it('does not score an outcome without a result', async () => {
    vi.mocked(generate).mockImplementation(async (deps, options) => ({ ...await realGenerate(deps, options), results: [] }));
    const executor = positiveExecutor();
    expect(await countConfirmsLiveMatches(executor, 'P')).toBe(0);
    expect(executor.structuredRequests).toHaveLength(3);
  });

  it.each(['missing plan', 'invalid JSON', 'invalid plan'] as const)('consumes %s without scoring it or abandoning later attempts', async (fault) => {
    let calls = 0;
    vi.mocked(generate).mockImplementation(async (deps, options) => {
      const outcome = await realGenerate(deps, options);
      calls += 1;
      if (calls === 2) {
        const readText = deps.storage.readText.bind(deps.storage);
        vi.spyOn(deps.storage, 'readText').mockImplementation(async path => {
          if (path === deps.layout.planPathFor(options.files[0]!)) {
            if (fault === 'missing plan') throw new Error('Plan is absent');
            return fault === 'invalid JSON' ? '{' : '{}';
          }
          return readText(path);
        });
      }
      return outcome;
    });
    const executor = positiveExecutor();
    expect(await countConfirmsLiveMatches(executor, 'P')).toBe(2);
    expect(executor.structuredRequests).toHaveLength(3);
    expect(generate).toHaveBeenCalledTimes(3);
  });

  it('consumes a thrown generation error and continues the remaining attempts', async () => {
    let calls = 0;
    vi.mocked(generate).mockImplementation(async (deps, options) => {
      const outcome = await realGenerate(deps, options);
      calls += 1;
      if (calls === 2) throw new Error('Generation failed after starting');
      return outcome;
    });
    const executor = positiveExecutor();
    expect(await countConfirmsLiveMatches(executor, 'P')).toBe(2);
    expect(executor.structuredRequests).toHaveLength(3);
    expect(generate).toHaveBeenCalledTimes(3);
  });

  it('consumes a provider error without retrying it or abandoning later attempts', async () => {
    let calls = 0;
    const executor = createFakeAiExecutor({ execute: async () => {
      calls += 1;
      if (calls === 2) throw new Error('Provider connection failed');
      const data = positiveResponse();
      return { data, raw: JSON.stringify(data) };
    } });
    expect(await countConfirmsLiveMatches(executor, 'P')).toBe(2);
    expect(executor.structuredRequests).toHaveLength(3);
    expect(generate).toHaveBeenCalledTimes(3);
  });
});
