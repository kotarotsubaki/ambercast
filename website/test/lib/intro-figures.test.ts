import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractIntroFigures } from '../../scripts/lib/intro-figures.mjs';

const sourceMarkdown = readFileSync(new URL('../fixtures/intro-source-en.md', import.meta.url), 'utf8');
const expectedEnglishFigures = JSON.parse(readFileSync(new URL('../fixtures/intro-en.json', import.meta.url), 'utf8'));
const jaIntroduction = readFileSync(new URL('../fixtures/intro-source-ja.md', import.meta.url), 'utf8');
const zhCnIntroduction = readFileSync(new URL('../fixtures/intro-source-zh-cn.md', import.meta.url), 'utf8');

const jaSnippet = `
## Cycle {#generate-run-heal-cycle}
キャプション: ja cycle caption
代替テキスト: 「ja cycle alt」
- \`JA PROMPT\`: ja prompt text
- \`JA GENERATE\`: ja generate text
- \`JA ARTIFACTS\`: ja artifacts text
- \`JA RUN\`: ja run text
- \`JA REPLAY\`: ja replay text
- \`JA HEAL\`: ja heal text
- \`prompt → generate\` (\`ja cycle edge\`)

## Files {#three-files}
キャプション: ja files caption
代替テキスト: 「ja files alt」
- \`JA PROMPT FILE\`: ja prompt file text
- \`JA PLAN FILE\`: ja plan file text
- \`JA GROUNDING FILE\`: ja grounding file text
- \`prompt-file → plan-file\` (\`ja files edge\`)

## Ledger {#ai-call-ledger}
キャプション: ja ledger caption
代替テキスト: 「ja ledger alt」
- \`JA GENERATE\`: ja ledger generate text
- \`JA REPLAY\`: ja ledger replay text
- \`JA HEAL\`: ja ledger heal text
- \`generate → replay\` (\`ja ledger edge\`)
`;

const zhCnSnippet = `
## Cycle {#generate-run-heal-cycle}
**无障碍替代文本**：zh cycle alt
- \`ZH PROMPT\`：zh prompt text
- \`ZH GENERATE\`：zh generate text
- \`ZH ARTIFACTS\`：zh artifacts text
- \`ZH RUN\`：zh run text
- \`ZH REPLAY\`：zh replay text
- \`ZH HEAL\`：zh heal text
- \`prompt → generate\` (\`zh cycle edge\`)

## Files {#three-files}
**无障碍替代文本**：zh files alt
- \`ZH PROMPT FILE\`：zh prompt file text
- \`ZH PLAN FILE\`：zh plan file text
- \`ZH GROUNDING FILE\`：zh grounding file text
- \`prompt-file ↔ plan-file\` (\`zh files edge\`)

## Ledger {#ai-call-ledger}
**无障碍替代文本**：zh ledger alt
- \`ZH GENERATE\`：zh ledger generate text
- \`ZH REPLAY\`：zh ledger replay text
- \`ZH HEAL\`：zh ledger heal text
- \`generate → replay\` (\`zh ledger edge\`)
`;

const translatedSpotChecks = {
  ja: {
    cycle: {
      nodes: [
        { id: 'prompt', label: 'SIGN-IN.TEST.MD · PROMPT', text: '正規化されたプロンプトが生成の入力になります。' },
        { id: 'generate', label: 'GENERATE · AI WHEN NEEDED', text: '生成（generate）は遅延AIエグゼキューターを構成します。' },
      ],
      edgeLabel: 'ambercast generate',
    },
  },
  'zh-cn': {
    cycle: {
      nodes: [
        { id: 'prompt', label: 'SIGN-IN.TEST.MD · PROMPT', text: '规范化后的提示词作为生成输入。' },
        { id: 'generate', label: 'GENERATE · AI WHEN NEEDED', text: '生成过程组合了一个惰性 AI 执行器。' },
      ],
      edgeLabel: 'ambercast generate',
    },
  },
};

