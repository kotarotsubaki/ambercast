import { describe, expect, it } from 'vitest';
import { deriveRequiredCapabilities, UI_CAPABILITIES, type UiCapability } from '../../../../src/core/ir/capabilities.js';
import { GroundingDocument, PlanDocument, type Step } from '../../../../src/core/ir/schema.js';

const target = { surface: 'web', baseUrl: 'https://example.test/' } as const;
const element = { strategy: 'accessibility', role: 'button', name: 'Continue' } as const;
const criterion = { id: 'done', kind: 'success', sourceSpan: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 } } as const;
const ai = (id: string, targetName = 'A'): Step => ({ id, target: targetName, kind: 'ai', instruction: 'Finish the task', instructionCoverage: [criterion] });
const action = (id: string, actionName: 'click' | 'navigate' | 'press' | 'fill' | 'fill-secret', targetName = 'A'): Step => {
  const base = { id, target: targetName, kind: 'action' } as const;
  switch (actionName) {
    case 'click': return { ...base, action: actionName, element };
    case 'navigate': return { ...base, action: actionName, url: 'https://example.test/next' };
    case 'press': return { ...base, action: actionName, element, key: 'Enter' };
    case 'fill': return { ...base, action: actionName, element, value: 'hello' };
    case 'fill-secret': return { ...base, action: actionName, element, secretRef: '{{secrets.password}}' };
  }
};
const assertion = (id: string, check: 'text-visible' | 'element-visible' | 'text-equals' | 'url-matches' | 'element-count', targetName = 'A'): Step => {
  const base = { id, target: targetName, kind: 'assert' } as const;
  switch (check) {
    case 'text-visible': return { ...base, check, text: 'Ready' };
    case 'element-visible': return { ...base, check, element };
    case 'text-equals': return { ...base, check, element, text: 'Ready' };
    case 'url-matches': return { ...base, check, pattern: '/next' };
    case 'element-count': return { ...base, check, element, count: 0 };
  }
};
const capture = (id: string, targetName = 'A'): Step => ({ id, target: targetName, kind: 'capture', element, variable: 'saved' });
const plan = (steps: Step[], names = ['A']) => PlanDocument.parse({
  schemaVersion: 4,
  source: { inputsDigest: 'a'.repeat(64) },
  targets: Object.fromEntries(names.map((name) => [name, target])),
  steps,
});
const grounding = (entries: GroundingDocument['entries']) => GroundingDocument.parse({
  schemaVersion: 2,
  planDigest: 'b'.repeat(64),
  entries,
});
const capabilities = (result: Record<string, ReadonlySet<UiCapability>>, name = 'A') => [...result[name]!];

