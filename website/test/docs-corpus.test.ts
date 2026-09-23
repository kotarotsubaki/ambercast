import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { checkClaims } from '../scripts/check-claims.mjs';
import { claimHash, listDocsCorpus, maskForClaims, normalizeClaimLine } from '../scripts/lib/docs-corpus.mjs';
import { createDocsFixture } from './cli-fixture.ts';

const fixtures: ReturnType<typeof createDocsFixture>[] = [];
afterEach(() => fixtures.splice(0).forEach((fixture) => fixture.dispose()));

describe('documentation corpus', () => {
  it('separates source and golden and classifies all locale-specific roots', async () => {
    const fixture = createDocsFixture({
      'README.md': '# en', 'README-ja.md': '# ja', 'README-zh-CN.md': '# zh',
      'AGENTS.md': '# en', 'CONTRIBUTING.md': '# en', 'skills/ambercast/SKILL.md': '# en',
      'docs/spec/protocol.md': '# en',
      'website/src/content/docs/page.md': '# en',
      'website/src/content/docs/ja/page.md': '# ja',
      'website/src/content/docs/zh-cn/page.mdx': '# zh',
      'website/src/content/docs/spec/generated.md': '# excluded',
      'website/src/content/docs/ja/spec/local.md': '# source',
      'website/src/content/docs/zh-cn/spec/local.md': '# source',
      'website/test/fixtures/llms/llms.txt': 'en',
      'website/test/fixtures/llms/ja-llms.txt': 'ja',
      'website/test/fixtures/llms/zh-cn-llms.txt': 'zh',
    });
    fixtures.push(fixture);
    const corpus = await listDocsCorpus({ repoRoot: fixture.root });
    const byPath = new Map(corpus.map((entry) => [entry.path, entry]));
    for (const [path, locale] of Object.entries({ 'README.md': 'en', 'README-ja.md': 'ja', 'README-zh-CN.md': 'zh-cn', 'website/src/content/docs/ja/page.md': 'ja', 'website/src/content/docs/zh-cn/page.mdx': 'zh-cn', 'website/src/content/docs/ja/spec/local.md': 'ja', 'website/src/content/docs/zh-cn/spec/local.md': 'zh-cn' })) {
      expect(byPath.get(path)).toEqual({ path, locale, role: 'source' });
    }
    expect(byPath.has('website/src/content/docs/spec/generated.md')).toBe(false);
    expect(byPath.get('docs/spec/protocol.md')?.role).toBe('source');
    expect(corpus.filter((entry) => entry.role === 'golden')).toHaveLength(3);
    expect(byPath.get('website/test/fixtures/llms/llms.txt')).toEqual({ path: 'website/test/fixtures/llms/llms.txt', role: 'golden', locale: 'en' });
    expect(byPath.get('website/test/fixtures/llms/ja-llms.txt')).toEqual({ path: 'website/test/fixtures/llms/ja-llms.txt', role: 'golden', locale: 'ja' });
    expect(byPath.get('website/test/fixtures/llms/zh-cn-llms.txt')).toEqual({ path: 'website/test/fixtures/llms/zh-cn-llms.txt', role: 'golden', locale: 'zh-cn' });
  });

  it('reports corpus-empty when only a golden exists', async () => {
    const fixture = createDocsFixture({
      'website/test/fixtures/llms/llms.txt': 'published',
      'website/public/capabilities.json': JSON.stringify({ commands: [], planned: [] }),
      'website/docs-audit-allowlist.json': '[]',
    });
    fixtures.push(fixture);
    expect((await checkClaims({ repoRoot: fixture.root })).map((violation) => violation.rule)).toContain('corpus-empty');
  });
});

describe('claim normalization', () => {
  it('blanks fenced regions and multiline comments while preserving line numbers and inline code', () => {
    const source = '`init`<!-- comment\nsecond line -->text\n```text\n`heal` only\n```\n`run`';
    const masked = maskForClaims(source);
    expect(masked.split('\n')).toHaveLength(source.split('\n').length);
    expect(masked).toContain('`init`');
    expect(masked).toContain('`run`');
    expect(masked).not.toContain('comment');
    expect(masked).not.toContain('`heal`');
    expect(masked).toContain('`init`');
    expect(masked).toContain('text');
  });

  it('collapses whitespace without changing case, then hashes UTF-8 bytes', () => {
    const normalized = normalizeClaimLine('  Only\t`init`   exists  ');
    expect(normalized).toBe('Only `init` exists');
    expect(claimHash(normalized)).toBe(createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 16));
    expect(claimHash(normalized)).toMatch(/^[0-9a-f]{16}$/);
  });
});
