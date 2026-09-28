import { describe, expect, it } from 'vitest';
import { validateConfirms } from '#core/ir/confirms-validation.js';
import { Step } from '#core/ir/schema.js';

const intent = { description: 'Submit', sourceSpan: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 2 } } as const;

function action(id: string, action: 'click' | 'navigate' = 'click', target = 'app'): Step {
  return action === 'click'
    ? { id, target, kind: 'action', action, intent }
    : { id, target, kind: 'action', action, url: 'https://example.com' };
}

function assertion(id: string, confirms: string[], target = 'app'): Step {
  return { id, target, kind: 'assert', check: 'text-visible', text: 'Done', confirms };
}

function issue(code: string, stepIndex: number, entryIndex: number) {
  return expect.objectContaining({ code, path: ['steps', stepIndex, 'confirms', entryIndex] });
}

describe('validateConfirms (TEST-I4)', () => {
  it('requires a nonempty confirms array at the Step schema boundary', () => {
    const valid = assertion('check', ['a']);
    expect(Step.safeParse(valid).success).toBe(true);
    expect(Step.safeParse({ ...valid, confirms: [] }).success).toBe(false);
  });

  it('reports an unknown step ID at its entry', () => {
    expect(validateConfirms([action('a'), assertion('check', ['missing'])]))
      .toEqual([issue('confirms-unknown-step', 1, 0)]);
  });

  it('rejects a reference to a later action', () => {
    expect(validateConfirms([assertion('check', ['later']), action('later')]))
      .toEqual([issue('confirms-not-earlier', 0, 0)]);
  });

  it('rejects self-reference as not earlier', () => {
    expect(validateConfirms([assertion('check', ['check'])]))
      .toEqual([issue('confirms-not-earlier', 0, 0)]);
  });

  it.each([
    ['navigate', action('referenced', 'navigate')],
    ['assert', assertion('referenced', ['prior'])],
    ['ai', { id: 'referenced', target: 'app', kind: 'ai', instruction: 'Inspect', instructionCoverage: [] } as unknown as Step],
  ])('rejects an earlier %s step as a confirmation target', (_kind, referenced) => {
    const steps = [action('prior'), referenced, assertion('check', ['referenced'])];
    expect(validateConfirms(steps)).toEqual([issue('confirms-not-action', 2, 0)]);
  });

  it('reports the repeated entry in one confirms array', () => {
    expect(validateConfirms([action('a'), assertion('check', ['a', 'a'])]))
      .toEqual([issue('confirms-duplicate', 1, 1)]);
  });

  it('reports a repeated unknown ID only as a duplicate on its second entry', () => {
    expect(validateConfirms([assertion('check', ['missing', 'missing'])]))
      .toEqual([issue('confirms-unknown-step', 0, 0), issue('confirms-duplicate', 0, 1)]);
  });

  it('reports a repeated not-earlier ID only as a duplicate on its second entry', () => {
    expect(validateConfirms([assertion('check', ['check', 'check'])]))
      .toEqual([issue('confirms-not-earlier', 0, 0), issue('confirms-duplicate', 0, 1)]);
  });

  it('reports a descending plan-order entry', () => {
    expect(validateConfirms([action('first'), action('second'), assertion('check', ['second', 'first'])]))
      .toEqual([issue('confirms-unsorted', 2, 1)]);
  });

  it('accepts an earlier action from another target', () => {
    expect(validateConfirms([action('a', 'click', 'other'), assertion('check', ['a'])])).toEqual([]);
  });

  it('accepts an earlier capture step', () => {
    const capture: Step = { id: 'capture', target: 'app', kind: 'capture', intent, variable: 'saved' };
    expect(validateConfirms([capture, assertion('check', ['capture'])])).toEqual([]);
  });
});
