import { afterEach, describe, expect, it } from 'vitest';
import { createDocsFixture, runEntryPoint } from './cli-fixture.ts';

const fixtures: ReturnType<typeof createDocsFixture>[] = [];
afterEach(() => fixtures.splice(0).forEach((fixture) => fixture.dispose()));

describe('migrate-wikilinks CLI entry point', () => {
  it('uses exact bare absolute URLs only in setup-prompt fences for all locales while preserving ordinary code', () => {
    const setupPrompt = `---\ntitle: Setup\n---\n~~~\nRead [[tutorials/quick-start]] and [[agents/operating-contract]].\n~~~\n`;
    const ordinary = '---\ntitle: Ordinary\n---\nRead [[tutorials/quick-start]].\n```\n[[tutorials/quick-start]]\n```\n`inline [[tutorials/quick-start]]`\n';
    const fixture = createDocsFixture({
      'website/src/content/docs/agents/setup-prompt.md': setupPrompt,
      'website/src/content/docs/ja/agents/setup-prompt.md': setupPrompt,
      'website/src/content/docs/zh-cn/agents/setup-prompt.md': setupPrompt,
      'website/src/content/docs/tutorials/quick-start.md': '---\ntitle: Quick start\n---\n',
      'website/src/content/docs/ja/tutorials/quick-start.md': '---\ntitle: クイックスタート\n---\n',
      'website/src/content/docs/zh-cn/tutorials/quick-start.md': '---\ntitle: 快速开始\n---\n',
      'website/src/content/docs/agents/operating-contract.md': '---\ntitle: Operating contract\n---\n',
      'website/src/content/docs/ja/agents/operating-contract.md': '---\ntitle: 運用契約\n---\n',
      'website/src/content/docs/zh-cn/agents/operating-contract.md': '---\ntitle: 操作约定\n---\n',
      'website/src/content/docs/ordinary.md': ordinary,
      'website/src/content/docs/ja/ordinary.md': ordinary,
      'website/src/content/docs/zh-cn/ordinary.md': ordinary,
    });
    fixtures.push(fixture);

    const result = runEntryPoint(new URL('../scripts/migrate-wikilinks.mjs', import.meta.url), fixture.website);

    expect(result.status).toBe(0);
    expect(fixture.read('website/src/content/docs/agents/setup-prompt.md')).toContain('~~~\nRead https://kotarotsubaki.github.io/ambercast/tutorials/quick-start/ and https://kotarotsubaki.github.io/ambercast/agents/operating-contract/.\n~~~');
    expect(fixture.read('website/src/content/docs/ja/agents/setup-prompt.md')).toContain('~~~\nRead https://kotarotsubaki.github.io/ambercast/ja/tutorials/quick-start/ and https://kotarotsubaki.github.io/ambercast/ja/agents/operating-contract/.\n~~~');
    expect(fixture.read('website/src/content/docs/zh-cn/agents/setup-prompt.md')).toContain('~~~\nRead https://kotarotsubaki.github.io/ambercast/zh-cn/tutorials/quick-start/ and https://kotarotsubaki.github.io/ambercast/zh-cn/agents/operating-contract/.\n~~~');
    for (const locale of ['', 'ja/', 'zh-cn/']) {
      const output = fixture.read(`website/src/content/docs/${locale}ordinary.md`);
      expect(output).toContain('```\n[[tutorials/quick-start]]\n```');
      expect(output).toContain('`inline [[tutorials/quick-start]]`');
      expect(output).toContain(locale ? `/ambercast/${locale}tutorials/quick-start/)` : '/ambercast/tutorials/quick-start/)');
    }
  });

  it('reports every invalid link and leaves every candidate page unchanged on failure', () => {
    const fixture = createDocsFixture({
      'website/src/content/docs/ordinary.md': '---\ntitle: Ordinary\n---\n[[missing-one]] and [[missing-two#part]].\n',
      'website/src/content/docs/also-broken.md': '---\ntitle: Broken\n---\n[[Not a target]].\n',
    });
    fixtures.push(fixture);
    const before = [fixture.read('website/src/content/docs/ordinary.md'), fixture.read('website/src/content/docs/also-broken.md')];

    const result = runEntryPoint(new URL('../scripts/migrate-wikilinks.mjs', import.meta.url), fixture.website);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr.trimEnd().split('\n').sort()).toEqual([
      'also-broken.md: malformed wikilink "[[Not a target]]"',
      'ordinary.md: unresolved wikilink "missing-one"',
      'ordinary.md: unresolved wikilink "missing-two#part"',
    ]);
    expect([fixture.read('website/src/content/docs/ordinary.md'), fixture.read('website/src/content/docs/also-broken.md')]).toEqual(before);
  });
});