function expectExtractionError(markdown: string, locale: string, expectedTerms: string[]) {
  let thrown: unknown;

  try {
    extractIntroFigures(markdown, { locale: locale as 'en' });
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(Error);
  const message = (thrown as Error).message;
  for (const term of expectedTerms) {
    expect(message).toContain(term);
  }
}

describe('extractIntroFigures', () => {
  it('extracts the byte-for-byte English source fixture into the hand-authored golden data', () => {
    expect(extractIntroFigures(sourceMarkdown, { locale: 'en' })).toEqual(expectedEnglishFigures);
  });

  it('keeps the generated English data equal to the independent golden fixture', () => {
    let generatedFigures: unknown;

    try {
      generatedFigures = JSON.parse(readFileSync(new URL('../../src/data/intro/en.json', import.meta.url), 'utf8'));
    } catch (error) {
      throw new Error(`Expected generated introduction data at src/data/intro/en.json: ${(error as Error).message}`);
    }

    expect(generatedFigures).toEqual(expectedEnglishFigures);
  });

  it('parses Japanese colon-separated nodes, captions, and quoted alternatives', () => {
    const figures = extractIntroFigures(jaSnippet, { locale: 'ja' });

    expect(figures.cycle).toMatchObject({
      alt: 'ja cycle alt',
      caption: 'ja cycle caption',
      edges: [{ from: 'prompt', to: 'generate', label: 'ja cycle edge', direction: 'forward' }],
    });
    expect(figures.cycle.nodes).toHaveLength(6);
    expect(figures.cycle.nodes.find((node) => node.id === 'prompt')).toMatchObject({
      label: 'JA PROMPT',
      text: 'ja prompt text',
    });
    expect(figures.files.caption).toBe('ja files caption');
  });

  it('parses Chinese full-width node separators and a bold unquoted alternative label without a caption', () => {
    const figures = extractIntroFigures(zhCnSnippet, { locale: 'zh-cn' });

    expect(figures.cycle).toMatchObject({
      alt: 'zh cycle alt',
      caption: null,
    });
    expect(figures.cycle.nodes).toHaveLength(6);
    expect(figures.cycle.nodes.find((node) => node.id === 'prompt')).toMatchObject({
      label: 'ZH PROMPT',
      text: 'zh prompt text',
    });
    expect(figures.files).toMatchObject({
      caption: null,
      edges: [{ from: 'prompt-file', to: 'plan-file', label: 'zh files edge', direction: 'bidirectional' }],
    });
  });

  it('spot-checks hand-transcribed Japanese and Chinese copy from their localized introductions', () => {
    const jaFigures = extractIntroFigures(jaIntroduction, { locale: 'ja' });
    const zhCnFigures = extractIntroFigures(zhCnIntroduction, { locale: 'zh-cn' });

    expect({
      cycle: {
        nodes: jaFigures.cycle.nodes.slice(0, 2),
        edgeLabel: jaFigures.cycle.edges[0].label,
      },
    }).toEqual(translatedSpotChecks.ja);
    expect({
      cycle: {
        nodes: zhCnFigures.cycle.nodes.slice(0, 2),
        edgeLabel: zhCnFigures.cycle.edges[0].label,
      },
    }).toEqual(translatedSpotChecks['zh-cn']);
  });

  it('maps a forward arrow to the explicit forward direction', () => {
    const figures = extractIntroFigures(sourceMarkdown, { locale: 'en' });

    expect(figures.files.edges[0].direction).toBe('forward');
  });

  it('maps a bidirectional arrow to the explicit bidirectional direction', () => {
    const figures = extractIntroFigures(sourceMarkdown, { locale: 'en' });

    expect(figures.files.edges[2].direction).toBe('bidirectional');
  });

  it('accepts the current three-edge minimum and six-edge maximum figures', () => {
    const figures = extractIntroFigures(sourceMarkdown, { locale: 'en' });

    expect(figures.files.edges).toHaveLength(3);
    expect(figures.ledger.edges).toHaveLength(3);
    expect(figures.cycle.edges).toHaveLength(6);
  });

  it('rejects a node-count mismatch and reports the matched node lines', () => {
    const markdown = sourceMarkdown.replace('- `HEAL · APPROVAL BEFORE WRITE` — Heal runtime owns confirmation and commit composition.\n', '');

    expectExtractionError(markdown, 'en', [
      'cycle',
      'en',
      'SIGN-IN.TEST.MD · PROMPT',
      'GROUNDING HIT · 0 AI CALLS',
    ]);
  });

  it('rejects an edge that refers to an id outside the figure id set', () => {
    const markdown = sourceMarkdown.replace('`prompt → generate` (`ambercast generate`)', '`unknown → generate` (`ambercast generate`)');

    expectExtractionError(markdown, 'en', ['cycle', 'en', 'unknown → generate']);
  });

  it('rejects a figure without an alternative text line', () => {
    const markdown = sourceMarkdown.replace('Accessibility text alternative: “A directed loop: a prompt becomes plan and grounding companions; run either replays them without provider resolution on a grounding hit or, after a failure, lets the user explicitly choose the separate heal command; an authorized heal updates the companions.”\n\n', '');

    expectExtractionError(markdown, 'en', ['cycle', 'en']);
  });

  it('rejects more than one alternative text line in a figure', () => {
    const markdown = sourceMarkdown.replace('Nodes:\n', 'Accessibility text alternative: "another alternative"\n\nNodes:\n');

    expectExtractionError(markdown, 'en', ['cycle', 'en']);
  });

  it('rejects more than one caption line in a figure', () => {
    const markdown = jaIntroduction.replace('代替テキスト:', 'キャプション: duplicate caption\n\n代替テキスト:');

    expectExtractionError(markdown, 'ja', ['cycle', 'ja']);
  });

  it('rejects a missing figure anchor', () => {
    const markdown = sourceMarkdown.replace('{#three-files}', '{#different-anchor}');

    expectExtractionError(markdown, 'en', ['files', 'en', 'three-files']);
  });

  it('rejects a duplicated figure anchor', () => {
    const markdown = `${sourceMarkdown}\n## Duplicate {#three-files}\n`;

    expectExtractionError(markdown, 'en', ['files', 'en', 'three-files']);
  });

  it('rejects a duplicate from-to-direction edge triple', () => {
    const markdown = sourceMarkdown.replace('`prompt → generate` (`ambercast generate`)\n', '`prompt → generate` (`ambercast generate`)\n- `prompt → generate` (`duplicate`)\n');

    expectExtractionError(markdown, 'en', ['cycle', 'en', 'prompt', 'generate']);
  });

  it('rejects an unrecognized backtick-led bullet instead of skipping it', () => {
    const markdown = sourceMarkdown.replace('Nodes:\n', 'Nodes:\n- `unsupported bullet` has no supported grammar\n');

    expectExtractionError(markdown, 'en', ['cycle', 'en', '`unsupported bullet` has no supported grammar']);
  });

  it('rejects an unrecognized locale value', () => {
    expectExtractionError(sourceMarkdown, 'fr', ['fr']);
  });

  it('rejects a zero-edge figure section', () => {
    const markdown = sourceMarkdown.replace(
      'Edges:\n- `prompt-file → plan-file` (`generate`)\n- `prompt-file → grounding-file` (`generate`)\n- `plan-file ↔ grounding-file` (`paired derived artifacts`)\n',
      'Edges:\n',
    );

    expectExtractionError(markdown, 'en', ['files', 'en']);
  });
});
