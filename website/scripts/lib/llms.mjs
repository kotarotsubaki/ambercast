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
 * Ordered locale page records, with any page-specific inflation, such as the how-it-works cycle
 * figure, already applied.
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
 * Converts the how-it-works cycle component in an MDX page to accessible Markdown for llms
 * artifacts.
 *
 * @remarks
 * The implementation preserves a fail-loud, locale-inference-then-round-trip-validation
 * pattern. It inspects prose regions only, requiring
 * exactly the two locale-correct imports—one for `CycleFigure.astro` and one for the locale JSON—
 * and exactly one `<CycleFigure {...figure.cycle} />` tag. Imports and tags inside fenced or inline
 * code remain untouched. After inferring the locale from the data import (defaulting to
 * English when no localized JSON path is present), it requires both expected import statements
 * to use the exact English `../../` depth or localized `../../../` depth and the inferred data
 * filename. Missing, duplicated, or cross-locale forms therefore fail instead of silently
 * producing an incomplete artifact.
 *
 * The replacement contains the alt text as a paragraph, a blank line, node bullets in JSON
 * array order, another blank line, and edge bullets in JSON array order, with no heading. Node
 * bullets use ``- `id` — label: text`` and edge bullets use ``- `from → to` (`label`)``. No
 * bidirectional-arrow branch is needed because the governing figure schema permits only
 * `direction: 'forward'`; the replacement inherits the matched tag line's trailing newline.
 *
 * @param {string} mdxSource How-it-works MDX source containing the two locale-correct imports and
 * one cycle component tag outside code regions.
 * @param {{ cycle: { caption: string | null, alt: string, nodes: Array<{ id: string, label: string, text: string }>, edges: Array<{ from: string, to: string, label: string, direction: 'forward' }> } }} figureJson
 * Locale-specific cycle data whose node and edge order is preserved.
 * @returns {string} Markdown-only how-it-works source with the cycle expanded and all other bytes
 * preserved apart from the matched import lines with their trailing newlines and the component
 * tag.
 * @throws {Error} If an expected import or the component tag is missing or duplicated, the
 * inferred locale does not round-trip to the exact expected imports, or required cycle data is
 * incomplete or malformed.
 * @example
 * ```js
 * const markdown = inflateHowItWorks(mdxSource, figureJson);
 * ```
 */
export function inflateHowItWorks(mdxSource, figureJson) {
  const regions = splitByCodeRegions(mdxSource);
  const prose = regions.filter((region) => !region.isCode).map((region) => region.text).join('');
  const expectedImports = [
    "import CycleFigure from '../../components/how-it-works/CycleFigure.astro';",
    "import figure from '../../data/how-it-works/en.json';",
  ];
  const locale = /how-it-works\/(ja|zh-cn)\.json/.exec(prose)?.[1];
  if (locale) {
    const parent = '../../../';
    expectedImports.splice(0, 2,
      `import CycleFigure from '${parent}components/how-it-works/CycleFigure.astro';`,
      `import figure from '${parent}data/how-it-works/${locale}.json';`);
  }
  const importLines = [...prose.matchAll(/^(import (?:CycleFigure from|figure from) '[^']+';)\r?$/gm)].map((match) => match[1]);
  if (importLines.length !== 2) throw new Error('Expected exactly one import for CycleFigure and figure data');

  for (const statement of expectedImports) {
    const count = importLines.filter((line) => line === statement).length;
    if (count !== 1) throw new Error(`Expected exactly one import: ${statement}`);
  }

  const tagMatcher = /^<CycleFigure \{\.\.\.figure\.cycle\} \/>\r?$/gm;
  if ([...prose.matchAll(tagMatcher)].length !== 1) throw new Error('Expected exactly one CycleFigure tag');

  const figure = figureJson?.cycle;
  if (!figure || typeof figure.alt !== 'string' || !Array.isArray(figure.nodes) || !Array.isArray(figure.edges)) {
    throw new Error('Incomplete how-it-works cycle data');
  }
  const nodes = figure.nodes.map((node) => {
    const { id, label, text } = node ?? {};
    if (![id, label, text].every((value) => typeof value === 'string')) throw new Error('Invalid node in cycle');
    return `- \`${id}\` — ${label}: ${text}`;
  });
  const edges = figure.edges.map((edge) => {
    const { from, to, label } = edge ?? {};
    if (![from, to, label].every((value) => typeof value === 'string')) throw new Error('Invalid edge in cycle');
    return `- \`${from} → ${to}\` (\`${label}\`)`;
  });
  const replacement = `${figure.alt}\n\n${nodes.join('\n')}\n\n${edges.join('\n')}`;

  return regions.map((region) => {
    if (region.isCode) return region.text;
    let output = region.text;
    for (const statement of expectedImports) output = output.replace(new RegExp(`^${escapeRegExp(statement)}\\r?(?:\\n|$)`, 'gm'), '');
    return output.replace(/^<CycleFigure \{\.\.\.figure\.cycle\} \/>\r?$/m, replacement);
  }).join('');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
import { splitByCodeRegions } from './wikilinks.mjs';
