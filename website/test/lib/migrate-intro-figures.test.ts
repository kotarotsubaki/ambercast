import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDocsFixture } from '../cli-fixture.ts';
import { main } from '../../scripts/migrate-intro-figures.mjs';

const locales = ['en', 'ja', 'zh-cn'] as const;
const fixtures: ReturnType<typeof createDocsFixture>[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  fixtures.splice(0).forEach((fixture) => fixture.dispose());
});

const markdownByLocale = {
  en: `## Cycle {#generate-run-heal-cycle}
Accessibility text alternative: "English cycle alternative"
- \`EN CYCLE PROMPT\` — English cycle prompt text.
- \`EN CYCLE GENERATE\` — English cycle generate text.
- \`EN CYCLE ARTIFACTS\` — English cycle artifacts text.
- \`EN CYCLE RUN\` — English cycle run text.
- \`EN CYCLE REPLAY\` — English cycle replay text.
- \`EN CYCLE HEAL\` — English cycle heal text.
- \`prompt → generate\` (\`English cycle edge\`)

## Files {#three-files}
Accessibility text alternative: "English files alternative"
- \`EN FILES PROMPT\` — English files prompt text.
- \`EN FILES PLAN\` — English files plan text.
- \`EN FILES GROUNDING\` — English files grounding text.
- \`prompt-file → plan-file\` (\`English files edge\`)

## Ledger {#ai-call-ledger}
Accessibility text alternative: "English ledger alternative"
- \`EN LEDGER GENERATE\` — English ledger generate text.
- \`EN LEDGER REPLAY\` — English ledger replay text.
- \`EN LEDGER HEAL\` — English ledger heal text.
- \`generate → replay\` (\`English ledger edge\`)
`,
  ja: `## Cycle {#generate-run-heal-cycle}
キャプション: 日本語のサイクルキャプション
代替テキスト: 「日本語のサイクル代替テキスト」
- \`JA CYCLE PROMPT\`: 日本語のサイクル prompt テキスト。
- \`JA CYCLE GENERATE\`: 日本語のサイクル generate テキスト。
- \`JA CYCLE ARTIFACTS\`: 日本語のサイクル artifacts テキスト。
- \`JA CYCLE RUN\`: 日本語のサイクル run テキスト。
- \`JA CYCLE REPLAY\`: 日本語のサイクル replay テキスト。
- \`JA CYCLE HEAL\`: 日本語のサイクル heal テキスト。
- \`prompt → generate\` (\`日本語のサイクルエッジ\`)

## Files {#three-files}
キャプション: 日本語のファイルキャプション
代替テキスト: 「日本語のファイル代替テキスト」
- \`JA FILES PROMPT\`: 日本語のファイル prompt テキスト。
- \`JA FILES PLAN\`: 日本語のファイル plan テキスト。
- \`JA FILES GROUNDING\`: 日本語のファイル grounding テキスト。
- \`prompt-file → plan-file\` (\`日本語のファイルエッジ\`)

## Ledger {#ai-call-ledger}
キャプション: 日本語の台帳キャプション
代替テキスト: 「日本語の台帳代替テキスト」
- \`JA LEDGER GENERATE\`: 日本語の台帳 generate テキスト。
- \`JA LEDGER REPLAY\`: 日本語の台帳 replay テキスト。
- \`JA LEDGER HEAL\`: 日本語の台帳 heal テキスト。
- \`generate → replay\` (\`日本語の台帳エッジ\`)
`,
  'zh-cn': `## Cycle {#generate-run-heal-cycle}
**无障碍替代文本**：中文循环替代文本
- \`ZH CYCLE PROMPT\`：中文循环 prompt 文本。
- \`ZH CYCLE GENERATE\`：中文循环 generate 文本。
- \`ZH CYCLE ARTIFACTS\`：中文循环 artifacts 文本。
- \`ZH CYCLE RUN\`：中文循环 run 文本。
- \`ZH CYCLE REPLAY\`：中文循环 replay 文本。
- \`ZH CYCLE HEAL\`：中文循环 heal 文本。
- \`prompt → generate\` (\`中文循环边\`)

## Files {#three-files}
**无障碍替代文本**：中文文件替代文本
- \`ZH FILES PROMPT\`：中文文件 prompt 文本。
- \`ZH FILES PLAN\`：中文文件 plan 文本。
- \`ZH FILES GROUNDING\`：中文文件 grounding 文本。
- \`prompt-file ↔ plan-file\` (\`中文文件边\`)

## Ledger {#ai-call-ledger}
**无障碍替代文本**：中文台账替代文本
- \`ZH LEDGER GENERATE\`：中文台账 generate 文本。
- \`ZH LEDGER REPLAY\`：中文台账 replay 文本。
- \`ZH LEDGER HEAL\`：中文台账 heal 文本。
- \`generate → replay\` (\`中文台账边\`)
`,
};