describe('deriveRequiredCapabilities', () => {
  it('maps action, assert, and capture steps to their own target vocabulary', () => {
    const result = deriveRequiredCapabilities(plan([action('a', 'navigate'), assertion('b', 'text-visible'), capture('c')]), undefined, { resolve: false });
    expect(capabilities(result)).toEqual(['navigate', 'text-visible', 'capture']);
  });

  it.each(['click', 'navigate', 'press', 'fill', 'fill-secret'] as const)('maps action %s', (name) => {
    expect(capabilities(deriveRequiredCapabilities(plan([action('a', name)]), undefined, { resolve: false }))).toEqual([name]);
  });

  it.each(['text-visible', 'element-visible', 'text-equals', 'url-matches', 'element-count'] as const)('maps assertion %s', (name) => {
    expect(capabilities(deriveRequiredCapabilities(plan([assertion('a', name)]), undefined, { resolve: false }))).toEqual([name]);
  });

  it('collects click, fill, and terminal text-visible from an AI trace', () => {
    const cache = grounding({ ai1: { kind: 'ai', trace: { events: [{ type: 'click', element }, { type: 'fill', element, value: 'hello' }], verification: [{ type: 'assert', check: 'text-visible', text: 'Ready' }] } } });
    expect(capabilities(deriveRequiredCapabilities(plan([ai('ai1')]), cache, { resolve: false }))).toEqual(['click', 'fill', 'text-visible']);
  });

  it('maps trace assert events through check, includes every verification, deduplicates, and orders canonically', () => {
    const cache = grounding({ ai1: { kind: 'ai', trace: {
      events: [{ type: 'assert', check: 'element-count', element, count: 0 }, { type: 'fill', element, value: 'hello' }, { type: 'assert', check: 'text-visible', text: 'Ready' }],
      verification: [{ type: 'assert', check: 'url-matches', pattern: '/next' }, { type: 'assert', check: 'element-count', element, count: 0 }, { type: 'assert', check: 'text-equals', element, text: 'Ready' }],
    } } });
    const actual = capabilities(deriveRequiredCapabilities(plan([ai('ai1')]), cache, { resolve: false }));
    expect(actual).toEqual(['fill', 'text-visible', 'text-equals', 'url-matches', 'element-count']);
    expect(actual).toEqual(UI_CAPABILITIES.filter((name) => actual.includes(name)));
  });

  it.each([
    ['click', action('s', 'click')], ['press', action('s', 'press')], ['fill', action('s', 'fill')], ['fill-secret', action('s', 'fill-secret')],
    ['element-visible', assertion('s', 'element-visible')], ['text-equals', assertion('s', 'text-equals')], ['element-count', assertion('s', 'element-count')], ['capture', capture('s')],
  ] as const)('adds snapshot for element-bearing %s only with resolve enabled', (_name, step) => {
    expect(capabilities(deriveRequiredCapabilities(plan([step]), undefined, { resolve: false }))).not.toContain('snapshot');
    expect(capabilities(deriveRequiredCapabilities(plan([step]), undefined, { resolve: true }))).toEqual([step.kind === 'action' ? step.action : step.kind === 'assert' ? step.check : 'capture', 'snapshot']);
  });

  it.each([action('s', 'navigate'), assertion('s', 'text-visible'), assertion('s', 'url-matches')])('does not add snapshot for a step without element: $kind', (step) => {
    expect(capabilities(deriveRequiredCapabilities(plan([step]), undefined, { resolve: true }))).not.toContain('snapshot');
  });

  it('requires agentic for an AI step with a trace only when resolution is enabled', () => {
    const cache = grounding({ ai1: { kind: 'ai', trace: { events: [], verification: [{ type: 'assert', check: 'text-visible', text: 'Ready' }] } } });
    expect(capabilities(deriveRequiredCapabilities(plan([ai('ai1')]), cache, { resolve: false }))).toEqual(['text-visible']);
    expect(capabilities(deriveRequiredCapabilities(plan([ai('ai1')]), cache, { resolve: true }))).toEqual(['text-visible', 'agentic']);
  });

  it('requires nothing for an AI step without a trace when resolution is disabled', () => {
    expect(capabilities(deriveRequiredCapabilities(plan([ai('ai1')]), grounding({}), { resolve: false }))).toEqual([]);
    expect(capabilities(deriveRequiredCapabilities(plan([ai('ai1')]), undefined, { resolve: false }))).toEqual([]);
  });

  it('requires agentic for an AI step without a trace when resolution is enabled', () => {
    expect(capabilities(deriveRequiredCapabilities(plan([ai('ai1')]), undefined, { resolve: true }))).toEqual(['agentic']);
  });

  it('keeps two target sets independent, including AI trace contribution only to its own target', () => {
    const cache = grounding({ 'ai-b': { kind: 'ai', trace: { events: [{ type: 'click', element }], verification: [{ type: 'assert', check: 'url-matches', pattern: '/next' }] } } });
    const result = deriveRequiredCapabilities(plan([action('a', 'fill', 'A'), ai('ai-b', 'B')], ['A', 'B']), cache, { resolve: true });
    expect(capabilities(result, 'A')).toEqual(['fill', 'snapshot']);
    expect(capabilities(result, 'B')).toEqual(['click', 'url-matches', 'agentic']);
    expect(result.A).not.toBe(result.B);
  });

  it('returns an empty set for every target of an empty plan', () => {
    const emptyPlan: PlanDocument = { schemaVersion: 4, source: { inputsDigest: 'a'.repeat(64) }, targets: { A: target, B: target }, steps: [] };
    const result = deriveRequiredCapabilities(emptyPlan, undefined, { resolve: true });
    expect(Object.keys(result).sort()).toEqual(['A', 'B']);
    expect(capabilities(result, 'A')).toEqual([]);
    expect(capabilities(result, 'B')).toEqual([]);
  });

  it('is deterministic and leaves plan and grounding unchanged', () => {
    const input = plan([ai('ai1'), action('a', 'click')]);
    const cache = grounding({ ai1: { kind: 'ai', trace: { events: [{ type: 'fill', element, value: 'hello' }], verification: [{ type: 'assert', check: 'text-visible', text: 'Ready' }] } } });
    const beforePlan = structuredClone(input);
    const beforeGrounding = structuredClone(cache);
    const first = deriveRequiredCapabilities(input, cache, { resolve: true });
    const second = deriveRequiredCapabilities(input, cache, { resolve: true });
    expect(capabilities(first)).toEqual(capabilities(second));
    expect(input).toEqual(beforePlan);
    expect(cache).toEqual(beforeGrounding);
  });
});
