import { afterEach, describe, expect, it } from 'vitest';
import { createDocsFixture, runEntryPoint } from './cli-fixture.ts';

const fixtures: ReturnType<typeof createDocsFixture>[] = [];
afterEach(() => fixtures.splice(0).forEach((fixture) => fixture.dispose()));

describe('migrate-spec-translations CLI entry point', () => {
  it('transforms valid Japanese and Simplified Chinese chapters without diagnostics', () => {
    const fixture = createDocsFixture({
      'package.json': '{"version":"0.3.1"}\n',
      'website/src/content/docs/ja/spec/overview.md': '# 概要\n\n最初の説明です。続きます。\n',
      'website/src/content/docs/zh-cn/spec/overview.md': '# 概览\n\n这是首段说明。后续内容。\n',
      'website/src/content/docs/ja/spec/changelog.md': '# 仕様変更履歴\n\n誤った最初の段落です。\n\n## 互換性ポリシー {#compatibility-policy}\n\n互換性はここからです。続きます。\n',
      'website/src/content/docs/zh-cn/spec/changelog.md': '# 规范变更日志\n\n错误的首段说明。\n\n## 兼容性策略 {#compatibility-policy}\n\n兼容性从这里开始。后续内容。\n',
    });
    fixtures.push(fixture);

    const result = runEntryPoint(new URL('../scripts/migrate-spec-translations.mjs', import.meta.url), fixture.website);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    expect(fixture.read('website/src/content/docs/ja/spec/overview.md')).toContain('title: "概要"');
    expect(fixture.read('website/src/content/docs/ja/spec/overview.md')).toContain('description: "最初の説明です。"');
    expect(fixture.read('website/src/content/docs/zh-cn/spec/overview.md')).toContain('title: "概览"');
    expect(fixture.read('website/src/content/docs/zh-cn/spec/overview.md')).toContain('description: "这是首段说明。"');
    expect(fixture.read('website/src/content/docs/ja/spec/changelog.md')).toContain('description: "互換性はここからです。"');
    expect(fixture.read('website/src/content/docs/zh-cn/spec/changelog.md')).toContain('description: "兼容性从这里开始。"');
  });

  it('reports all locale/chapter diagnostics and makes no partial in-place translation writes', () => {
    const fixture = createDocsFixture({
      'package.json': '{"version":"0.3.1"}\n',
      'website/src/content/docs/ja/spec/overview.md': '# 概要\n\n[[missing-ja]]\n',
      'website/src/content/docs/zh-cn/spec/overview.md': '# 概览\n\n[[missing-zh]]\n',
    });
    fixtures.push(fixture);
    const before = [fixture.read('website/src/content/docs/ja/spec/overview.md'), fixture.read('website/src/content/docs/zh-cn/spec/overview.md')];

    const result = runEntryPoint(new URL('../scripts/migrate-spec-translations.mjs', import.meta.url), fixture.website);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr.trimEnd().split('\n').sort()).toEqual([
      'ja/spec/overview.md: unresolved wikilink "missing-ja"',
      'zh-cn/spec/overview.md: unresolved wikilink "missing-zh"',
    ]);
    expect([fixture.read('website/src/content/docs/ja/spec/overview.md'), fixture.read('website/src/content/docs/zh-cn/spec/overview.md')]).toEqual(before);
  });
});