const expectedFigures = {
  en: {
    cycle: {
      caption: null,
      alt: 'English cycle alternative',
      nodes: [
        { id: 'prompt', label: 'EN CYCLE PROMPT', text: 'English cycle prompt text.' },
        { id: 'generate', label: 'EN CYCLE GENERATE', text: 'English cycle generate text.' },
        { id: 'artifacts', label: 'EN CYCLE ARTIFACTS', text: 'English cycle artifacts text.' },
        { id: 'run', label: 'EN CYCLE RUN', text: 'English cycle run text.' },
        { id: 'replay', label: 'EN CYCLE REPLAY', text: 'English cycle replay text.' },
        { id: 'heal', label: 'EN CYCLE HEAL', text: 'English cycle heal text.' },
      ],
      edges: [{ from: 'prompt', to: 'generate', label: 'English cycle edge', direction: 'forward' }],
    },
    files: {
      caption: null,
      alt: 'English files alternative',
      nodes: [
        { id: 'prompt-file', label: 'EN FILES PROMPT', text: 'English files prompt text.' },
        { id: 'plan-file', label: 'EN FILES PLAN', text: 'English files plan text.' },
        { id: 'grounding-file', label: 'EN FILES GROUNDING', text: 'English files grounding text.' },
      ],
      edges: [{ from: 'prompt-file', to: 'plan-file', label: 'English files edge', direction: 'forward' }],
    },
    ledger: {
      caption: null,
      alt: 'English ledger alternative',
      nodes: [
        { id: 'generate', label: 'EN LEDGER GENERATE', text: 'English ledger generate text.' },
        { id: 'replay', label: 'EN LEDGER REPLAY', text: 'English ledger replay text.' },
        { id: 'heal', label: 'EN LEDGER HEAL', text: 'English ledger heal text.' },
      ],
      edges: [{ from: 'generate', to: 'replay', label: 'English ledger edge', direction: 'forward' }],
    },
  },
  ja: {
    cycle: {
      caption: '日本語のサイクルキャプション',
      alt: '日本語のサイクル代替テキスト',
      nodes: [
        { id: 'prompt', label: 'JA CYCLE PROMPT', text: '日本語のサイクル prompt テキスト。' },
        { id: 'generate', label: 'JA CYCLE GENERATE', text: '日本語のサイクル generate テキスト。' },
        { id: 'artifacts', label: 'JA CYCLE ARTIFACTS', text: '日本語のサイクル artifacts テキスト。' },
        { id: 'run', label: 'JA CYCLE RUN', text: '日本語のサイクル run テキスト。' },
        { id: 'replay', label: 'JA CYCLE REPLAY', text: '日本語のサイクル replay テキスト。' },
        { id: 'heal', label: 'JA CYCLE HEAL', text: '日本語のサイクル heal テキスト。' },
      ],
      edges: [{ from: 'prompt', to: 'generate', label: '日本語のサイクルエッジ', direction: 'forward' }],
    },
    files: {
      caption: '日本語のファイルキャプション',
      alt: '日本語のファイル代替テキスト',
      nodes: [
        { id: 'prompt-file', label: 'JA FILES PROMPT', text: '日本語のファイル prompt テキスト。' },
        { id: 'plan-file', label: 'JA FILES PLAN', text: '日本語のファイル plan テキスト。' },
        { id: 'grounding-file', label: 'JA FILES GROUNDING', text: '日本語のファイル grounding テキスト。' },
      ],
      edges: [{ from: 'prompt-file', to: 'plan-file', label: '日本語のファイルエッジ', direction: 'forward' }],
    },
    ledger: {
      caption: '日本語の台帳キャプション',
      alt: '日本語の台帳代替テキスト',
      nodes: [
        { id: 'generate', label: 'JA LEDGER GENERATE', text: '日本語の台帳 generate テキスト。' },
        { id: 'replay', label: 'JA LEDGER REPLAY', text: '日本語の台帳 replay テキスト。' },
        { id: 'heal', label: 'JA LEDGER HEAL', text: '日本語の台帳 heal テキスト。' },
      ],
      edges: [{ from: 'generate', to: 'replay', label: '日本語の台帳エッジ', direction: 'forward' }],
    },
  },
  'zh-cn': {
    cycle: {
      caption: null,
      alt: '中文循环替代文本',
      nodes: [
        { id: 'prompt', label: 'ZH CYCLE PROMPT', text: '中文循环 prompt 文本。' },
        { id: 'generate', label: 'ZH CYCLE GENERATE', text: '中文循环 generate 文本。' },
        { id: 'artifacts', label: 'ZH CYCLE ARTIFACTS', text: '中文循环 artifacts 文本。' },
        { id: 'run', label: 'ZH CYCLE RUN', text: '中文循环 run 文本。' },
        { id: 'replay', label: 'ZH CYCLE REPLAY', text: '中文循环 replay 文本。' },
        { id: 'heal', label: 'ZH CYCLE HEAL', text: '中文循环 heal 文本。' },
      ],
      edges: [{ from: 'prompt', to: 'generate', label: '中文循环边', direction: 'forward' }],
    },
    files: {
      caption: null,
      alt: '中文文件替代文本',
      nodes: [
        { id: 'prompt-file', label: 'ZH FILES PROMPT', text: '中文文件 prompt 文本。' },
        { id: 'plan-file', label: 'ZH FILES PLAN', text: '中文文件 plan 文本。' },
        { id: 'grounding-file', label: 'ZH FILES GROUNDING', text: '中文文件 grounding 文本。' },
      ],
      edges: [{ from: 'prompt-file', to: 'plan-file', label: '中文文件边', direction: 'bidirectional' }],
    },
    ledger: {
      caption: null,
      alt: '中文台账替代文本',
      nodes: [
        { id: 'generate', label: 'ZH LEDGER GENERATE', text: '中文台账 generate 文本。' },
        { id: 'replay', label: 'ZH LEDGER REPLAY', text: '中文台账 replay 文本。' },
        { id: 'heal', label: 'ZH LEDGER HEAL', text: '中文台账 heal 文本。' },
      ],
      edges: [{ from: 'generate', to: 'replay', label: '中文台账边', direction: 'forward' }],
    },
  },
};

