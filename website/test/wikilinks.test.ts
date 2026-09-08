import { describe, expect, it } from 'vitest';
import { convertWikilinks, splitByCodeRegions } from '../scripts/lib/wikilinks.mjs';

const titles = new Map([
  ['introduction', 'Introduction'],
  ['reference/cli/run', 'Run command'],
  ['spec/plan-document', 'Plan document'],
  ['agents/setup-prompt', 'Setup prompt'],
]);

describe('convertWikilinks', () => {
  it.each([
    ['en', '[Introduction](/ambercast/introduction/)'],
    ['ja', '[Introduction](/ambercast/ja/introduction/)'],
    ['zh-cn', '[Introduction](/ambercast/zh-cn/introduction/)'],
  ])('uses the canonical locale URL for %s', (locale, expected) => {
    expect(convertWikilinks('Read [[introduction]].', { locale, titles })).toBe(`Read ${expected}.`);
  });

  it('converts ordinary, anchored, nested-spec, and multiple references without an en prefix', () => {
    expect(convertWikilinks('[[reference/cli/run#flags]] then [[spec/plan-document#document-shape]] and [[introduction]].', { locale: 'en', titles }))
      .toBe('[Run command](/ambercast/reference/cli/run/#flags) then [Plan document](/ambercast/spec/plan-document/#document-shape) and [Introduction](/ambercast/introduction/).');
  });

  it('leaves fenced and variable-delimiter inline code byte-for-byte unchanged', () => {
    const markdown = [
      'Before [[introduction]].',
      '   ```md',
      '   [[introduction]]',
      '   ```',
      '``[[introduction]] with ` nested`` and [[reference/cli/run]].',
      'After [[spec/plan-document]].',
    ].join('\n');
    expect(convertWikilinks(markdown, { locale: 'ja', titles })).toBe([
      'Before [Introduction](/ambercast/ja/introduction/).',
      '   ```md',
      '   [[introduction]]',
      '   ```',
      '``[[introduction]] with ` nested`` and [Run command](/ambercast/ja/reference/cli/run/).',
      'After [Plan document](/ambercast/ja/spec/plan-document/).',
    ].join('\n'));
  });

  it('recognizes matched backtick and tilde fences only when their delimiter and indent qualify', () => {
    const regions = splitByCodeRegions('~~~\n[[introduction]]\n~~~\n    ```\n[[reference/cli/run]]\n    ```');
    expect(regions).toEqual([
      { text: '~~~\n[[introduction]]\n~~~', isCode: true },
      { text: '\n    ```\n[[reference/cli/run]]\n    ```', isCode: false },
    ]);
  });

  it('aggregates every unresolved target and malformed residual instead of reporting only the first', () => {
    let error: unknown;
    try {
      convertWikilinks('[[missing-one]] [[missing-two#anchor]] [[Not a canonical target]]', { locale: 'en', titles });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('missing-one');
    expect((error as Error).message).toContain('missing-two#anchor');
    expect((error as Error).message).toContain('[[Not a canonical target]]');
  });
});
