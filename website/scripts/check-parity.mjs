import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative, resolve } from 'node:path';
import { splitByCodeRegions } from './lib/wikilinks.mjs';

/**
 * Verifies that localized documentation remains structurally equivalent to the root locale.
 *
 * The checker compares page sets; explicit anchor sets and order; fence content (with the
 * setup-prompt URL-only carve-out); `status` and sidebar badges; reference-table identifiers
 * (inline-code content only, except for two anchor-scoped identifier tables that use their full
 * first cell); and the specification chapters'
 * anchors, code blocks, and table-row counts. A violation is `{ locale, page, rule, expected,
 * actual }`, sorted by rule, page, then locale before output so runs are deterministic.
 *
 * One checker owns these related invariants because they require the same page, anchor, fence,
 * and table extraction primitives; separate checkers would duplicate boundary-sensitive parsing.
 * A read or parse failure never changes the documentation tree.
 *
 * @typedef {{ locale: string, page: string, rule: string, expected: string, actual: string }} Violation
 */

/**
 * Collects every structural parity violation without formatting it for a terminal.
 *
 * Keeping this boundary separate lets callers assert the stable structured result while the CLI
 * remains responsible only for presentation and its non-zero status. The comparison reads the
 * locale trees selected by `options` and returns violations sorted by rule, page, then locale.
 *
 * @param {object} [options] Input locations and comparison options for the documentation trees.
 * @returns {Promise<Violation[]>} Every detected violation in deterministic order.
 */
export async function checkParity(options = {}) {
  const docsRoot = options.docsRoot ?? resolve(process.cwd(), 'src/content/docs');
  const specRoot = options.specRoot ?? resolve(process.cwd(), '../docs/spec');
  const rootPages = await readPages(docsRoot, (page) => !page.startsWith('ja/') && !page.startsWith('zh-cn/') && !page.startsWith('spec/'));
  const violations = [];

  for (const locale of ['ja', 'zh-cn']) {
    const localizedPages = await readPages(join(docsRoot, locale), (page) => !page.startsWith('spec/'));
    comparePageSets(rootPages, localizedPages, locale, violations);
    for (const [page, expected] of rootPages) {
      const actual = localizedPages.get(page);
      if (actual === undefined) continue;
      compare(violations, locale, page, 'anchor-order', anchors(expected), anchors(actual));
      if (page === 'agents/setup-prompt') {
        compareSetupPromptFences(violations, locale, page, fences(expected), fences(actual));
      } else {
        compareFences(violations, locale, page, fences(expected), fences(actual));
      }
      compare(violations, locale, page, 'frontmatter', [frontmatter(expected)], [frontmatter(actual)]);
      if (page.startsWith('reference/')) {
        compare(violations, locale, page, 'table-identifiers', tableIdentifiers(expected, page), tableIdentifiers(actual, page));
      }
    }
  }

  const specPages = await readPages(specRoot);
  for (const locale of ['ja', 'zh-cn']) {
    const localizedSpecs = await readPages(join(docsRoot, locale, 'spec'));
    comparePageSets(specPages, localizedSpecs, locale, violations, 'spec/');
    for (const [page, expected] of specPages) {
      const actual = localizedSpecs.get(page);
      if (actual === undefined) continue;
      const actualMarkdown = actual;
      compare(violations, locale, `spec/${page}`, 'spec-anchors', anchors(expected), anchors(actualMarkdown));
      compareFences(violations, locale, `spec/${page}`, fences(expected), fences(actualMarkdown), 'spec-code-blocks');
      compare(violations, locale, `spec/${page}`, 'spec-table-rows', tableRowCounts(expected).map(String), tableRowCounts(actualMarkdown).map(String));
    }
  }

  return violations.sort((left, right) => left.rule.localeCompare(right.rule) || left.page.localeCompare(right.page) || left.locale.localeCompare(right.locale));
}

async function readPages(root, include = () => true) {
  const files = await markdownFiles(root);
  const pages = new Map();
  for (const file of files) {
    const page = relative(root, file).replace(/\\/g, '/').replace(/\.mdx?$/, '');
    if (include(page) && !pages.has(page)) pages.set(page, await readFile(file, 'utf8'));
  }
  return pages;
}

async function markdownFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const files = await Promise.all(entries.sort((left, right) => left.name.localeCompare(right.name)).map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return /\.mdx?$/.test(entry.name) ? [path] : [];
  }));
  return files.flat();
}

function comparePageSets(expectedPages, actualPages, locale, violations, pagePrefix = '') {
  for (const page of expectedPages.keys()) {
    if (!actualPages.has(page)) violations.push({ locale, page: `${pagePrefix}${page}`, rule: 'page-set', expected: 'present', actual: 'absent' });
  }
  for (const page of actualPages.keys()) {
    if (!expectedPages.has(page)) violations.push({ locale, page: `${pagePrefix}${page}`, rule: 'page-set', expected: 'absent', actual: 'present' });
  }
}

function compare(violations, locale, page, rule, expected, actual) {
  const expectedText = expected.join('\n');
  const actualText = actual.join('\n');
  if (expectedText !== actualText) violations.push({ locale, page, rule, expected: expectedText, actual: actualText });
}