function createIntroductionFixture(markdown = markdownByLocale, dataFiles: Record<string, string> = {}) {
  const fixture = createDocsFixture({
    'website/src/content/docs/introduction.md': markdown.en,
    'website/src/content/docs/ja/introduction.md': markdown.ja,
    'website/src/content/docs/zh-cn/introduction.md': markdown['zh-cn'],
    ...dataFiles,
  });
  fixtures.push(fixture);
  vi.spyOn(process, 'cwd').mockReturnValue(fixture.website);
  return fixture;
}

describe('migrate-intro-figures entry point', () => {
  it('writes every locale JSON document to the temporary data root after all inputs validate', async () => {
    const fixture = createIntroductionFixture();

    await main();

    for (const locale of locales) {
      expect(fixture.read(`website/src/data/intro/${locale}.json`)).toBe(`${JSON.stringify(expectedFigures[locale], null, 2)}\n`);
    }
  });

  it('leaves every existing locale JSON byte-for-byte unchanged when one localized introduction is malformed', async () => {
    const sentinelData = Object.fromEntries(locales.map((locale) => [
      `website/src/data/intro/${locale}.json`,
      `${JSON.stringify({ sentinel: `before-${locale}` }, null, 2)}\n`,
    ]));
    const fixture = createIntroductionFixture({
      ...markdownByLocale,
      ja: markdownByLocale.ja.replace('{#three-files}', '{#missing-files-anchor}'),
    }, sentinelData);
    const before = new Map(locales.map((locale) => [
      locale,
      fixture.read(`website/src/data/intro/${locale}.json`),
    ]));

    await expect(main()).rejects.toThrow();

    for (const locale of locales) {
      expect(fixture.read(`website/src/data/intro/${locale}.json`)).toBe(before.get(locale));
    }
  });
});
