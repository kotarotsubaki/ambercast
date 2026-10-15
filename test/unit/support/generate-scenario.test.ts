import { describe, expect, it } from 'vitest';
import { generate } from '#usecases/generate.js';
import {
  createScenario, DEFAULT_OPTIONS, RESOLVED_TARGETS, RESPONSE, writePrompt,
} from '../../support/generate-scenario.js';
import { GENERIC_FALLBACK_MESSAGES } from '../../support/report-assertions.js';

const targets = {
  admin: { surface: 'web' as const, baseUrl: 'https://admin.example.test', description: 'Administration console' },
  shop: { surface: 'web' as const, baseUrl: 'https://shop.example.test', description: 'Customer storefront' },
};

describe('generate scenario target configuration (SPEC-1, SPEC-10)', () => {
  it('preserves the complete default configuration and single web target', () => {
    const { deps } = createScenario();
    expect(deps.config).toEqual({
      testDir: '/workspace/tests', testMatch: ['**/*.test.md'], testIgnore: ['**/.runs/**'],
      targets: RESOLVED_TARGETS, defaultTarget: 'web',
      ai: { provider: 'codex', timeoutMs: 100, maxGenerateAttempts: 2 },
    });
  });

  it('preserves the existing dependency overrides with omitted target options', () => {
    const original = createScenario();
    const { deps } = createScenario({ config: original.deps.config, clock: original.deps.clock });
    expect(deps.config).toBe(original.deps.config);
    expect(deps.clock).toBe(original.deps.clock);
  });

  it('resolves multiple targets with their URLs and descriptions without mutating inputs', () => {
    const frozen = Object.freeze({
      admin: Object.freeze({ ...targets.admin }), shop: Object.freeze({ ...targets.shop }),
    });
    const { deps } = createScenario({}, { targets: frozen, defaultTarget: 'shop' });
    expect(deps.config.targets).toEqual({
      admin: { ...RESOLVED_TARGETS.web, ...targets.admin },
      shop: { ...RESOLVED_TARGETS.web, ...targets.shop },
    });
    expect(deps.config.defaultTarget).toBe('shop');
    expect(frozen).toEqual(targets);
  });

  it('removes the default target when explicitly undefined', () => {
    const { deps } = createScenario({}, { targets, defaultTarget: undefined });
    expect(Object.keys(deps.config.targets)).toEqual(['admin', 'shop']);
    expect(deps.config).not.toHaveProperty('defaultTarget');
  });

  it('can remove the default while retaining the original single target', () => {
    const { deps } = createScenario({}, { defaultTarget: undefined });
    expect(deps.config.targets).toEqual(RESOLVED_TARGETS);
    expect(deps.config).not.toHaveProperty('defaultTarget');
  });

  it('keeps full config overrides authoritative when target options are also supplied', () => {
    const original = createScenario();
    const { deps } = createScenario({ config: original.deps.config }, { targets, defaultTarget: undefined });
    expect(deps.config).toBe(original.deps.config);
  });

  it.each([
    ['omitted options', undefined, { web: { surface: 'web', baseUrl: 'https://example.test' } }, 'web'],
    ['empty options', {}, { web: { surface: 'web', baseUrl: 'https://example.test' } }, 'web'],
    ['multiple targets with default', { targets, defaultTarget: 'shop' }, targets, 'shop'],
    ['multiple targets without default', { targets, defaultTarget: undefined }, targets, undefined],
    ['single target without default', { defaultTarget: undefined }, { web: { surface: 'web', baseUrl: 'https://example.test' } }, undefined],
    ['optional surface and description', { targets: { admin: { baseUrl: targets.admin.baseUrl } }, defaultTarget: undefined }, { admin: { surface: 'web', baseUrl: targets.admin.baseUrl } }, undefined],
  ] as const)('passes %s through to the real provider request context', async (_name, options, expectedTargets, expectedDefault) => {
    const { deps, execute, recordingStorage } = createScenario({}, options);
    const file = await writePrompt(recordingStorage.storage);
    const outcome = await generate(deps, { ...DEFAULT_OPTIONS, files: [file] });
    expect(outcome.results).toMatchObject([{ status: 'generated', aiCalls: 1 }]);
    expect(execute).toHaveBeenCalledTimes(1);
    const context = execute.mock.calls[0]![0].context;
    expect(context).toHaveProperty('targets', expectedTargets);
    if (expectedDefault === undefined) expect(context).not.toHaveProperty('defaultTarget');
    else expect(context).toHaveProperty('defaultTarget', expectedDefault);
    for (const target of Object.values((context as { targets: Record<string, unknown> }).targets)) {
      expect(target).not.toHaveProperty('executor');
      expect(target).not.toHaveProperty('healReplayIsolation');
      expect(target).not.toHaveProperty('resolveTimeoutMs');
    }
  });

  it('retains multiple targets and absent default across a schema-invalid retry', async () => {
    const { deps, execute, recordingStorage } = createScenario({}, { targets, defaultTarget: undefined });
    const file = await writePrompt(recordingStorage.storage);
    const invalidResponse = { ...RESPONSE, extra: true };
    execute.mockResolvedValueOnce({ data: invalidResponse, raw: JSON.stringify(invalidResponse) });
    const outcome = await generate(deps, { ...DEFAULT_OPTIONS, files: [file] });
    expect(outcome.results).toMatchObject([{ status: 'generated', aiCalls: 2 }]);
    expect(execute).toHaveBeenCalledTimes(2);
    for (const [request] of execute.mock.calls) {
      expect(request.context).toHaveProperty('targets', targets);
      expect(request.context).not.toHaveProperty('defaultTarget');
    }
    expect(execute.mock.calls[1]![0].context).toHaveProperty('previousAttempts');
  });

  it('isolates custom target configuration from later default scenarios', () => {
    const custom = createScenario({}, { targets, defaultTarget: undefined });
    expect(Object.keys(custom.deps.config.targets)).toEqual(['admin', 'shop']);
    const original = createScenario();
    expect(original.deps.config.targets).toEqual(RESOLVED_TARGETS);
    expect(original.deps.config.defaultTarget).toBe('web');
  });
});

describe('assumption fallback registration (SG-1)', () => {
  it('registers the inspection fallback exactly once and excludes the omission notice', () => {
    expect(GENERIC_FALLBACK_MESSAGES.filter((message) => message === 'The generated assumptions could not be inspected.')).toHaveLength(1);
    expect(GENERIC_FALLBACK_MESSAGES).not.toContain('An assumption was omitted because it looked like a secret.');
  });
});
