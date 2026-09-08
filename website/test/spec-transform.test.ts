import { describe, expect, it } from 'vitest';
import { transformSpec } from '../scripts/lib/spec-transform.mjs';

const titles = new Map([
  ['spec/plan-document', 'Plan document'],
  ['reference/cli/run', 'Run command'],
]);
const options = { locale: 'en', version: '0.3.1', titles, chapter: 'overview' };

function transform(markdown: string, overrides = {}) {
  return transformSpec(markdown, { ...options, ...overrides });
}

describe('transformSpec', () => {
  it('moves exactly one H1 into JSON-escaped frontmatter and removes it from the body', () => {
    const result = transform('# Plan "title" \\ path\n\nA first sentence. Rest.');
    expect(result).toContain('title: "Plan \\"title\\" \\\\ path"');
    expect(result).toContain('description: "A first sentence."');
    expect(result).not.toContain('# Plan "title"');
    expect(result).toContain('\nA first sentence. Rest.');
  });

  it.each(['No heading\n\nParagraph.', '# One\n\nParagraph.\n\n# Two'])('rejects a source with a non-single H1: %s', (markdown) => {
    expect(() => transform(markdown)).toThrow();
  });

  it.each([
    ['en', 'First sentence. Second sentence.', 'First sentence.'],
    ['en', 'Is this first? Yes.', 'Is this first?'],
    ['ja', '最初の文です。次の文です。', '最初の文です。'],
    ['zh-cn', '第一句！第二句。', '第一句！'],
  ])('extracts the first locale-aware sentence for %s', (locale, prose, description) => {
    expect(transform(`# Title\n\n${prose}`, { locale })).toContain(`description: ${JSON.stringify(description)}`);
  });

  it('skips headings, tables, code fences, and quotes to find the first normal paragraph', () => {
    const result = transform('# Title\n\n## Skipped\n\n| a | b |\n| - | - |\n| x | y |\n\n```\nNot prose.\n```\n\n> Not prose.\n\nActual paragraph first. Later.');
    expect(result).toContain('description: "Actual paragraph first."');
  });

  it.each([
    ['en', 'Compatibility policy', 'Compatibility starts here. More.', 'Compatibility starts here.'],
    ['ja', '互換性ポリシー', '互換性はここからです。続きます。', '互換性はここからです。'],
    ['zh-cn', '兼容性策略', '兼容性从这里开始。后续内容。', '兼容性从这里开始。'],
  ])('uses the %s compatibility-policy paragraph for the changelog description', (locale, heading, prose, description) => {
    const result = transform(`# Changelog\n\nWrong first paragraph.\n\n## ${heading} {#compatibility-policy}\n\n${prose}`, { locale, chapter: 'changelog' });
    expect(result).toContain(`description: ${JSON.stringify(description)}`);
    if (locale === 'en') expect(result).toContain('editUrl: "https://github.com/kotarotsubaki/ambercast/edit/main/CHANGELOG.md"');
  });

  it('extracts description after delegated wikilink conversion and reduces Markdown links to text', () => {
    const result = transform('# Title\n\nRead [[spec/plan-document]] first. More.');
    expect(result).toContain('description: "Read Plan document first."');
    expect(result).toContain('[Plan document](/ambercast/spec/plan-document/)');
  });

  it('does not mistake a period between digits for a sentence boundary in the real overview opening paragraph', () => {
    const result = transform('# Ambercast Plan Specification\n\nThis specification describes the artifacts accepted by ambercast 0.2.0. The implementation accepts Plan schema version 2 and Grounding schema version 1.');
    expect(result).toContain('description: "This specification describes the artifacts accepted by ambercast 0.2.0."');
  });

  it('expands bracketed and bare repo tokens, ranges, multi-token cells, and digit-continuation line lists', () => {
    const result = transform('# Title\n\n[repo:src/a.ts:10-12] repo:src/b.ts:20; repo:src/c.ts:30,32,40-41');
    expect(result).toContain('[src/a.ts:10-12](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/a.ts#L10-L12)');
    expect(result).toContain('[src/b.ts:20](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/b.ts#L20)');
    expect(result).toContain('[src/c.ts:30](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/c.ts#L30), [src/c.ts:32](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/c.ts#L32), [src/c.ts:40-41](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/c.ts#L40-L41)');
  });

  it('keeps a prose comma outside a repo token while treating a digit-followed comma as one line list', () => {
    const result = transform('# Title\n\nrepo:a.ts:55, repo:b.ts:58, then prose.');
    expect(result).toContain('[a.ts:55](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/a.ts#L55), [b.ts:58](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/b.ts#L58), then prose.');
    expect(result).not.toContain('[a.ts:55,');
  });

  it('removes vault quotes, preserves anchors, and uses chapter-derived root-locale edit links', () => {
    const result = transform('# Title\n\nText [vault:internal note] [[reference/cli/run#flags]] {#kept}', { chapter: 'steps' });
    expect(result).not.toContain('[vault:');
    expect(result).toContain('[Run command](/ambercast/reference/cli/run/#flags) {#kept}');
    expect(result).toContain('editUrl: "https://github.com/kotarotsubaki/ambercast/edit/main/docs/spec/steps.md"');
  });

  it('uses JSON string escaping for title and multiline description metadata', () => {
    const result = transform('# A "quote" \\ slash\n\nLine one with a "quote" and \\ slash\ncontinues here.', { locale: 'ja' });
    expect(result).toContain('title: "A \\"quote\\" \\\\ slash"');
    expect(result).toContain('description: "Line one with a \\"quote\\" and \\\\ slash\\ncontinues here."');
    expect(result).not.toContain('editUrl:');
  });
});
