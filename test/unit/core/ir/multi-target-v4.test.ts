import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { computeInputsDigest, computePlanDigest } from '../../../../src/core/ir/digest.js';
import { getGroundingJsonSchema, getPlanJsonSchema } from '../../../../src/core/ir/json-schema.js';
import { GroundingDocument, PlanDocument, TraceAction, TraceAssert } from '../../../../src/core/ir/schema.js';
import { projectPlanTargets, toTargetDefinition } from '../../../../src/core/target/resolve.js';
import type { ResolvedTargetConfigEntry } from '../../../../src/core/config/schema.js';
import { REPORT_SCHEMA_VERSION } from '../../../../src/report/schema.js';

const element = { strategy: 'accessibility', role: 'button', name: 'Continue' };
const definition = { surface: 'web', baseUrl: 'https://a.example.test' };
const source = { inputsDigest: 'a'.repeat(64) };
const step = { id: 'open-a', kind: 'action', action: 'navigate', target: 'A', url: 'https://a.example.test' };
const makePlan = (steps: unknown[] = [step], targets: Record<string, unknown> = { A: definition }) => ({ schemaVersion: 4, source, targets, steps });
const parse = (value: unknown) => PlanDocument.safeParse(value);
const planValidator = new Ajv2020({ strict: true }).compile(getPlanJsonSchema());
const groundingValidator = new Ajv2020({ strict: true }).compile(getGroundingJsonSchema());

