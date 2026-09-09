import { existsSync, readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { siteDescriptions } from '../src/data/site-descriptions.mjs';
import { orderedPages } from '../src/sidebar.mjs';
import { parseFrontmatter } from '../scripts/lib/frontmatter.mjs';
import { main as syncSpec } from '../scripts/sync-spec.mjs';
import {
  buildPageUrl,
  inflateIntroduction,
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

const introSource = readFileSync(new URL('../src/content/docs/introduction.mdx', import.meta.url), 'utf8');
const introData = JSON.parse(readFileSync(new URL('../src/data/intro/en.json', import.meta.url), 'utf8'));

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
    const body = page.slug === 'introduction'
      ? inflateIntroduction(
        parsed.body,
        JSON.parse(readFileSync(new URL(`../src/data/intro/${locale}.json`, import.meta.url), 'utf8')),
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
      expect(discoveredAvailableSlugs.filter((slug) => !slug.startsWith('spec/'))).toHaveLength(49);
      expect(discoveredAvailableSlugs.filter((slug) => slug.startsWith('spec/'))).toHaveLength(11);
      expect(discoveredAvailableSlugs).toHaveLength(60);
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
      for (const record of records.filter(({ slug }) => slug !== 'introduction')) {
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

describe('inflateIntroduction', () => {
  it('re-inflates real forward and bidirectional edges and removes the four imports and three figure tags', () => {
    const inflated = inflateIntroduction(introSource, introData);

    expect(inflated).toContain(`- \`plan-file ↔ grounding-file\` (\`paired derived artifacts\`)`);
    expect(inflated).toContain(`- \`prompt → generate\` (\`ambercast generate\`)`);
    for (const marker of ['import IntroCycle', 'import IntroFiles', 'import IntroLedger', 'import introData', '<IntroCycle', '<IntroFiles', '<IntroLedger']) {
      expect(inflated).not.toContain(marker);
    }
  });

  it('removes required imports from a CRLF introduction source', () => {
    const inflated = inflateIntroduction(introSource.replace(/\n/g, '\r\n'), introData);

    for (const marker of ['import IntroCycle', 'import IntroFiles', 'import IntroLedger', 'import introData']) {
      expect(inflated).not.toContain(marker);
    }
  });

  it('preserves import-like and tag-like text inside fenced and inline code regions', () => {
    const source = `${introSource}\n\n\`<IntroCycle {...introData.cycle} />\`\n\n\`\`\`mdx\nimport IntroCycle from '../../components/intro/IntroCycle.astro';\n<IntroLedger {...introData.ledger} />\n\`\`\`\n`;
    const inflated = inflateIntroduction(source, introData);

    expect(inflated).toContain('`<IntroCycle {...introData.cycle} />`');
    expect(inflated).toContain("import IntroCycle from '../../components/intro/IntroCycle.astro';");
    expect(inflated).toContain('<IntroLedger {...introData.ledger} />');
  });

  it('fails loudly when one required import is missing', () => {
    expect(() => inflateIntroduction(introSource.replace("import IntroFiles from '../../components/intro/IntroFiles.astro';\n", ''), introData)).toThrow(/IntroFiles|import/i);
  });

  it('fails loudly when a figure tag is duplicated', () => {
    expect(() => inflateIntroduction(introSource.replace('<IntroLedger {...introData.ledger} />', '<IntroLedger {...introData.ledger} />\n<IntroLedger {...introData.ledger} />'), introData)).toThrow(/IntroLedger|duplicate/i);
  });

  for (const figure of ['cycle', 'files', 'ledger']) {
    for (const field of ['nodes', 'edges', 'alt']) {
      it(`fails loudly for malformed introduction JSON missing ${figure}.${field}`, () => {
        const malformed = { ...introData, [figure]: { ...introData[figure], [field]: undefined } };

        assert.throws(() => inflateIntroduction(introSource, malformed), new RegExp(`${figure}|${field}`, 'i'));
      });
    }
  }
});
