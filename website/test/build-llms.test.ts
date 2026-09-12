import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { siteDescriptions } from '../src/data/site-descriptions.mjs';
import { orderedPages } from '../src/sidebar.mjs';
import { parseFrontmatter } from '../scripts/lib/frontmatter.mjs';
import { main as syncSpec } from '../scripts/sync-spec.mjs';
import {
  buildPageUrl,
  inflateHowItWorks,
  renderLlmsFullTxt,
  renderLlmsPlannedTxt,
  renderLlmsTxt,
} from '../scripts/lib/llms.mjs';

const PLANNED_SLUGS = [
  'reference/mcp-tools',
  'reference/cli/init',
  'reference/cli/view',
  'reference/cli/review',
  'reference/cli/mcp',
  'reference/cli/baseline-restore',
  'agents/official-skill',
  'agents/mcp-server',
];

const docsDirectory = new URL('../src/content/docs/', import.meta.url);
const specDirectory = new URL('../src/content/docs/spec/', import.meta.url);
const websiteRoot = fileURLToPath(new URL('../', import.meta.url));
const locales = ['en', 'ja', 'zh-cn'] as const;

type Locale = typeof locales[number];

beforeAll(async () => {
  if (!existsSync(specDirectory)) await syncSpec({ websiteRoot });
});

function sourceStatus(source: string) {
  return /^status:\s*(.+)$/m.exec(source)?.[1]?.trim() ?? 'available';
}

function documentSources(directory: URL, relativeDirectory = ''): Array<{ slug: string, source: string }> {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryRelativePath = join(relativeDirectory, entry.name);
    const entryUrl = new URL(entry.name, directory);
    if (entry.isDirectory()) return documentSources(new URL(`${entry.name}/`, directory), entryRelativePath);
    if (!['.md', '.mdx'].includes(extname(entry.name))) return [];
    return [{
      slug: entryRelativePath.slice(0, -extname(entry.name).length),
      source: readFileSync(entryUrl, 'utf8'),
    }];
  });
}

