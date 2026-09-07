import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitByCodeRegions } from './lib/wikilinks.mjs';

const LOCALES = ['en', 'ja', 'zh-cn'];
const PLANNED_PAGES = new Set([
  'agents/mcp-server',
  'agents/official-skill',
  'reference/cli/baseline-restore',
  'reference/cli/init',
  'reference/cli/mcp',
  'reference/cli/review',
  'reference/cli/view',
  'reference/mcp-tools',
]);
const FENCE_PAGES = new Set([
  'how-to/choose-ai-provider',
  'how-to/control-grounding-writeback',
  'how-to/manage-artifacts-in-git',
  'how-to/write-effective-prompts',
  'tutorials/quick-start',
  'tutorials/repair-your-first-drift',
]);
const HISTORICAL_VERSION_PAGES = new Set([
  'philosophy',
  'reference/changelog',
  'reference/compatibility',
]);

/**
 * Places the handed-off documentation corpus and applies its one-time, deterministic source
 * transforms.
 *
 * Centralizing the corpus placement and data-changing rules keeps the transformation
 * reviewable, testable, and repeatable. It preserves allowlisted historical version mentions,
 * applies planned-page metadata, normalizes fences with the shared code-region tokenizer, and
 * is byte-identical when run against already transformed input.
 *
 * Failures report each distinct diagnostic on one plain-text stderr line, set a non-zero exit
 * status, and leave source and destination files unmodified rather than committing a partial
 * corpus.
 *
 * @returns {Promise<void>} Resolves after a complete placement or after reporting all errors.
 */
export async function main() {
  const handoff = resolve(process.env.AMBERCAST_CONTENT_HANDOFF ?? '../docs-rebuild');
  const contentRoot = join(handoff, 'content');
  const specRoot = join(handoff, 'docs-spec');
  const diagnostics = [];

  for (const [name, path] of [['content', contentRoot], ['docs-spec', specRoot]]) {
    try {
      const stat = await readdir(path);
      if (!stat) diagnostics.push(`Missing handoff directory: ${name}`);
    } catch {
      diagnostics.push(`Missing handoff directory: ${name}`);
    }
  }
  if (diagnostics.length) {
    for (const diagnostic of diagnostics) process.stderr.write(`${diagnostic}\n`);
    process.exitCode = 1;
    return;
  }

  try {
    const output = [];
    const pagesByLocale = new Map();
    for (const locale of LOCALES) {
      const localeRoot = join(contentRoot, locale);
      const files = await markdownFiles(localeRoot);
      const pages = new Map();
      for (const source of files) {
        const page = relative(localeRoot, source).replace(/\.md$/, '');
        pages.set(page, transformPage(await readFile(source, 'utf8'), { locale, page }));
      }
      pagesByLocale.set(locale, pages);
    }

    for (const page of FENCE_PAGES) {
      const english = pagesByLocale.get('en').get(page);
      if (english === undefined) continue;
      for (const locale of ['ja', 'zh-cn']) {
        const translated = pagesByLocale.get(locale).get(page);
        if (translated !== undefined) pagesByLocale.get(locale).set(page, normalizeFences(translated, english));
      }
    }

    for (const locale of LOCALES) {
      for (const [page, contents] of pagesByLocale.get(locale)) {
        const localePrefix = locale === 'en' ? '' : `${locale}/`;
        output.push({ path: join(process.cwd(), 'src/content/docs', localePrefix, `${page}.md`), contents });
      }
    }
    for (const source of await markdownFiles(specRoot)) {
      output.push({
        path: join(process.cwd(), '..', 'docs/spec', relative(specRoot, source)),
        contents: transformSpecSource(await readFile(source, 'utf8')),
      });
    }

    for (const file of output) await mkdir(dirname(file.path), { recursive: true });
    for (const file of output) await writeFile(file.path, file.contents);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

async function markdownFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(path);
  }
  return files.sort();
}

function transformPage(markdown, { locale, page }) {
  let transformed = FENCE_PAGES.has(page) ? repairFenceClosers(markdown) : markdown;
  transformed = replaceCurrentVersion(transformed, page);
  transformed = transformed.replaceAll('Tsubaki01', 'kotarotsubaki');
  transformed = transformed.replaceAll('{#implemented-in-0-2-0}', '{#implemented}');
  if (page === 'explanation/status-and-roadmap') transformed = renameImplementedHeading(transformed, locale);
  return PLANNED_PAGES.has(page) ? injectPlannedFrontmatter(transformed) : transformed;
}

function repairFenceClosers(markdown) {
  return markdown.replace(/^( {0,3})(`{3,}|~{3,})[^\n]*\n([\s\S]*?)(`{3,}|~{3,})(?=\n|$)/gm,
    (source, _indent, opener, body, closer) => {
      if (opener[0] !== closer[0] || closer.length < opener.length) return source;
      return `${source.slice(0, source.length - closer.length)}${body.endsWith('\n') ? '' : '\n'}${closer}`;
    });
}

function transformSpecSource(markdown) {
  return replaceCurrentVersion(markdown, 'spec').replace(/\[vault:[^\]]*\]/g, '');
}

function replaceCurrentVersion(markdown, page) {
  if (HISTORICAL_VERSION_PAGES.has(page)) return markdown;
  return markdown.replace(/0\.2\.0(?:-in-0\.2\.0)?/g, '0.3.1');
}

function renameImplementedHeading(markdown, locale) {
  const headings = {
    en: 'Implemented in current release',
    ja: '現行リリースで実装済み',
    'zh-cn': '当前版本已实现',
  };
  return markdown.replace(/^## .* \{#implemented\}$/m, `## ${headings[locale]} {#implemented}`);
}

function injectPlannedFrontmatter(markdown) {
  const match = /^(---\n)([\s\S]*?)(\n---(?:\n|$))/.exec(markdown);
  if (!match) throw new Error('Expected frontmatter on planned page');
  let frontmatter = match[2];
  if (!/^status:\s*planned\s*$/m.test(frontmatter)) {
    frontmatter = /^sidebar:/m.test(frontmatter)
      ? frontmatter.replace(/^sidebar:/m, 'status: planned\nsidebar:')
      : `${frontmatter}\nstatus: planned`;
  }
  if (!/^sidebar:\n(?:.*\n)*? {2}badge:/m.test(frontmatter)) {
    frontmatter = `${frontmatter}\nsidebar:\n  badge:\n    text: Planned\n    variant: caution`;
  }
  return `${match[1]}${frontmatter}${match[3]}${markdown.slice(match[0].length)}`;
}

function normalizeFences(markdown, english) {
  const canonical = fencedRegions(english);
  let index = 0;
  const normalized = splitByCodeRegions(markdown).map((region) => {
    if (!region.isCode || !isFence(region.text)) return region.text;
    const replacement = canonical[index] ?? '';
    index += 1;
    return replacement;
  }).join('');
  if (index >= canonical.length) return normalized;

  const suffix = canonical.slice(index).join('\n\n');
  return `${normalized.replace(/\n*$/, '')}\n\n${suffix}\n`;
}

function fencedRegions(markdown) {
  return splitByCodeRegions(markdown)
    .filter((region) => region.isCode && isFence(region.text))
    .map((region) => region.text);
}

function isFence(text) {
  return /^ {0,3}(?:`{3,}|~{3,})/.test(text);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
