/**
 * Builds the canonical published URL for a documentation page. Root-locale URLs have no locale
 * segment, translated locales do, and every result ends in exactly one slash so index links and
 * full-document `Source:` lines cannot disagree about the site's canonical form.
 *
 * @param {'en' | 'ja' | 'zh-cn'} locale Page locale.
 * @param {string} slug Canonical locale-free documentation slug.
 * @returns {string} Absolute canonical page URL.
 */
export function buildPageUrl(locale, slug) {
  const normalizedSlug = slug.replace(/\/+$/, '');
  const localePrefix = locale === 'en' ? '' : `${locale}/`;
  return `https://kotarotsubaki.github.io/ambercast/${localePrefix}${normalizedSlug}/`;
}

/**
 * Renders an llms index from ordered page records. It preserves the supplied order of available
 * pages and omits empty groups. Callers supply the direct-page-before-subgroup ordering that the
 * shared sidebar ordering contract establishes.
 * The heading, bullets, spacing, and trailing newline form the byte-stable index contract.
 *
 * @param {Array<{ slug: string, groupLabel: string, subgroupLabel: string | null, title: string, description: string | undefined, status: 'available' | 'planned', url: string }>} pages
 * Ordered locale-specific page records.
 * @param {string} siteDescription Locale-specific site description for the blockquote preamble.
 * @returns {string} `llms.txt` content with the canonical heading, bullet, and whitespace layout.
 */
export function renderLlmsTxt(pages, siteDescription) {
  const lines = ['# ambercast', '', `> ${siteDescription}`];
  let currentGroup;
  let currentSubgroup;

  for (const page of pages) {
    if (page.status !== 'available') continue;
    if (page.groupLabel !== currentGroup) {
      lines.push('', `## ${page.groupLabel}`);
      currentGroup = page.groupLabel;
      currentSubgroup = null;
    }
    if (page.subgroupLabel !== currentSubgroup) {
      if (page.subgroupLabel !== null) lines.push('', `### ${page.subgroupLabel}`);
      currentSubgroup = page.subgroupLabel;
    }
    lines.push(`- [${page.title}](${page.url})${page.description === undefined ? '' : `: ${page.description}`}`);
  }

  return `${lines.join('\n')}\n`;
}

/**
 * Renders the full corpus from available records in their supplied order. Boundary-only body
 * trimming prevents duplicate blank lines around source lines and separators while preserving
 * internal whitespace; the page separators and trailing newline are byte-stable.
 *
 * @param {Array<{ title: string, status: 'available' | 'planned', url: string, body: string }>} pages
 * Ordered page records, with introduction bodies already re-inflated when applicable.
 * @returns {string} `llms-full.txt` content with byte-stable page separators.
 */
export function renderLlmsFullTxt(pages) {
  const blocks = pages
    .filter((page) => page.status === 'available')
    .map((page) => `# ${page.title}\nSource: ${page.url}\n\n${page.body.trim()}`);
  return `${blocks.join('\n\n---\n\n')}\n`;
}

/**
 * Renders the flat planned-page index. It preserves ordered-page order and uses the main index's
 * bullet format without group headings, including a trailing newline for an empty index.
 *
 * @param {Array<{ title: string, description: string | undefined, status: 'available' | 'planned', url: string }>} pages
 * Ordered page records.
 * @returns {string} `llms-planned.txt` bullet content.
 */
export function renderLlmsPlannedTxt(pages) {
  return `${pages
    .filter((page) => page.status === 'planned')
    .map((page) => `- [${page.title}](${page.url})${page.description === undefined ? '' : `: ${page.description}`}`)
    .join('\n')}\n`;
}

