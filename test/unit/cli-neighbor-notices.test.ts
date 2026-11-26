import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { renderHumanReport } from '../../src/cli/main.js';
import { loadCorpus } from '../support/corpus.js';

function render(warnings: readonly unknown[], steps: readonly unknown[] = [], color = false): string {
  return renderHumanReport({
    command: 'run', errors: [], results: [{
      id: 'login', file: 'login.test.md', status: 'passed', warnings, steps,
    }],
  } as never, color);
}

describe('human neighbor matching notices', () => {
  it.each(loadCorpus(new URL('../fixtures/corpus/report/neighbor-slot-wording.jsonl', import.meta.url), {
    value: z.object({ names: z.array(z.enum(['parent', 'siblingBefore', 'siblingAfter'])), saved: z.boolean() }),
    expected: z.string(),
  }))('line $line: $note', ({ value, expected }) => {
    const output = render([{ kind: 'neighbor-name-ignored', stepId: 'submit', ...value }]);
    expect(output).toBe(`passed login.test.md\n${expected}\n`);
    expect(output.split('\n').filter(line => line.includes('warning:'))).toHaveLength(1);
  });

  it('preserves warning array order across existing and neighbor notices', () => {
    expect(render([
      { kind: 'generator-assumption', message: 'The browser starts signed out.' },
      { kind: 'neighbor-name-ignored', stepId: 'second', names: ['siblingAfter'], saved: false },
      { kind: 'assert-held-before-actions', stepId: 'already-visible' },
      { kind: 'neighbor-name-ignored', stepId: 'first', names: ['parent'], saved: true },
    ])).toBe('passed login.test.md\n'
      + '  warning: The browser starts signed out.\n'
      + '  warning: second: the text next to this element differed from the stored grounding (the element after it); it is no longer compared for this step; this was not saved, so the next replay stops here again\n'
      + '  warning: already-visible: this assertion already held before the preceding actions ran, so it may not verify their effect\n'
      + '  warning: first: the text next to this element differed from the stored grounding (its container); it is no longer compared for this step\n');
  });

  it('keeps binding metadata out of human output without a new notice', () => {
    expect(render([], [{ id: 'submit', binding: { ignoredNames: ['parent', 'siblingAfter'] } }])).toBe('passed login.test.md\n');
  });

  it('escapes untrusted step identifiers on the same warning line', () => {
    expect(render([{ kind: 'neighbor-name-ignored', stepId: 'submit\n\u001b[31m', names: ['parent'], saved: true }])).toBe(
      'passed login.test.md\n  warning: submit\\n\\u001b[31m: the text next to this element differed from the stored grounding (its container); it is no longer compared for this step\n',
    );
  });

  it('uses the existing warning color convention', () => {
    expect(render([{ kind: 'neighbor-name-ignored', stepId: 'submit', names: ['parent'], saved: true }], [], true)).toBe(
      '\u001b[32mpassed\u001b[0m login.test.md\n  \u001b[33mwarning\u001b[0m: submit: the text next to this element differed from the stored grounding (its container); it is no longer compared for this step\n',
    );
  });
});