describe('Plan v4 and grounding v2 contract', () => {
  it('rejects retired document versions and accepts the current versions', () => {
    expect(parse(makePlan()).success).toBe(true);
    expect(parse({ ...makePlan(), schemaVersion: 3 }).success).toBe(false);
    const current = { schemaVersion: 2, planDigest: 'b'.repeat(64), entries: {} };
    expect(GroundingDocument.safeParse(current).success).toBe(true);
    expect(GroundingDocument.safeParse({ ...current, schemaVersion: 1 }).success).toBe(false);
    expect(planValidator(makePlan())).toBe(true);
    expect(groundingValidator(current)).toBe(true);
  });

  it('reports undefined and unused Target names at their respective paths', () => {
    const missing = parse(makePlan([{ ...step, target: 'missing' }]));
    expect(missing.success).toBe(false);
    if (!missing.success) expect(missing.error.issues).toContainEqual(expect.objectContaining({ message: 'step target is not defined: missing', path: ['steps', 0, 'target'] }));
    const unused = parse(makePlan([step], { A: definition, B: { surface: 'web', baseUrl: 'https://b.example.test' } }));
    expect(unused.success).toBe(false);
    if (!unused.success) expect(unused.error.issues).toContainEqual(expect.objectContaining({ message: 'unused target: B', path: ['targets', 'B'] }));
    expect(parse(makePlan([step, { ...step, id: 'open-b', target: 'B' }], { A: definition, B: { surface: 'web', baseUrl: 'https://b.example.test' } })).success).toBe(true);
    expect(parse(makePlan([{ ...step, target: undefined }])).success).toBe(false);
  });

  it.each([
    ['click', { kind: 'action', action: 'click', element }],
    ['press', { kind: 'action', action: 'press', element, key: 'Enter' }],
    ['fill', { kind: 'action', action: 'fill', element, value: 'hello' }],
    ['fill-secret', { kind: 'action', action: 'fill-secret', element, secretRef: '{{secrets.app.password}}' }],
    ['element-visible', { kind: 'assert', check: 'element-visible', element }],
    ['text-equals', { kind: 'assert', check: 'text-equals', element, text: 'hello' }],
    ['element-count', { kind: 'assert', check: 'element-count', element, count: 1 }],
    ['capture', { kind: 'capture', element, variable: 'captured' }],
  ] as const)('uses element rather than the old ElementRef target in %s', (_kind, fields) => {
    const current = { id: 'inspect-a', target: 'A', ...fields };
    expect(parse(makePlan([current])).success).toBe(true);
    const { element: _element, ...withoutElement } = current;
    expect(parse(makePlan([{ ...withoutElement, target: element }]))).toMatchObject({ success: false });
    expect(parse(makePlan([{ ...current, element: undefined }]))).toMatchObject({ success: false });
  });

  it.each([
    ['click', { type: 'click', element }],
    ['press', { type: 'press', element, key: 'Enter' }],
    ['fill', { type: 'fill', element, value: 'hello' }],
    ['fill-secret', { type: 'fill-secret', element, secretRef: '{{secrets.app.password}}' }],
  ] as const)('uses element in TraceAction %s', (_name, current) => {
    expect(TraceAction.safeParse(current).success).toBe(true);
    const { element: _element, ...oldFields } = current;
    expect(TraceAction.safeParse({ ...oldFields, target: element }).success).toBe(false);
  });

  it.each([
    ['element-visible', { type: 'assert', check: 'element-visible', element }],
    ['text-equals', { type: 'assert', check: 'text-equals', element, text: 'hello' }],
    ['element-count', { type: 'assert', check: 'element-count', element, count: 1 }],
  ] as const)('uses element in TraceAssert %s', (_name, current) => {
    expect(TraceAssert.safeParse(current).success).toBe(true);
    const { element: _element, ...oldFields } = current;
    expect(TraceAssert.safeParse({ ...oldFields, target: element }).success).toBe(false);
  });

  it.each([0, 120000])('accepts assert timeoutMs %i and binds it to the Plan digest', (timeoutMs) => {
    const without = PlanDocument.parse(makePlan([{ id: 'visible-a', kind: 'assert', check: 'text-visible', target: 'A', text: 'Ready' }]));
    const withTimeout = PlanDocument.parse(makePlan([{ id: 'visible-a', kind: 'assert', check: 'text-visible', target: 'A', text: 'Ready', timeoutMs }]));
    expect(computePlanDigest(withTimeout)).not.toBe(computePlanDigest(without));
  });

  it.each([-1, 0.5, 120001])('rejects assert timeoutMs %s', (timeoutMs) => {
    expect(parse(makePlan([{ id: 'visible-a', kind: 'assert', check: 'text-visible', target: 'A', text: 'Ready', timeoutMs }])).success).toBe(false);
  });

  it('applies timeoutMs to all five Plan checks and rejects it in TraceAssert', () => {
    const checks = [
      { check: 'text-visible', text: 'Ready' },
      { check: 'element-visible', element },
      { check: 'text-equals', element, text: 'Ready' },
      { check: 'url-matches', pattern: '/ready' },
      { check: 'element-count', element, count: 1 },
    ];
    for (const check of checks) {
      expect(parse(makePlan([{ id: 'check-a', kind: 'assert', target: 'A', timeoutMs: 120000, ...check }])).success).toBe(true);
    }
    expect(TraceAssert.safeParse({ type: 'assert', check: 'text-visible', text: 'Ready', timeoutMs: 0 }).success).toBe(false);
  });

  it('rejects missing surface and browser in Plan targets in Zod and public JSON Schema', () => {
    for (const target of [{ baseUrl: definition.baseUrl }, { ...definition, browser: 'chromium' }]) {
      const value = makePlan([step], { A: target });
      expect(parse(value).success).toBe(false);
      expect(planValidator(value)).toBe(false);
    }
  });

  it('projects only referenced Target definitions and excludes browser from the digest', () => {
    const config: Record<'A' | 'B' | 'C', ResolvedTargetConfigEntry> = {
      A: { baseUrl: 'https://a.example.test', browser: 'chromium', healReplayIsolation: 'idempotent', resolveTimeoutMs: 1000, secretSinkOrigins: { '{{secrets.app.password}}': ['https://login.example.test'] } },
      B: { baseUrl: 'https://b.example.test', browser: 'chromium', healReplayIsolation: 'idempotent', resolveTimeoutMs: 2000 },
      C: { baseUrl: 'https://c.example.test', browser: 'chromium', healReplayIsolation: 'idempotent', resolveTimeoutMs: 3000 },
    };
    const inputs = (targets: typeof config) => computeInputsDigest({ normalizedTestMd: '# Test\n' as never, schemaVersion: 4, generatorPromptTemplateFingerprint: 'template', planProducerBundleFingerprint: 'bundle', targetDefinitions: projectPlanTargets(['B', 'A'], targets) });
    expect(projectPlanTargets(['B', 'A'], config)).toEqual({ A: toTargetDefinition(config.A), B: toTargetDefinition(config.B) });
    expect(toTargetDefinition(config.A)).not.toHaveProperty('browser');
    const baseline = inputs(config);
    expect(inputs({ ...config, C: { ...config.C, baseUrl: 'https://changed.example.test' } })).toBe(baseline);
    expect(inputs({ ...config, A: { ...config.A, baseUrl: 'https://changed.example.test' } })).not.toBe(baseline);
    expect(inputs({ ...config, A: { ...config.A, secretSinkOrigins: { '{{secrets.app.password}}': ['https://other.example.test'] } } })).not.toBe(baseline);
    expect(inputs({ ...config, A: { ...config.A, browser: 'firefox' as never } })).toBe(baseline);
  });

  it('publishes v4 and v2 schema identities and the frozen v3 schema accepts a v3 fixture', () => {
    expect(getPlanJsonSchema().$id).toBe('https://kotarotsubaki.github.io/ambercast/schemas/plan.v4.schema.json');
    expect(getGroundingJsonSchema().$id).toBe('https://kotarotsubaki.github.io/ambercast/schemas/grounding.v2.schema.json');
    const frozen = JSON.parse(readFileSync(new URL('../../../../website/src/schemas-frozen/plan.v3.schema.json', import.meta.url), 'utf8'));
    const legacy = JSON.parse(readFileSync(new URL('../../../fixtures/ir/golden/plan.golden.artifact.json', import.meta.url), 'utf8'));
    expect(frozen.$id).toBe('https://kotarotsubaki.github.io/ambercast/schemas/plan.v3.schema.json');
    expect(new Ajv2020({ strict: true }).compile(frozen)(legacy)).toBe(true);
    expect(REPORT_SCHEMA_VERSION).toBe('3.7');
  });

  it('emits the current build schemas with Plan v4, grounding v2, and report 3.7', () => {
    const readBuilt = (name: string) => JSON.parse(readFileSync(new URL(`../../../../dist/schema/${name}.schema.json`, import.meta.url), 'utf8'));
    expect(readBuilt('plan').$id).toBe('https://kotarotsubaki.github.io/ambercast/schemas/plan.v4.schema.json');
    expect(readBuilt('grounding').$id).toBe('https://kotarotsubaki.github.io/ambercast/schemas/grounding.v2.schema.json');
    expect(readBuilt('report').oneOf.every((variant: { properties: { schemaVersion: { const: string } } }) => variant.properties.schemaVersion.const === '3.7')).toBe(true);
  });
});
