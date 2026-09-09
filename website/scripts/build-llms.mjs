/**
 * Postbuild entry point for the llms artifact family.
 *
 * It writes the English, Japanese, and Simplified Chinese index and full-corpus artifacts, plus
 * the English planned index, after Astro produces `dist/`. Filesystem discovery and writes stay
 * here rather than in `lib/llms.mjs`, keeping the renderers pure and independently testable.
 *
 * Locale records follow `orderedPages`, which keeps the published indexes aligned with reader
 * navigation. Introduction figures are inflated from their locale data before full-corpus
 * rendering so machine-readable output retains their information. Missing sources and invalid
 * publication states fail the build rather than silently omitting a published page.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { orderedPages } from '../src/sidebar.mjs';
import { siteDescriptions } from '../src/data/site-descriptions.mjs';
import { parseFrontmatter } from './lib/frontmatter.mjs';
import { buildPageUrl, inflateIntroduction, renderLlmsFullTxt, renderLlmsPlannedTxt, renderLlmsTxt } from './lib/llms.mjs';

const websiteRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const locales = ['en', 'ja', 'zh-cn'];

if (new Set(orderedPages.map(({ slug }) => slug)).size !== orderedPages.length) {
  throw new Error('orderedPages contains duplicate slugs');
}

function sourcePath(locale, slug) {
  const directory = join(websiteRoot, 'src', 'content', 'docs', locale === 'en' ? '' : locale);
  for (const extension of ['.md', '.mdx']) {
    const candidate = join(directory, `${slug}${extension}`);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Missing source for ${locale}/${slug}`);
}

function recordsFor(locale) {
  return orderedPages.map((page) => {
    const source = readFileSync(sourcePath(locale, page.slug), 'utf8');
    const parsed = parseFrontmatter(source);
    const body = page.slug === 'introduction'
      ? inflateIntroduction(parsed.body, JSON.parse(readFileSync(join(websiteRoot, 'src', 'data', 'intro', `${locale}.json`), 'utf8')))
      : parsed.body;
    return { ...page, ...parsed, body, url: buildPageUrl(locale, page.slug) };
  });
}

const records = Object.fromEntries(locales.map((locale) => [locale, recordsFor(locale)]));
const dist = join(websiteRoot, 'dist');
const write = (relativePath, content) => writeFileSync(join(dist, relativePath), content);

write('llms.txt', renderLlmsTxt(records.en, siteDescriptions.en));
write('llms-full.txt', renderLlmsFullTxt(records.en));
write('llms-planned.txt', renderLlmsPlannedTxt(records.en));
for (const locale of ['ja', 'zh-cn']) {
  write(`${locale}/llms.txt`, renderLlmsTxt(records[locale], siteDescriptions[locale]));
  write(`${locale}/llms-full.txt`, renderLlmsFullTxt(records[locale]));
}