function sourcesFor(locale: Locale) {
  if (locale !== 'en') return documentSources(new URL(`${locale}/`, docsDirectory));
  const rootSources = documentSources(docsDirectory).filter(({ slug }) => !/^(?:ja|zh-cn|spec)\//.test(slug));
  return [...rootSources, ...documentSources(specDirectory, 'spec')];
}

function sourcePath(locale: Locale, slug: string) {
  const directory = new URL(`../src/content/docs/${locale === 'en' ? '' : `${locale}/`}`, import.meta.url);
  for (const extension of ['.md', '.mdx']) {
    const candidate = new URL(`${slug}${extension}`, directory);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Missing source for ${locale}/${slug}`);
}

function recordsFor(locale: Locale) {
  return orderedPages.map((page) => {
    const parsed = parseFrontmatter(readFileSync(sourcePath(locale, page.slug), 'utf8'));
    const body = page.slug === 'how-it-works'
      ? inflateHowItWorks(
        parsed.body,
        JSON.parse(readFileSync(new URL(`../src/data/how-it-works/${locale}.json`, import.meta.url), 'utf8')),
      )
      : parsed.body;
    return { ...page, ...parsed, body, url: buildPageUrl(locale, page.slug) };
  });
}

const page = (overrides: Record<string, unknown> = {}) => ({
  slug: 'reference/configuration',
  groupLabel: 'REFERENCE',
  subgroupLabel: null,
  title: 'Configuration',
  description: 'Configure ambercast.',
  status: 'available',
  url: 'https://kotarotsubaki.github.io/ambercast/reference/configuration/',
  body: 'Configuration body.',
  ...overrides,
});

describe('llms artifact completeness oracles', () => {
  for (const locale of locales) {
    it(`${locale} matches the filesystem-derived available and independently specified planned page sets`, () => {
      const discoveredSources = sourcesFor(locale);
      const discoveredAvailableSlugs = discoveredSources.filter(({ source }) => sourceStatus(source) === 'available').map(({ slug }) => slug).sort();
      const discoveredPlannedSlugs = discoveredSources.filter(({ source }) => sourceStatus(source) === 'planned').map(({ slug }) => slug).sort();
      const orderedAvailableSlugs = orderedPages.filter(({ slug }) => discoveredAvailableSlugs.includes(slug)).map(({ slug }) => slug).sort();
      const orderedPlannedSlugs = orderedPages.filter(({ slug }) => discoveredPlannedSlugs.includes(slug)).map(({ slug }) => slug).sort();

      expect(discoveredPlannedSlugs).toEqual([...PLANNED_SLUGS].sort());
      expect(discoveredAvailableSlugs.filter((slug) => !slug.startsWith('spec/'))).toHaveLength(50);
      expect(discoveredAvailableSlugs.filter((slug) => slug.startsWith('spec/'))).toHaveLength(11);
      expect(discoveredAvailableSlugs).toHaveLength(61);
      expect(orderedAvailableSlugs).toEqual(discoveredAvailableSlugs);
      expect(orderedPlannedSlugs).toEqual(discoveredPlannedSlugs);
    });
  }
});

describe('cross-locale real-document integrity oracle', () => {
  for (const locale of locales) {
    it(`${locale} preserves index and corpus URL order and source bodies`, () => {
      const records = recordsFor(locale).filter((record) => record.status === 'available');
      const index = renderLlmsTxt(records, siteDescriptions[locale]);
      const full = renderLlmsFullTxt(records);
      const indexUrls = [...index.matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1]);
      const sourceUrls = [...full.matchAll(/^Source: (.+)$/gm)].map((match) => match[1]);

      expect(sourceUrls).toEqual(indexUrls);
      for (const record of records.filter(({ slug }) => slug !== 'how-it-works')) {
        expect(full).toContain(`# ${record.title}\nSource: ${record.url}\n\n${record.body.trim()}`);
      }
    });
  }
});

describe('buildPageUrl', () => {
  it('uses no locale prefix for English and a locale prefix for Japanese and Simplified Chinese', () => {
    expect(buildPageUrl('en', 'agents/overview')).toBe('https://kotarotsubaki.github.io/ambercast/agents/overview/');
    expect(buildPageUrl('ja', 'agents/overview')).toBe('https://kotarotsubaki.github.io/ambercast/ja/agents/overview/');
    expect(buildPageUrl('zh-cn', 'agents/overview')).toBe('https://kotarotsubaki.github.io/ambercast/zh-cn/agents/overview/');
  });

  it('normalizes every result to exactly one trailing slash', () => {
    expect(buildPageUrl('en', 'agents/overview/')).toBe('https://kotarotsubaki.github.io/ambercast/agents/overview/');
  });
});

