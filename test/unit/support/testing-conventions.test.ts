import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const AGENTS_PATH = new URL('../../../AGENTS.md', import.meta.url);

function splitSections(body: string): Array<{ heading: string; lines: string[] }> {
  const sections: Array<{ heading: string; lines: string[] }> = [];
  let inFence = false;
  for (const line of body.split('\n')) {
    if (line.startsWith('```')) inFence = !inFence;
    if (!inFence && line.startsWith('## ')) sections.push({ heading: line, lines: [line] });
    else sections.at(-1)?.lines.push(line);
  }
  return sections;
}

describe('AGENTS.md testing conventions (TEST-A11, SPEC-A9 and SPEC-A10)', () => {
  it('places Testing conventions immediately after Conventions and states the four contracts', () => {
    const sections = splitSections(readFileSync(AGENTS_PATH, 'utf8'));
    const index = sections.findIndex(({ heading }) => heading === '## Conventions');
    expect(index).toBeGreaterThanOrEqual(0);
    expect(sections[index + 1]?.heading).toBe('## Testing conventions');
    const body = sections[index + 1]?.lines.join('\n') ?? '';
    for (const phrase of [
      'assertDiagnosable', 'assertZeroAiCalls', 'assertNoSecretDisclosure',
      'test/fixtures/corpus/', 'JSONL', 'it.each(loadCorpus(',
      'source', 'date', 'GENERIC_FALLBACK_MESSAGES',
    ]) expect(body).toContain(phrase);
    expect(body).toMatch(/dogfood|dogfooding/i);
    expect(body).toMatch(/false positive|false negative|defect|misclassification/i);
    expect(body).toMatch(/update|maintain/i);
  });
});
