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
const figureData = {
  cycle: {
    caption: null,
    alt: 'A cycle from start to end.',
    nodes: [
      { id: 'cycle-start', label: 'START', text: 'Start the cycle.' },
      { id: 'cycle-end', label: 'END', text: 'End the cycle.' },
      { id: 'cycle-note', label: 'NOTE', text: 'An unconnected note.' },
    ],
    edges: [{ from: 'cycle-start', to: 'cycle-end', label: 'continue', direction: 'forward' }],
  },
};
const figureTree = (en: unknown = figureData, ja: unknown = en, zh: unknown = en): Record<string, string> => ({
  'website/src/data/how-it-works/en.json': `${JSON.stringify(en)}\n`,
  'website/src/data/how-it-works/ja.json': `${JSON.stringify(ja)}\n`,
  'website/src/data/how-it-works/zh-cn.json': `${JSON.stringify(zh)}\n`,
});
const parity = async (files: Record<string, string>, dataFiles = figureTree()) => {
  const fixture = createDocsFixture({ ...dataFiles, ...files });
  fixtures.push(fixture);
  return checkParity({
    docsRoot: `${fixture.website}/src/content/docs`,
    specRoot: `${fixture.root}/docs/spec`,
    dataRoot: `${fixture.website}/src/data/how-it-works`,
  });
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

  it('accepts matching figure JSON structures and null-or-string captions via dataRoot', async () => {
    const ja = {
      ...figureData,
      cycle: { ...figureData.cycle, caption: 'A localized caption.' },
    };

    expect(await parity(tree(page('# Guide')), figureTree(figureData, ja))).toEqual([]);
  });

  it('accepts a single-node, single-edge figure', async () => {
    const single = {
      cycle: {
        caption: null,
        alt: 'A self-looping cycle.',
        nodes: [{ id: 'only', label: 'ONLY', text: 'The only node.' }],
        edges: [{ from: 'only', to: 'only', label: 'again', direction: 'forward' }],
      },
    };

    expect(await parity(tree(page('# Guide')), figureTree(single))).toEqual([]);
  });

  it('reports a locale missing a figure node id', async () => {
    const ja = {
      ...figureData,
      cycle: { ...figureData.cycle, nodes: figureData.cycle.nodes.slice(0, 2) },
    };

    expect(await parity(tree(page('# Guide')), figureTree(figureData, ja))).toEqual([
      expect.objectContaining({ locale: 'ja', page: 'data/how-it-works/cycle', rule: 'figure-json-nodes' }),
    ]);
  });

  it('reports a locale with an extra figure node id', async () => {
    const ja = {
      ...figureData,
      cycle: {
        ...figureData.cycle,
        nodes: [
          ...figureData.cycle.nodes,
          { id: 'cycle-extra', label: 'EXTRA', text: 'An extra node.' },
        ],
      },
    };

    expect(await parity(tree(page('# Guide')), figureTree(figureData, ja))).toEqual([
      expect.objectContaining({ locale: 'ja', page: 'data/how-it-works/cycle', rule: 'figure-json-nodes' }),
    ]);
  });

  it('reports a locale with an extra figure edge triple', async () => {
    const zh = {
      ...figureData,
      cycle: {
        ...figureData.cycle,
        edges: [
          ...figureData.cycle.edges,
          { from: 'cycle-end', to: 'cycle-start', label: 'return', direction: 'forward' },
        ],
      },
    };

    expect(await parity(tree(page('# Guide')), figureTree(figureData, figureData, zh))).toEqual([
      expect.objectContaining({ locale: 'zh-cn', page: 'data/how-it-works/cycle', rule: 'figure-json-edges' }),
    ]);
  });

  it('reports an empty figure alt as a shape violation', async () => {
    const ja = {
      ...figureData,
      cycle: { ...figureData.cycle, alt: '' },
    };

    expect(await parity(tree(page('# Guide')), figureTree(figureData, ja))).toEqual([
      expect.objectContaining({ locale: 'ja', page: 'data/how-it-works/ja', rule: 'figure-json-shape' }),
    ]);
  });

  it('reports a non-string figure alt as a shape violation', async () => {
    const ja = {
      ...figureData,
      cycle: { ...figureData.cycle, alt: 42 },
    };

    expect(await parity(tree(page('# Guide')), figureTree(figureData, ja))).toEqual([
      expect.objectContaining({ locale: 'ja', page: 'data/how-it-works/ja', rule: 'figure-json-shape' }),
    ]);
  });

  it('reports a non-string, non-null caption as a shape violation', async () => {
    const ja = {
      ...figureData,
      cycle: { ...figureData.cycle, caption: 42 },
    };

    expect(await parity(tree(page('# Guide')), figureTree(figureData, ja))).toEqual([
      expect.objectContaining({ locale: 'ja', page: 'data/how-it-works/ja', rule: 'figure-json-shape' }),
    ]);
  });

  it.each([
    ['a missing figure caption', () => ({
      ...figureData,
      cycle: {
        alt: figureData.cycle.alt,
        nodes: figureData.cycle.nodes,
        edges: figureData.cycle.edges,
      },
    })],
    ['a missing figure alt', () => ({
      ...figureData,
      cycle: {
        caption: figureData.cycle.caption,
        nodes: figureData.cycle.nodes,
        edges: figureData.cycle.edges,
      },
    })],
    ['a node missing its id', () => ({
      ...figureData,
      cycle: {
        ...figureData.cycle,
        nodes: [{ label: 'START', text: 'Start the cycle.' }, ...figureData.cycle.nodes.slice(1)],
      },
    })],
    ['a non-string node id', () => ({
      ...figureData,
      cycle: {
        ...figureData.cycle,
        nodes: [{ ...figureData.cycle.nodes[0], id: 42 }, ...figureData.cycle.nodes.slice(1)],
      },
    })],
    ['a node missing its label', () => ({
      ...figureData,
      cycle: {
        ...figureData.cycle,
        nodes: [{ id: 'cycle-start', text: 'Start the cycle.' }, ...figureData.cycle.nodes.slice(1)],
      },
    })],
    ['a non-string node label', () => ({
      ...figureData,
      cycle: {
        ...figureData.cycle,
        nodes: [{ ...figureData.cycle.nodes[0], label: 42 }, ...figureData.cycle.nodes.slice(1)],
      },
    })],
    ['an edge missing its from endpoint', () => ({
      ...figureData,
      cycle: {
        ...figureData.cycle,
        edges: [{ to: 'cycle-end', label: 'continue', direction: 'forward' }],
      },
    })],
    ['a non-string edge from endpoint', () => ({
      ...figureData,
      cycle: {
        ...figureData.cycle,
        edges: [{ ...figureData.cycle.edges[0], from: 42 }],
      },
    })],
    ['an edge missing its to endpoint', () => ({
      ...figureData,
      cycle: {
        ...figureData.cycle,
        edges: [{ from: 'cycle-start', label: 'continue', direction: 'forward' }],
      },
    })],
    ['a non-string edge to endpoint', () => ({
      ...figureData,
      cycle: {
        ...figureData.cycle,
        edges: [{ ...figureData.cycle.edges[0], to: 42 }],
      },
    })],
    ['an edge missing its direction', () => ({
      ...figureData,
      cycle: {
        ...figureData.cycle,
        edges: [{ from: 'cycle-start', to: 'cycle-end', label: 'continue' }],
      },
    })],
    ['a non-string edge direction', () => ({
      ...figureData,
      cycle: {
        ...figureData.cycle,
        edges: [{ ...figureData.cycle.edges[0], direction: 42 }],
      },
    })],
  ])('reports %s as exactly one shape violation', async (_description, createInvalidJa) => {
    expect(await parity(tree(page('# Guide')), figureTree(figureData, createInvalidJa()))).toEqual([
      expect.objectContaining({ locale: 'ja', page: 'data/how-it-works/ja', rule: 'figure-json-shape' }),
    ]);
  });

  it('reports a non-object figure value as a shape violation', async () => {
    const ja = { cycle: null };

    expect(await parity(tree(page('# Guide')), figureTree(figureData, ja))).toEqual([
      expect.objectContaining({ locale: 'ja', page: 'data/how-it-works/ja', rule: 'figure-json-shape' }),
    ]);
  });

  it('reports a non-object top-level value as a shape violation', async () => {
    const ja = [figureData.cycle];

    expect(await parity(tree(page('# Guide')), figureTree(figureData, ja))).toEqual([
      expect.objectContaining({ locale: 'ja', page: 'data/how-it-works/ja', rule: 'figure-json-shape' }),
    ]);
  });

  it('reports a non-array nodes field as a shape violation', async () => {
    const ja = {
      ...figureData,
      cycle: { ...figureData.cycle, nodes: 'not an array' },
    };

    expect(await parity(tree(page('# Guide')), figureTree(figureData, ja))).toEqual([
      expect.objectContaining({ locale: 'ja', page: 'data/how-it-works/ja', rule: 'figure-json-shape' }),
    ]);
  });

  it('reports a node missing a required field as a shape violation', async () => {
    const ja = {
      ...figureData,
      cycle: {
        ...figureData.cycle,
        nodes: [
          { id: 'cycle-start', label: 'START' },
          ...figureData.cycle.nodes.slice(1),
        ],
      },
    };

    expect(await parity(tree(page('# Guide')), figureTree(figureData, ja))).toEqual([
      expect.objectContaining({ locale: 'ja', page: 'data/how-it-works/ja', rule: 'figure-json-shape' }),
    ]);
  });

  it('reports a non-string node field as a shape violation', async () => {
    const ja = {
      ...figureData,
      cycle: {
        ...figureData.cycle,
        nodes: [
          { ...figureData.cycle.nodes[0], text: 42 },
          ...figureData.cycle.nodes.slice(1),
        ],
      },
    };

    expect(await parity(tree(page('# Guide')), figureTree(figureData, ja))).toEqual([
      expect.objectContaining({ locale: 'ja', page: 'data/how-it-works/ja', rule: 'figure-json-shape' }),
    ]);
  });

  it('reports a duplicate node id as a shape violation', async () => {
    const ja = {
      ...figureData,
      cycle: {
        ...figureData.cycle,
        nodes: [...figureData.cycle.nodes, { ...figureData.cycle.nodes[0] }],
      },
    };

    expect(await parity(tree(page('# Guide')), figureTree(figureData, ja))).toEqual([
      expect.objectContaining({ locale: 'ja', page: 'data/how-it-works/ja', rule: 'figure-json-shape' }),
    ]);
  });

  it('reports a non-array edges field as a shape violation', async () => {
    const ja = {
      ...figureData,
      cycle: { ...figureData.cycle, edges: 'not an array' },
    };

    expect(await parity(tree(page('# Guide')), figureTree(figureData, ja))).toEqual([
      expect.objectContaining({ locale: 'ja', page: 'data/how-it-works/ja', rule: 'figure-json-shape' }),
    ]);
  });

  it('reports an edge missing a required field as a shape violation', async () => {
    const ja = {
      ...figureData,
      cycle: {
        ...figureData.cycle,
        edges: [{ from: 'cycle-start', to: 'cycle-end', direction: 'forward' }],
      },
    };

    expect(await parity(tree(page('# Guide')), figureTree(figureData, ja))).toEqual([
      expect.objectContaining({ locale: 'ja', page: 'data/how-it-works/ja', rule: 'figure-json-shape' }),
    ]);
  });

  it('reports a non-string edge field as a shape violation', async () => {
    const ja = {
      ...figureData,
      cycle: {
        ...figureData.cycle,
        edges: [{ ...figureData.cycle.edges[0], label: 42 }],
      },
    };

    expect(await parity(tree(page('# Guide')), figureTree(figureData, ja))).toEqual([
      expect.objectContaining({ locale: 'ja', page: 'data/how-it-works/ja', rule: 'figure-json-shape' }),
    ]);
  });

  it('reports an edge with a dangling from id as a shape violation', async () => {
    const ja = {
      ...figureData,
      cycle: {
        ...figureData.cycle,
        edges: [{ ...figureData.cycle.edges[0], from: 'missing-node' }],
      },
    };

    expect(await parity(tree(page('# Guide')), figureTree(figureData, ja))).toEqual([
      expect.objectContaining({ locale: 'ja', page: 'data/how-it-works/ja', rule: 'figure-json-shape' }),
    ]);
  });

  it('reports an edge with a dangling to id as a shape violation', async () => {
    const ja = {
      ...figureData,
      cycle: {
        ...figureData.cycle,
        edges: [{ ...figureData.cycle.edges[0], to: 'missing-node' }],
      },
    };

    expect(await parity(tree(page('# Guide')), figureTree(figureData, ja))).toEqual([
      expect.objectContaining({ locale: 'ja', page: 'data/how-it-works/ja', rule: 'figure-json-shape' }),
    ]);
  });

  it('reports a duplicate edge triple as a shape violation', async () => {
    const ja = {
      ...figureData,
      cycle: {
        ...figureData.cycle,
        edges: [...figureData.cycle.edges, { ...figureData.cycle.edges[0], label: 'duplicate' }],
      },
    };

    expect(await parity(tree(page('# Guide')), figureTree(figureData, ja))).toEqual([
      expect.objectContaining({ locale: 'ja', page: 'data/how-it-works/ja', rule: 'figure-json-shape' }),
    ]);
  });

  it('reports a non-forward direction as a shape violation', async () => {
    const zh = {
      ...figureData,
      cycle: {
        ...figureData.cycle,
        edges: [{ ...figureData.cycle.edges[0], direction: 'bidirectional' }],
      },
    };

    expect(await parity(tree(page('# Guide')), figureTree(figureData, figureData, zh))).toEqual([
      expect.objectContaining({ locale: 'zh-cn', page: 'data/how-it-works/zh-cn', rule: 'figure-json-shape' }),
    ]);
  });

  it('reports a missing localized figure JSON file as a read violation', async () => {
    const dataFiles = figureTree();
    delete dataFiles['website/src/data/how-it-works/ja.json'];

    expect(await parity(tree(page('# Guide')), dataFiles)).toEqual([
      expect.objectContaining({ locale: 'ja', page: 'data/how-it-works/ja', rule: 'figure-json-read' }),
    ]);
  });

  it('reports a missing English figure JSON file as a shape violation', async () => {
    const dataFiles = figureTree();
    delete dataFiles['website/src/data/how-it-works/en.json'];

    expect(await parity(tree(page('# Guide')), dataFiles)).toEqual([
      expect.objectContaining({ locale: 'en', page: 'data/how-it-works/en', rule: 'figure-json-shape' }),
    ]);
  });

  it('reports a renamed figure key', async () => {
    const ja = { renamed: figureData.cycle };

    expect(await parity(tree(page('# Guide')), figureTree(figureData, ja))).toEqual([
      expect.objectContaining({ locale: 'ja', page: 'data/how-it-works/cycle', rule: 'figure-json-keys' }),
    ]);
  });

  it('reports a locale with an extra figure key', async () => {
    const ja = {
      ...figureData,
      extra: figureData.cycle,
    };

    expect(await parity(tree(page('# Guide')), figureTree(figureData, ja))).toEqual([
      expect.objectContaining({ locale: 'ja', page: 'data/how-it-works/extra', rule: 'figure-json-keys' }),
    ]);
  });

  it('reports an unparsable localized figure JSON file as one shape violation', async () => {
    const dataFiles = {
      ...figureTree(),
      'website/src/data/how-it-works/ja.json': '{"cycle":',
    };

    expect(await parity(tree(page('# Guide')), dataFiles)).toEqual([
      expect.objectContaining({ locale: 'ja', page: 'data/how-it-works/ja', rule: 'figure-json-shape' }),
    ]);
  });

  it('skips set comparisons when only the English baseline shape is invalid', async () => {
    const en = {
      ...figureData,
      cycle: { ...figureData.cycle, alt: '' },
    };
    const ja = {
      ...figureData,
      cycle: {
        ...figureData.cycle,
        nodes: [
          ...figureData.cycle.nodes,
          { id: 'cycle-extra', label: 'EXTRA', text: 'An extra node.' },
        ],
        edges: [
          ...figureData.cycle.edges,
          { from: 'cycle-end', to: 'cycle-start', label: 'return', direction: 'forward' },
        ],
      },
      extra: figureData.cycle,
    };

    const violations = await parity(tree(page('# Guide')), figureTree(en, ja));
    expect(violations).toEqual([
      expect.objectContaining({ locale: 'en', page: 'data/how-it-works/en', rule: 'figure-json-shape' }),
    ]);
    expect(violations.some(({ locale, rule }) => (
      locale === 'ja' && ['figure-json-keys', 'figure-json-nodes', 'figure-json-edges'].includes(rule)
    ))).toBe(false);
  });

  it('reports only an English baseline shape violation when its figure JSON is unparsable', async () => {
    const dataFiles = {
      ...figureTree(),
      'website/src/data/how-it-works/en.json': '{"cycle":',
    };

    expect(await parity(tree(page('# Guide')), dataFiles)).toEqual([
      expect.objectContaining({ locale: 'en', page: 'data/how-it-works/en', rule: 'figure-json-shape' }),
    ]);
  });

  it('distinguishes node-id sets that collide under newline joining', async () => {
    const collisionFigure = (ids: string[]) => ({
      cycle: {
        caption: null,
        alt: 'Two nodes with delimiter-bearing ids.',
        nodes: ids.map((id) => ({ id, label: 'NODE', text: 'A node.' })),
        edges: [],
      },
    });
    const en = collisionFigure(['a\nb', 'c']);
    const ja = collisionFigure(['a', 'b\nc']);

    expect(await parity(tree(page('# Guide')), figureTree(en, ja))).toEqual([
      expect.objectContaining({ locale: 'ja', page: 'data/how-it-works/cycle', rule: 'figure-json-nodes' }),
    ]);
  });

  it('distinguishes edge triples that collide under delimiter joining', async () => {
    const collisionFigure = (edge: { from: string; to: string }) => ({
      cycle: {
        caption: null,
        alt: 'Two edges with delimiter-bearing endpoints.',
        nodes: [
          { id: 'a|b', label: 'FIRST', text: 'The first endpoint.' },
          { id: 'c', label: 'SECOND', text: 'The second endpoint.' },
          { id: 'a', label: 'THIRD', text: 'The third endpoint.' },
          { id: 'b|c', label: 'FOURTH', text: 'The fourth endpoint.' },
        ],
        edges: [{ ...edge, label: 'continue', direction: 'forward' }],
      },
    });
    const en = collisionFigure({ from: 'a|b', to: 'c' });
    const ja = collisionFigure({ from: 'a', to: 'b|c' });

    expect(await parity(tree(page('# Guide')), figureTree(en, ja))).toEqual([
      expect.objectContaining({ locale: 'ja', page: 'data/how-it-works/cycle', rule: 'figure-json-edges' }),
    ]);
  });
});

describe('check-parity CLI entry point', () => {
  it('exits successfully without output for a fully matching tree', () => {
    const matchingPage = page('## Same {#same}\n\n```txt\nshared\n```\n\n| Code | Meaning |\n| --- | --- |\n| `E_ONE` | one |');
    const matchingSpec = '## Same {#same}\n\n```txt\nshared\n```\n\n| A | B |\n| --- | --- |\n| one | two |\n';
    const fixture = createDocsFixture({
      ...figureTree(),
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
      ...figureTree(),
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
