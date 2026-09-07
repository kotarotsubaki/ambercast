import { afterEach, describe, expect, it } from 'vitest';
import { checkParity } from '../scripts/check-parity.mjs';
import { createDocsFixture, runEntryPoint } from './cli-fixture.ts';

const fixtures: ReturnType<typeof createDocsFixture>[] = [];
afterEach(() => fixtures.splice(0).forEach((fixture) => fixture.dispose()));

const page = (body: string, frontmatter = 'status: available') => `---\n${frontmatter}\n---\n\n${body}\n`;
const tree = (en: string, ja = en, zh = en) => ({
  'website/src/content/docs/guide.md': en,
  'website/src/content/docs/ja/guide.md': ja,
  'website/src/content/docs/zh-cn/guide.md': zh,
});
const parity = async (files: Record<string, string>) => {
  const fixture = createDocsFixture(files);
  fixtures.push(fixture);
  return checkParity({ docsRoot: `${fixture.website}/src/content/docs`, specRoot: `${fixture.root}/docs/spec` });
};

describe('checkParity', () => {
  it('returns a sorted, structured violation for each independently broken invariant', async () => {
    const violations = await parity({
      ...tree(page('## First {#first}\n\n```txt\none\n```\n\n| Name | Meaning |\n| --- | --- |\n| `E_ONE` | one |'), page('## Second {#second}\n\n```txt\ntwo\n```\n\n| Name | Meaning |\n| --- | --- |\n| `E_TWO` | two |', 'status: planned\nsidebar:\n  badge: Planned')),
      'website/src/content/docs/zh-cn/other.mdx': page('# Extra'),
      'website/src/content/docs/root-only.md': page('# Root only'),
      'website/src/content/docs/ja/reference/exit-codes.md': page('## Exit-code table {#exit-code-table}\n\n| Code | Meaning |\n| --- | --- |\n| EXIT_ONE | one |'),
      'website/src/content/docs/reference/exit-codes.mdx': page('## Exit-code table {#exit-code-table}\n\n| Code | Meaning |\n| --- | --- |\n| EXIT_TWO | two |'),
      'website/src/content/docs/zh-cn/reference/exit-codes.md': page('## Exit-code table {#exit-code-table}\n\n| Code | Meaning |\n| --- | --- |\n| EXIT_TWO | two |'),
      'docs/spec/overview.md': '## Root {#root}\n\n```txt\nroot\n```\n\n| A | B |\n| --- | --- |\n| one | two |\n',
      'website/src/content/docs/ja/spec/overview.md': '## Local {#local}\n\n```txt\nlocal\n```\n\n| A | B |\n| --- | --- |\n| one | two |\n| three | four |\n',
      'website/src/content/docs/zh-cn/spec/overview.md': '## Root {#root}\n\n```txt\nroot\n```\n\n| A | B |\n| --- | --- |\n| one | two |\n',
    });

    expect(violations).toEqual([
      { locale: 'ja', page: 'guide', rule: 'anchor-order', expected: 'first', actual: 'second' },
      { locale: 'ja', page: 'guide', rule: 'fence-content', expected: 'one', actual: 'two' },
      { locale: 'ja', page: 'guide', rule: 'frontmatter', expected: '{"status":"available","sidebar.badge":undefined}', actual: '{"status":"planned","sidebar.badge":"Planned"}' },
      { locale: 'zh-cn', page: 'other', rule: 'page-set', expected: 'absent', actual: 'present' },
      { locale: 'ja', page: 'root-only', rule: 'page-set', expected: 'present', actual: 'absent' },
      { locale: 'zh-cn', page: 'root-only', rule: 'page-set', expected: 'present', actual: 'absent' },
      { locale: 'ja', page: 'spec/overview', rule: 'spec-anchors', expected: 'root', actual: 'local' },
      { locale: 'ja', page: 'spec/overview', rule: 'spec-code-blocks', expected: 'root', actual: 'local' },
      { locale: 'ja', page: 'spec/overview', rule: 'spec-table-rows', expected: '1', actual: '2' },
      { locale: 'ja', page: 'reference/exit-codes', rule: 'table-identifiers', expected: 'EXIT_TWO', actual: 'EXIT_ONE' },
    ]);
  });

  it('treats md and mdx as one page, accepts setup-prompt URL differences, and accepts a fully matching tree', async () => {
    const same = page('## Same {#same}\n\n```txt\nhttps://example.test/ambercast/guide/\nshared token\n```\n\n| Code | Meaning |\n| --- | --- |\n| `E_ONE` | one |');
    const violations = await parity({
      'website/src/content/docs/guide.mdx': same,
      'website/src/content/docs/ja/guide.md': same,
      'website/src/content/docs/zh-cn/guide.mdx': same,
      'website/src/content/docs/agents/setup-prompt.md': page('```txt\nhttps://example.test/ambercast/guide/\nshared token\n```'),
      'website/src/content/docs/ja/agents/setup-prompt.md': page('```txt\nhttps://example.test/ambercast/ja/guide/\nshared token\n```'),
      'website/src/content/docs/zh-cn/agents/setup-prompt.md': page('```txt\nhttps://example.test/ambercast/zh-cn/guide/\nshared token\n```'),
      'website/src/content/docs/reference/error-codes.md': page('## Code vocabulary {#code-vocabulary}\n\n| Code | Meaning |\n| --- | --- |\n| EXIT_ONE | one |'),
      'website/src/content/docs/ja/reference/error-codes.md': page('## Code vocabulary {#code-vocabulary}\n\n| Code | Meaning |\n| --- | --- |\n| EXIT_ONE | one |'),
      'website/src/content/docs/zh-cn/reference/error-codes.md': page('## Code vocabulary {#code-vocabulary}\n\n| Code | Meaning |\n| --- | --- |\n| EXIT_ONE | one |'),
      'docs/spec/overview.md': '## Same {#same}\n\n```txt\nshared\n```\n\n| A | B |\n| --- | --- |\n| one | two |\n',
      'website/src/content/docs/ja/spec/overview.md': '## Same {#same}\n\n```txt\nshared\n```\n\n| A | B |\n| --- | --- |\n| one | two |\n',
      'website/src/content/docs/zh-cn/spec/overview.md': '## Same {#same}\n\n```txt\nshared\n```\n\n| A | B |\n| --- | --- |\n| one | two |\n',
    });
    expect(violations).toEqual([]);

    const fenceOrderFixture = await parity(tree(
      page('```txt\nfirst\n```\n\n```txt\nsecond\n```'),
      page('```txt\nsecond\n```\n\n```txt\nfirst\n```'),
    ));
    expect(fenceOrderFixture).toEqual([
      { locale: 'ja', page: 'guide', rule: 'fence-content', expected: 'first\nsecond', actual: 'second\nfirst' },
    ]);
  });

  it('detects every inline-code identifier in ordinary reference tables', async () => {
    const identifiers = page('| Option | Meaning |\n| --- | --- |\n| `--yes`, `-y` | Accept |');
    const violations = await parity({
      ...tree(page('# Guide')),
      'website/src/content/docs/reference/options.md': identifiers,
      'website/src/content/docs/ja/reference/options.md': page('| Option | Meaning |\n| --- | --- |\n| `--yes`, `-n` | Accept |'),
      'website/src/content/docs/zh-cn/reference/options.md': identifiers,
    });

    expect(violations).toEqual([
      { locale: 'ja', page: 'reference/options', rule: 'table-identifiers', expected: '--yes\n-y', actual: '--yes\n-n' },
    ]);
  });

  it('detects independent fence, setup prompt, and frontmatter invariants', async () => {
    const violations = await parity({
      ...tree(
        page('```txt\nshared\n```', 'status: available\nsidebar:\n  badge: Stable'),
        page('```txt\nshared\n```\n\n```txt\nextra\n```', 'status: planned\nsidebar:\n  badge: Stable'),
        page('```txt\nshared\n```', 'status: available\nsidebar:\n  badge: Beta'),
      ),
      'website/src/content/docs/agents/setup-prompt.md': page('```txt\nkeep https://example.test/root\nline two\n```'),
      'website/src/content/docs/ja/agents/setup-prompt.md': page('```txt\nkeep https://example.test/ja\n```'),
      'website/src/content/docs/zh-cn/agents/setup-prompt.md': page('```txt\nchanged https://example.test/zh\nline two\n```'),
    });

    expect(violations).toEqual([
      { locale: 'ja', page: 'agents/setup-prompt', rule: 'fence-content', expected: 'keep https://example.test/root\nline two', actual: 'keep https://example.test/ja' },
      { locale: 'zh-cn', page: 'agents/setup-prompt', rule: 'fence-content', expected: 'keep https://example.test/root\nline two', actual: 'changed https://example.test/zh\nline two' },
      { locale: 'ja', page: 'guide', rule: 'fence-content', expected: 'shared', actual: 'shared\nextra' },
      { locale: 'ja', page: 'guide', rule: 'frontmatter', expected: '{"status":"available","sidebar.badge":"Stable"}', actual: '{"status":"planned","sidebar.badge":"Stable"}' },
      { locale: 'zh-cn', page: 'guide', rule: 'frontmatter', expected: '{"status":"available","sidebar.badge":"Stable"}', actual: '{"status":"available","sidebar.badge":"Beta"}' },
    ]);
  });

  it('compares fence boundaries and spec table counts at their individual positions', async () => {
    const spec = '| A | B |\n| --- | --- |\n| one | two |\n\n| C | D |\n| --- | --- |\n| three | four |\n';
    const violations = await parity({
      ...tree(
        page('```txt\na\n```\n\n```txt\nb\n```'),
        page('```txt\na\nb\n```'),
      ),
      'docs/spec/overview.md': spec,
      'website/src/content/docs/ja/spec/overview.md': '| A | B |\n| --- | --- |\n| one | two |\n| extra | row |\n\n| C | D |\n| --- | --- |\n',
      'website/src/content/docs/zh-cn/spec/overview.md': spec,
      'website/src/content/docs/zh-cn/spec/extra.md': '## Extra {#extra}\n',
    });

    expect(violations).toEqual([
      { locale: 'ja', page: 'guide', rule: 'fence-content', expected: '["a","b"]', actual: '["a\\nb"]' },
      { locale: 'zh-cn', page: 'spec/extra', rule: 'page-set', expected: 'absent', actual: 'present' },
      { locale: 'ja', page: 'spec/overview', rule: 'spec-table-rows', expected: '1\n1', actual: '2\n0' },
    ]);
  });
});

