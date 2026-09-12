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
 * anchors, code blocks, and table-row counts, plus how-it-works figure JSON structure. A violation
 * is `{ locale, page, rule, expected, actual }`, sorted by rule, page, then locale before
 * output so runs are deterministic.
 *
 * One checker owns these related invariants because they require the same page, anchor, fence,
 * and table extraction primitives; separate checkers would duplicate boundary-sensitive parsing.
 * The how-it-works figure JSON checks validate each locale before comparing its structure,
 * and a read or parse failure never changes the documentation tree.
 *
 * @typedef {{ locale: string, page: string, rule: string, expected: string, actual: string }} Violation
 */

/**
 * Collects every structural parity violation without formatting it for a terminal.
 *
 * The comparison reads the locale trees and how-it-works figure JSON selected by `options`
 * and returns violations sorted by rule, page, then locale. Figure JSON violations use
 * `figure-json-shape` and `figure-json-read` with `data/how-it-works/<locale>` pages, and
 * `figure-json-keys`, `figure-json-nodes`, and `figure-json-edges` with
 * `data/how-it-works/<figureKey>` pages. Any number of schema defects in one file collapses to
 * one `figure-json-shape` violation for that locale. A malformed or missing English baseline
 * produces that single shape violation for `data/how-it-works/en`, rather than one per locale, and
 * ends figure comparison because neither localized file has a valid baseline.
 *
 * @example
 * const violations = await checkParity({ docsRoot, specRoot, dataRoot });
 *
 * @remarks
 * Keeping this boundary separate lets callers assert the stable structured result while the CLI
 * remains responsible only for presentation and its non-zero status. Missing localized figure
 * JSON is a `figure-json-read` violation, while a missing English baseline is a
 * `figure-json-shape` violation. Cross-locale key, node-id, and edge-triple rules run only
 * after the English baseline and the compared locale independently pass shape validation. Any
 * other I/O failure while reading documentation or figure JSON rejects instead of becoming a
 * violation.
 *
 * @param {object} [options] Input locations and comparison options for the documentation trees.
 * @param {string} [options.docsRoot=resolve(process.cwd(), 'src/content/docs')] Root directory
 * for the English and localized documentation trees.
 * @param {string} [options.specRoot=resolve(process.cwd(), '../docs/spec')] Root directory for
 * the English specification tree.
 * @param {string} [options.dataRoot] Root directory for the English and localized how-it-works
 * figure JSON files. The default resolves to `src/data/how-it-works`.
 * @returns {Promise<Violation[]>} Every documentation and figure-JSON violation in
 * deterministic order.
 */
