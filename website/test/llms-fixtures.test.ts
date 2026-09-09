import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { orderedPages } from '../src/sidebar.mjs';
import { siteDescriptions } from '../src/data/site-descriptions.mjs';
import { parseFrontmatter } from '../scripts/lib/frontmatter.mjs';
import { main as syncSpec } from '../scripts/sync-spec.mjs';
import {
  buildPageUrl,
  inflateIntroduction,
  renderLlmsFullTxt,
  renderLlmsPlannedTxt,
  renderLlmsTxt,
} from '../scripts/lib/llms.mjs';

const fixturesDirectory = new URL('./fixtures/llms/', import.meta.url);
const specDirectory = new URL('../src/content/docs/spec/', import.meta.url);
const websiteRoot = fileURLToPath(new URL('../', import.meta.url));

beforeAll(async () => {
  if (!existsSync(specDirectory)) await syncSpec({ websiteRoot });
});

function sourcePath(locale: 'en' | 'ja' | 'zh-cn', slug: string) {
  const directory = new URL(`../src/content/docs/${locale === 'en' ? '' : `${locale}/`}`, import.meta.url);
  for (const extension of ['.md', '.mdx']) {
    const candidate = new URL(`${slug}${extension}`, directory);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Missing source for ${locale}/${slug}`);
}

function recordsFor(locale: 'en' | 'ja' | 'zh-cn') {
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

describe('golden fixtures', () => {
  it('matches every llms artifact generated from the real ordered source documents', () => {
    const records = Object.fromEntries(['en', 'ja', 'zh-cn'].map((locale) => [locale, recordsFor(locale as 'en' | 'ja' | 'zh-cn')]));
    const outputs = {
      'llms.txt': renderLlmsTxt(records.en, siteDescriptions.en),
      'llms-full.txt': renderLlmsFullTxt(records.en),
      'ja-llms.txt': renderLlmsTxt(records.ja, siteDescriptions.ja),
      'ja-llms-full.txt': renderLlmsFullTxt(records.ja),
      'zh-cn-llms.txt': renderLlmsTxt(records['zh-cn'], siteDescriptions['zh-cn']),
      'zh-cn-llms-full.txt': renderLlmsFullTxt(records['zh-cn']),
      'llms-planned.txt': renderLlmsPlannedTxt(records.en),
    };

    for (const [fixture, output] of Object.entries(outputs)) {
      expect(output).toBe(readFileSync(join(fixturesDirectory.pathname, fixture), 'utf8'));
    }
  });
});