describe('renderLlmsTxt', () => {
  it('renders REFERENCE direct pages before its CLI subgroup with canonical whitespace', () => {
    const rendered = renderLlmsTxt([
      page({ slug: 'reference/configuration', title: 'Configuration' }),
      page({ slug: 'reference/cli/run', subgroupLabel: 'CLI', title: 'ambercast run' }),
    ], 'Prompt-native end-to-end testing.');

    expect(rendered).toBe([
      '# ambercast',
      '',
      '> Prompt-native end-to-end testing.',
      '',
      '## REFERENCE',
      '- [Configuration](https://kotarotsubaki.github.io/ambercast/reference/configuration/): Configure ambercast.',
      '',
      '### CLI',
      '- [ambercast run](https://kotarotsubaki.github.io/ambercast/reference/configuration/): Configure ambercast.',
      '',
    ].join('\n'));
  });

  it('omits a group with no available pages, has one blank line before headings, and none after headings', () => {
    const rendered = renderLlmsTxt([
      page({ groupLabel: 'HIDDEN', status: 'planned' }),
      page({ groupLabel: 'VISIBLE', title: 'Visible' }),
    ], 'Description');

    expect(rendered).not.toContain('HIDDEN');
    expect(rendered).toContain('\n\n## VISIBLE\n- [Visible]');
    expect(rendered).not.toContain('## VISIBLE\n\n-');
    expect(rendered).toMatch(/[^\n]\n$/);
  });

  it('renders the empty-input edge case with exactly one trailing newline', () => {
    expect(renderLlmsTxt([], 'Description')).toBe('# ambercast\n\n> Description\n');
  });

  it('omits an undefined description without a suffix or undefined text', () => {
    const rendered = renderLlmsTxt([page({ description: undefined })], 'Description');

    expect(rendered).toBe('# ambercast\n\n> Description\n\n## REFERENCE\n- [Configuration](https://kotarotsubaki.github.io/ambercast/reference/configuration/)\n');
    expect(rendered).not.toContain('): ');
    expect(rendered).not.toContain('undefined');
  });
});

describe('renderLlmsFullTxt', () => {
  it('renders only available records with the exact prefix, separator, boundary trim, and trailing newline', () => {
    const rendered = renderLlmsFullTxt([
      page({ title: 'First', body: '\n\nFirst body\n\n' }),
      page({ title: 'Planned', status: 'planned', body: 'Must not appear' }),
      page({ title: 'Second', body: '\nSecond body\n' }),
    ]);

    expect(rendered).toBe('# First\nSource: https://kotarotsubaki.github.io/ambercast/reference/configuration/\n\nFirst body\n\n---\n\n# Second\nSource: https://kotarotsubaki.github.io/ambercast/reference/configuration/\n\nSecond body\n');
    expect(rendered).not.toContain('Planned');
    expect(rendered).toMatch(/[^\n]\n$/);
  });

  it('preserves internal blank-line runs byte-for-byte while trimming only body boundaries', () => {
    expect(renderLlmsFullTxt([
      page({ title: 'First', body: '\nalpha\n\n\nbeta\n' }),
      page({ title: 'Second', body: '\ngamma\n\n\ndelta\n' }),
    ])).toBe('# First\nSource: https://kotarotsubaki.github.io/ambercast/reference/configuration/\n\nalpha\n\n\nbeta\n\n---\n\n# Second\nSource: https://kotarotsubaki.github.io/ambercast/reference/configuration/\n\ngamma\n\n\ndelta\n');
  });

  it('keeps full-corpus Source URLs in the same order as llms.txt bullet URLs and preserves trimmed source bodies', () => {
    const records = [page({ title: 'First', body: '\nFirst source body\n' }), page({ title: 'Second', body: '\nSecond source body\n' })];
    const index = renderLlmsTxt(records, 'Description');
    const full = renderLlmsFullTxt(records);
    const indexUrls = [...index.matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1]);
    const sourceUrls = [...full.matchAll(/^Source: (.+)$/gm)].map((match) => match[1]);

    expect(sourceUrls).toEqual(indexUrls);
    expect(full).toContain('First source body');
    expect(full).toContain('Second source body');
  });
});