export async function checkParity(options = {}) {
  const docsRoot = options.docsRoot ?? resolve(process.cwd(), 'src/content/docs');
  const specRoot = options.specRoot ?? resolve(process.cwd(), '../docs/spec');
  const dataRoot = options.dataRoot ?? resolve(process.cwd(), 'src/data/how-it-works');
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

  // Shape validation prevents malformed JSON from being interpreted as structural drift. English
  // supplies the single baseline, so no localized comparison is meaningful without it.
  const englishIntro = await readIntroData(join(dataRoot, 'en.json'));
  if (englishIntro.status !== 'valid') {
    introViolation(violations, 'en', 'figure-json-shape', 'valid', 'invalid');
  } else {
    for (const locale of ['ja', 'zh-cn']) {
      const localizedIntro = await readIntroData(join(dataRoot, `${locale}.json`));
      if (localizedIntro.status === 'missing') {
        introViolation(violations, locale, 'figure-json-read', 'present', 'absent');
        continue;
      }
      if (localizedIntro.status !== 'valid') {
        introViolation(violations, locale, 'figure-json-shape', 'valid', 'invalid');
        continue;
      }
      compareIntroData(violations, locale, englishIntro.data, localizedIntro.data);
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

/**
 * Reads and validates one locale's how-it-works figure file without leaking parser detail into the
 * parity result.
 *
 * A missing file remains distinguishable from invalid JSON or an invalid figure shape so the
 * caller can preserve the asymmetric baseline contract: missing localized data becomes
 * `figure-json-read`, while a missing English baseline becomes `figure-json-shape`. Parse failure
 * and every schema defect returns the same invalid status, allowing the caller to emit exactly
 * one shape violation for the locale; unrelated file-system failures still reject.
 *
 * @param {string} path Absolute or caller-resolved path to one locale JSON file.
 * @returns {Promise<{ status: 'missing' } | { status: 'invalid' } | { status: 'valid', data: object }>}
 * The file's normalized read/validation state.
 */
async function readIntroData(path) {
  let source;
  try {
    source = await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { status: 'missing' };
    throw error;
  }

  try {
    const data = JSON.parse(source);
    return isIntroData(data) ? { status: 'valid', data } : { status: 'invalid' };
  } catch {
    return { status: 'invalid' };
  }
}

/**
 * Determines whether every figure value satisfies the complete how-it-works data schema.
 *
 * The validator requires a plain top-level object while leaving its key set to
 * `figure-json-keys`. Each figure requires `caption` to be null or a string, a non-empty string
 * `alt`, node records whose `id`, `label`, and `text` are strings with unique ids, and edge records
 * whose `from`, `to`, and `label` are strings and whose direction is exactly `forward`. Every edge
 * endpoint references a declared node id, and each `(from, to, direction)` triple is unique.
 * Returning one boolean for the whole file is deliberate: the caller collapses one
 * or many defects into a single `figure-json-shape` violation for that locale.
 *
 * @param {unknown} data Parsed JSON value.
 * @returns {boolean} Whether the complete file shape is safe for structural comparison.
 */
function isIntroData(data) {
  return isPlainObject(data) && Object.values(data).every((figure) => {
    if (!isPlainObject(figure) || (figure.caption !== null && typeof figure.caption !== 'string') || typeof figure.alt !== 'string' || figure.alt.length === 0 || !Array.isArray(figure.nodes) || !Array.isArray(figure.edges)) return false;

    const nodeIds = new Set();
    for (const node of figure.nodes) {
      if (!isPlainObject(node) || ![node.id, node.label, node.text].every((value) => typeof value === 'string') || nodeIds.has(node.id)) return false;
      nodeIds.add(node.id);
    }

    const edgeTriples = new Set();
    for (const edge of figure.edges) {
      if (!isPlainObject(edge) || ![edge.from, edge.to, edge.label].every((value) => typeof value === 'string') || edge.direction !== 'forward' || !nodeIds.has(edge.from) || !nodeIds.has(edge.to)) return false;
      const triple = JSON.stringify([edge.from, edge.to, edge.direction]);
      if (edgeTriples.has(triple)) return false;
      edgeTriples.add(triple);
    }

    return true;
  });
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}

/**
 * Appends one locale-level how-it-works figure violation using the stable public page namespace.
 *
 * Centralizing this projection keeps missing/invalid file reporting at one violation per
 * locale even when validation detects multiple defects, while comparison-specific violations use
 * their figure-key pages separately.
 *
 * @param {Violation[]} violations Mutable result accumulator.
 * @param {string} locale Locale whose figure file failed reading or shape validation.
 * @param {string} rule `figure-json-read` or `figure-json-shape`.
 * @param {string} expected Stable expected-value description.
 * @param {string} actual Stable observed-value description.
 * @returns {void}
 */
function introViolation(violations, locale, rule, expected, actual) {
  violations.push({ locale, page: `data/how-it-works/${locale}`, rule, expected, actual });
}

/**
 * Compares one independently shape-valid locale with the independently shape-valid English
 * how-it-works figure baseline.
 *
 * The comparison reports top-level key, node-id, and `(from, to, direction)` set drift through
 * `figure-json-keys`, `figure-json-nodes`, and `figure-json-edges`. Node ids use
 * `JSON.stringify(id)`, and edge triples use `JSON.stringify([from, to, direction])`, before
 * the existing sorting and newline-joined comparison. Unlike delimiter-joined keys, this
 * representation cannot confuse distinct arbitrary-string fields containing `|` or newlines.
 * The caller enforces the two-valid-input precondition so no structural drift rule fires for
 * data whose shape is already unsafe to inspect.
 *
 * @param {Violation[]} violations Mutable result accumulator.
 * @param {string} locale Compared locale.
 * @param {object} expectedData Shape-valid English figure data.
 * @param {object} actualData Shape-valid localized figure data.
 * @returns {void}
 */
function compareIntroData(violations, locale, expectedData, actualData) {
  const expectedKeys = sortedSet(Object.keys(expectedData));
  const actualKeys = sortedSet(Object.keys(actualData));
  const keyDifference = firstSetDifference(expectedKeys, actualKeys);
  if (keyDifference !== undefined) {
    compare(violations, locale, `data/how-it-works/${keyDifference}`, 'figure-json-keys', expectedKeys, actualKeys);
  }

  const actualKeySet = new Set(actualKeys);
  for (const key of expectedKeys) {
    if (!actualKeySet.has(key)) continue;
    compare(
      violations,
      locale,
      `data/how-it-works/${key}`,
      'figure-json-nodes',
      sortedSet(expectedData[key].nodes.map((node) => JSON.stringify(node.id))),
      sortedSet(actualData[key].nodes.map((node) => JSON.stringify(node.id))),
    );
    compare(
      violations,
      locale,
      `data/how-it-works/${key}`,
      'figure-json-edges',
      sortedSet(expectedData[key].edges.map((edge) => JSON.stringify([edge.from, edge.to, edge.direction]))),
      sortedSet(actualData[key].edges.map((edge) => JSON.stringify([edge.from, edge.to, edge.direction]))),
    );
  }
}

function firstSetDifference(expected, actual) {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  return expected.find((value) => !actualSet.has(value)) ?? actual.find((value) => !expectedSet.has(value));
}

function sortedSet(values) {
  return [...new Set(values)].sort();
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