function anchors(markdown) {
  return [...markdown.matchAll(/\{#([A-Za-z0-9_-]+)\}/g)].map((match) => match[1]);
}

function fences(markdown) {
  return splitByCodeRegions(markdown)
    .filter((region) => region.isCode && /^( {0,3})(`{3,}|~{3,})/.test(region.text))
    .map((region) => region.text.split('\n').slice(1, -1).join('\n'));
}

function compareFences(violations, locale, page, expected, actual, rule = 'fence-content') {
  if (expected.length === actual.length && expected.every((fence, index) => fence === actual[index])) return;
  const expectedText = expected.join('\n');
  const actualText = actual.join('\n');
  if (expectedText !== actualText) {
    violations.push({ locale, page, rule, expected: expectedText, actual: actualText });
    return;
  }
  violations.push({ locale, page, rule, expected: JSON.stringify(expected), actual: JSON.stringify(actual) });
}

function compareSetupPromptFences(violations, locale, page, expected, actual) {
  const matches = expected.length === actual.length && expected.every((fence, index) => sameSetupPromptFence(fence, actual[index]));
  if (!matches) compareFences(violations, locale, page, expected, actual);
}

function sameSetupPromptFence(expected, actual) {
  const expectedLines = expected.split('\n');
  const actualLines = actual.split('\n');
  if (expectedLines.length !== actualLines.length) return false;
  return expectedLines.every((line, index) => nonUrlTokens(line).join(' ') === nonUrlTokens(actualLines[index]).join(' '));
}

function nonUrlTokens(line) {
  return line.trim().split(/\s+/).filter((token) => token && !/^https?:\/\/\S+$/.test(token));
}

function frontmatter(markdown) {
  const block = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown)?.[1] ?? '';
  const status = valueFor(block, /^status:\s*(.+)$/m);
  const sidebar = /(?:^|\n)sidebar:\s*\n((?:[ \t].*(?:\n|$))*)/.exec(block)?.[1] ?? '';
  const badge = valueFor(sidebar, /^\s*badge:\s*(.+)$/m) ?? valueFor(sidebar, /^\s*text:\s*(.+)$/m);
  return `{\"status\":${displayValue(status)},\"sidebar.badge\":${displayValue(badge)}}`;
}

function valueFor(text, expression) {
  const value = expression.exec(text)?.[1]?.trim();
  return value === undefined ? undefined : value.replace(/^(['\"])(.*)\1$/, '$2');
}

function displayValue(value) {
  return value === undefined ? 'undefined' : JSON.stringify(value);
}

function tableIdentifiers(markdown, page) {
  const identifiers = new Set();
  const fallbackTable = fallbackTableStartLine(markdown, page);
  for (const { lines, startLine } of tables(markdown)) {
    for (const row of lines.slice(2)) {
      const cell = tableCells(row)[0]?.trim() ?? '';
      if (!cell) continue;
      const codeSpans = splitByCodeRegions(cell).filter((region) => region.isCode && /^`+/.test(region.text));
      if (codeSpans.length > 0) {
        for (const codeSpan of codeSpans) identifiers.add(codeSpan.text.replace(/^`+|`+$/g, ''));
      } else if (startLine === fallbackTable) identifiers.add(cell);
    }
  }
  return [...identifiers].sort();
}

function tableRowCounts(markdown) {
  return tables(markdown).map(({ lines }) => lines.length - 2);
}

function tables(markdown) {
  const prose = splitByCodeRegions(markdown)
    .map((region) => region.isCode ? region.text.replace(/[^\n]/g, '') : region.text)
    .join('');
  const result = [];
  const lines = prose.split('\n');
  const sourceLines = markdown.split('\n');
  for (let index = 0; index + 1 < lines.length; index += 1) {
    if (!lines[index].includes('|') || !/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1])) continue;
    const startLine = index;
    const table = [sourceLines[index], sourceLines[index + 1]];
    while (lines[index + 2]?.includes('|')) table.push(sourceLines[++index + 1]);
    result.push({ lines: table, startLine });
  }
  return result;
}

function fallbackTableStartLine(markdown, page) {
  const anchor = page === 'reference/exit-codes'
    ? 'exit-code-table'
    : page === 'reference/error-codes'
      ? 'code-vocabulary'
      : undefined;
  if (!anchor) return undefined;

  const lines = markdown.split('\n');
  const headingLine = lines.findIndex((line) => new RegExp(`^##(?!#)\\s+.*\\{#${anchor}\\}\\s*$`).test(line));
  if (headingLine < 0) return undefined;
  const nextH2 = lines.findIndex((line, index) => index > headingLine && /^##(?!#)(?:\s|$)/.test(line));
  return tables(markdown).find(({ startLine }) => startLine > headingLine && (nextH2 < 0 || startLine < nextH2))?.startLine;
}

function tableCells(line) {
  return line.trim().replace(/^\||\|$/g, '').split('|');
}

/**
 * Projects structured parity violations to stdout and signals failure when any exist.
 *
 * @returns {Promise<void>} Resolves after reporting the complete parity result.
 */
export async function main() {
  const violations = await checkParity();
  for (const violation of violations) {
    process.stdout.write(`${JSON.stringify(violation)}\n`);
  }
  if (violations.length > 0) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