describe('renderLlmsPlannedTxt', () => {
  it('renders exactly the fixed eight planned pages in supplied ordered-page order without headings', () => {
    const records = PLANNED_SLUGS.map((slug, index) => page({ slug, title: `Planned ${index + 1}`, status: 'planned', url: buildPageUrl('en', slug) }));
    const rendered = renderLlmsPlannedTxt(records);

    expect(rendered.split('\n').filter(Boolean)).toHaveLength(8);
    expect(rendered).not.toMatch(/^#{1,3}\s/m);
    expect(rendered).toBe(records.map((record) => `- [${record.title}](${record.url}): ${record.description}`).join('\n') + '\n');
  });

  it('renders no planned records surviving filtering as exactly one newline', () => {
    expect(renderLlmsPlannedTxt([page()])).toBe('\n');
  });

  it('omits an undefined description without a suffix or undefined text', () => {
    const rendered = renderLlmsPlannedTxt([page({ description: undefined, status: 'planned' })]);

    expect(rendered).toBe('- [Configuration](https://kotarotsubaki.github.io/ambercast/reference/configuration/)\n');
    expect(rendered).not.toContain('): ');
    expect(rendered).not.toContain('undefined');
  });
});

describe('inflateHowItWorks', () => {
  const componentImport = "import CycleFigure from '../../../components/how-it-works/CycleFigure.astro';";
  const dataImport = "import figure from '../../../data/how-it-works/ja.json';";
  const tag = '<CycleFigure {...figure.cycle} />';
  const figureData = {
    cycle: {
      caption: null,
      alt: 'A prompt becomes a replayable test cycle.',
      nodes: [
        { id: 'prompt', label: 'PROMPT', text: 'Describe the intent.' },
        { id: 'run', label: 'RUN', text: 'Replay without AI.' },
      ],
      edges: [
        { from: 'prompt', to: 'run', label: 'ambercast run', direction: 'forward' },
        { from: 'run', to: 'prompt', label: 'repair needed', direction: 'forward' },
      ],
    },
  };
  const source = (overrides: { componentImport?: string, dataImport?: string, tag?: string } = {}) => [
    '---',
    'title: How it works',
    '---',
    overrides.componentImport ?? componentImport,
    overrides.dataImport ?? dataImport,
    '',
    'Before diagram.',
    '',
    overrides.tag ?? tag,
    '',
    'After diagram.',
    '',
  ].join('\n');

  it('removes the required imports from a CRLF source', () => {
    const inflated = inflateHowItWorks(source().replace(/\n/g, '\r\n'), figureData);

    expect(inflated).not.toContain(componentImport);
    expect(inflated).not.toContain(dataImport);
  });

  it('preserves import-like and tag-like text inside a fenced code region', () => {
    const inflated = inflateHowItWorks(`${source()}\n\`\`\`mdx\n${componentImport}\n${tag}\n\`\`\`\n`, figureData);

    expect(inflated).toContain(componentImport);
    expect(inflated).toContain(tag);
  });

  it('infers English from prose when a fenced example names Japanese data', () => {
    const englishComponentImport = "import CycleFigure from '../../components/how-it-works/CycleFigure.astro';";
    const englishDataImport = "import figure from '../../data/how-it-works/en.json';";
    const japaneseDataImport = "import figure from '../../../data/how-it-works/ja.json';";

    const inflated = inflateHowItWorks(
      `${source({ componentImport: englishComponentImport, dataImport: englishDataImport })}\n\`\`\`mdx\n${japaneseDataImport}\n\`\`\`\n`,
      figureData,
    );

    expect(inflated).not.toContain(englishComponentImport);
    expect(inflated).not.toContain(englishDataImport);
    expect(inflated).toContain(japaneseDataImport);
  });

  it('fails loudly when the CycleFigure component import is missing', () => {
    expect(() => inflateHowItWorks(source({ componentImport: '' }), figureData)).toThrow(/exactly one import/i);
  });

  it('fails loudly when the CycleFigure component import is duplicated', () => {
    expect(() => inflateHowItWorks(source({ componentImport: `${componentImport}\n${componentImport}` }), figureData)).toThrow(/exactly one import/i);
  });

  it('fails loudly when the figure data import is missing', () => {
    expect(() => inflateHowItWorks(source({ dataImport: '' }), figureData)).toThrow(/exactly one import/i);
  });

  it('fails loudly when the figure data import is duplicated', () => {
    expect(() => inflateHowItWorks(source({ dataImport: `${dataImport}\n${dataImport}` }), figureData)).toThrow(/exactly one import/i);
  });

  it('fails loudly when the CycleFigure tag is missing', () => {
    expect(() => inflateHowItWorks(source({ tag: '' }), figureData)).toThrow(/exactly one.*CycleFigure.*tag/i);
  });

  it('fails loudly when the CycleFigure tag is duplicated', () => {
    expect(() => inflateHowItWorks(source({ tag: `${tag}\n${tag}` }), figureData)).toThrow(/exactly one.*CycleFigure.*tag/i);
  });

  it('fails loudly when the CycleFigure tag has different props', () => {
    expect(() => inflateHowItWorks(source({ tag: '<CycleFigure wrong={true} />' }), figureData)).toThrow(/exactly one.*CycleFigure.*tag/i);
  });

  it('fails loudly when the component import has English depth in a Japanese source', () => {
    expect(() => inflateHowItWorks(source({ componentImport: "import CycleFigure from '../../components/how-it-works/CycleFigure.astro';" }), figureData)).toThrow(/import|locale/i);
  });

  it('fails loudly when the data import has English depth in a Japanese source', () => {
    expect(() => inflateHowItWorks(source({ dataImport: "import figure from '../../data/how-it-works/ja.json';" }), figureData)).toThrow(/import|locale/i);
  });

  it('fails loudly when a Japanese source also imports English figure data', () => {
    expect(() => inflateHowItWorks(
      source({ dataImport: `${dataImport}\nimport figure from '../../data/how-it-works/en.json';` }),
      figureData,
    )).toThrow(/exactly.*import/i);
  });

  it('fails loudly when a required import is not a complete line', () => {
    expect(() => inflateHowItWorks(source({ componentImport: `prefix${componentImport}` }), figureData)).toThrow(/exactly.*import/i);
  });

  it('fails loudly when cycle.alt is missing', () => {
    expect(() => inflateHowItWorks(source(), { cycle: { ...figureData.cycle, alt: undefined } })).toThrow(/cycle|alt|data/i);
  });

  it.each([undefined, {}])('fails loudly when cycle.nodes is missing or not an array', (nodes) => {
    expect(() => inflateHowItWorks(source(), { cycle: { ...figureData.cycle, nodes } })).toThrow(/cycle|node|data/i);
  });

  it.each([undefined, {}])('fails loudly when cycle.edges is missing or not an array', (edges) => {
    expect(() => inflateHowItWorks(source(), { cycle: { ...figureData.cycle, edges } })).toThrow(/cycle|edge|data/i);
  });

  it('fails loudly for a malformed node', () => {
    expect(() => inflateHowItWorks(source(), { cycle: { ...figureData.cycle, nodes: [{ id: 'prompt', text: 'Describe the intent.' }] } })).toThrow(/node/i);
  });

  it('fails loudly for a malformed edge', () => {
    expect(() => inflateHowItWorks(source(), { cycle: { ...figureData.cycle, edges: [{ from: 'prompt', to: 'run', direction: 'forward' }] } })).toThrow(/edge/i);
  });

  it('fails loudly for an edge with a non-forward direction', () => {
    expect(() => inflateHowItWorks(source(), {
      cycle: {
        ...figureData.cycle,
        edges: [{ ...figureData.cycle.edges[0], direction: 'bidirectional' }],
      },
    })).toThrow(/edge/i);
  });

  it('replaces the tag with the exact accessible Markdown while preserving all other source bytes', () => {
    const inflated = inflateHowItWorks(source(), figureData);

    expect(inflated).toBe([
      '---',
      'title: How it works',
      '---',
      '',
      'Before diagram.',
      '',
      'A prompt becomes a replayable test cycle.',
      '',
      '- `prompt` — PROMPT: Describe the intent.',
      '- `run` — RUN: Replay without AI.',
      '',
      '- `prompt → run` (`ambercast run`)',
      '- `run → prompt` (`repair needed`)',
      '',
      'After diagram.',
      '',
    ].join('\n'));
  });
});