/**
 * Replaces the introduction's three MDX figure components with accessible Markdown reconstructed
 * from locale JSON. Required imports and component tags each occur exactly once in prose regions;
 * code regions remain untouched so literal imports and JSX-like examples survive unchanged.
 *
 * Each replacement retains the figure's alt text, nodes, and edges in a readable Markdown form.
 * Bidirectional edges use `↔`, preserving direction without relying on the original visual
 * component.
 *
 * @param {string} mdxSource Introduction MDX source.
 * @param {{ cycle: { alt: string, nodes: Array<{ id: string, label: string, text: string }>, edges: Array<{ from: string, to: string, label: string, direction?: 'forward' | 'bidirectional' }> }, files: { alt: string, nodes: Array<{ id: string, label: string, text: string }>, edges: Array<{ from: string, to: string, label: string, direction?: 'forward' | 'bidirectional' }> }, ledger: { alt: string, nodes: Array<{ id: string, label: string, text: string }>, edges: Array<{ from: string, to: string, label: string, direction?: 'forward' | 'bidirectional' }> } }} introJson
 * Locale-specific figure data keyed by component name.
 * @returns {string} Markdown-only introduction source suitable for llms artifacts.
 * @throws {Error} If required imports or tags are absent or duplicated, or figure data is incomplete.
 */
export function inflateIntroduction(mdxSource, introJson) {
  const expectedImports = [
    "import IntroCycle from '../../components/intro/IntroCycle.astro';",
    "import IntroFiles from '../../components/intro/IntroFiles.astro';",
    "import IntroLedger from '../../components/intro/IntroLedger.astro';",
    "import introData from '../../data/intro/en.json';",
  ];
  const locale = /intro\/(ja|zh-cn)\.json/.exec(mdxSource)?.[1];
  if (locale) {
    const parent = '../../../';
    expectedImports.splice(0, 4,
      `import IntroCycle from '${parent}components/intro/IntroCycle.astro';`,
      `import IntroFiles from '${parent}components/intro/IntroFiles.astro';`,
      `import IntroLedger from '${parent}components/intro/IntroLedger.astro';`,
      `import introData from '${parent}data/intro/${locale}.json';`);
  }
  const figures = [
    ['IntroCycle', 'cycle'],
    ['IntroFiles', 'files'],
    ['IntroLedger', 'ledger'],
  ];
  const prose = splitByCodeRegions(mdxSource).filter((region) => !region.isCode).map((region) => region.text).join('');

  const importMatcher = (statement) => new RegExp(`${escapeRegExp(statement)}(?:\\r?\\n|$)`, 'g');
  for (const statement of expectedImports) {
    const count = [...prose.matchAll(importMatcher(statement))].length;
    if (count !== 1) throw new Error(`Expected exactly one import: ${statement}`);
  }
  for (const [component] of figures) {
    const count = [...prose.matchAll(new RegExp(`<${component}\\b[^>]*\\/>`, 'g'))].length;
    if (count !== 1) throw new Error(`Expected exactly one ${component} tag`);
  }

  const replacementFor = (key) => {
    const figure = introJson?.[key];
    if (!figure || typeof figure.alt !== 'string' || !Array.isArray(figure.nodes) || !Array.isArray(figure.edges)) {
      throw new Error(`Incomplete introduction data for ${key}`);
    }
    const nodes = figure.nodes.map(({ id, label, text }) => {
      if (![id, label, text].every((value) => typeof value === 'string')) throw new Error(`Invalid node in ${key}`);
      return `- \`${id}\` — ${label}: ${text}`;
    });
    const edges = figure.edges.map(({ from, to, label, direction }) => {
      if (![from, to, label].every((value) => typeof value === 'string')) throw new Error(`Invalid edge in ${key}`);
      return `- \`${from} ${direction === 'bidirectional' ? '↔' : '→'} ${to}\` (\`${label}\`)`;
    });
    return `${figure.alt}\n\n${nodes.join('\n')}\n\n${edges.join('\n')}`;
  };

  return splitByCodeRegions(mdxSource).map((region) => {
    if (region.isCode) return region.text;
    let output = region.text;
    for (const statement of expectedImports) output = output.replace(importMatcher(statement), '');
    for (const [component, key] of figures) output = output.replace(new RegExp(`<${component}\\b[^>]*\\/>`), replacementFor(key));
    return output;
  }).join('');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
import { splitByCodeRegions } from './wikilinks.mjs';