describe('check-parity CLI entry point', () => {
  it('exits successfully without output for a fully matching tree', () => {
    const matchingPage = page('## Same {#same}\n\n```txt\nshared\n```\n\n| Code | Meaning |\n| --- | --- |\n| `E_ONE` | one |');
    const matchingSpec = '## Same {#same}\n\n```txt\nshared\n```\n\n| A | B |\n| --- | --- |\n| one | two |\n';
    const fixture = createDocsFixture({
      ...tree(matchingPage),
      'docs/spec/overview.md': matchingSpec,
      'website/src/content/docs/ja/spec/overview.md': matchingSpec,
      'website/src/content/docs/zh-cn/spec/overview.md': matchingSpec,
    });
    fixtures.push(fixture);

    const result = runEntryPoint(new URL('../scripts/check-parity.mjs', import.meta.url), fixture.website);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  it('prints every violation, exits non-zero, and does not modify its failing input tree', () => {
    const fixture = createDocsFixture({
      ...tree(page('## First {#first}'), page('## Second {#second}')),
      'website/src/content/docs/zh-cn/extra.md': page('# Extra'),
    });
    fixtures.push(fixture);
    const before = fixture.read('website/src/content/docs/ja/guide.md');
    const result = runEntryPoint(new URL('../scripts/check-parity.mjs', import.meta.url), fixture.website);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))).toEqual([
      { locale: 'ja', page: 'guide', rule: 'anchor-order', expected: 'first', actual: 'second' },
      { locale: 'zh-cn', page: 'extra', rule: 'page-set', expected: 'absent', actual: 'present' },
    ]);
    expect(fixture.read('website/src/content/docs/ja/guide.md')).toBe(before);
  });
});
