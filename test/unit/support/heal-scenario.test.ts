import { describe, expect, it } from 'vitest';
import { heal } from '#usecases/heal.js';
import { Step } from '#core/ir/schema.js';
import { createFakeAiExecutor } from '../../doubles/fake-ai-executor.js';
import { createScenario, OPTIONS, RESOLVED_TARGETS, TARGETS } from '../../support/heal-scenario.js';

const targets = {
  web: TARGETS.web,
  shop: { surface: 'web' as const, baseUrl: 'https://shop.example.test' },
};

describe('heal scenario target configuration (TEST-7, TEST-9)', () => {
  it('preserves the default single-target configuration', async () => {
    const scenario = await createScenario();
    expect(scenario.plan.targets).toEqual(TARGETS);
    expect(scenario.deps.config.targets).toEqual(RESOLVED_TARGETS);
    expect(scenario.deps.config.defaultTarget).toBe('web');
  });

  it.each(['web', undefined] as const)('keeps digest, resolved targets and Stage 3 context aligned with default %s', async (defaultTarget) => {
    const frozen = Object.freeze({ web: Object.freeze({ ...targets.web }), shop: Object.freeze({ ...targets.shop }) });
    const executor = createFakeAiExecutor({ execute: async () => ({ data: { steps: [], ambiguities: [] }, raw: '{}' }) });
    const scenario = await createScenario({ targets: frozen, defaultTarget, grounding: {}, aiExecutor: executor, steps: [
      Step.parse({ id: 'broken', target: 'web', kind: 'action', action: 'navigate', url: 'http://[' }),
      Step.parse({ id: 'shop', target: 'shop', kind: 'action', action: 'navigate', url: '/' }),
    ] });
    expect(scenario.plan.targets).toEqual(targets);
    expect(scenario.deps.config.targets).toEqual({
      web: { ...RESOLVED_TARGETS.web, ...targets.web },
      shop: { ...RESOLVED_TARGETS.web, ...targets.shop },
    });
    const result = await heal(scenario.deps, OPTIONS);
    expect(result.outcome.errors).toEqual([]);
    expect(result.outcome.results[0]?.repairTrace).toContainEqual({ stage: 'stage3', outcome: 'accepted' });
    const requests = executor.structuredRequests.filter((request) => request.prompt.includes('Assign a target name'));
    expect(requests).toHaveLength(1);
    expect(requests[0]?.context).toHaveProperty('targets', targets);
    if (defaultTarget === undefined) {
      expect(scenario.deps.config).not.toHaveProperty('defaultTarget');
      expect(requests[0]?.context).not.toHaveProperty('defaultTarget');
    } else {
      expect(scenario.deps.config.defaultTarget).toBe(defaultTarget);
      expect(requests[0]?.context).toHaveProperty('defaultTarget', defaultTarget);
    }
    expect(frozen).toEqual(targets);
    expect((await createScenario()).deps.config.targets).toEqual(RESOLVED_TARGETS);
  });
});
