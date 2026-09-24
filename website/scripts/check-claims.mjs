import { fileURLToPath } from 'node:url';
import { readFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import GithubSlugger from 'github-slugger';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { listDocsCorpus, maskForClaims, normalizeClaimLine, claimHash } from './lib/docs-corpus.mjs';
import { HEADING_ID_PATTERN } from './lib/remark-heading-id.mjs';
import { LLMS_OUTPUT_PATHS } from './lib/llms.mjs';

const separator = /^(?:[\s,、，]*(?:(?:and\/or|and|or|および|及び|と|和|与|以及|或)[\s,、，]*)?)$/i;
const linkPattern = /\]\(((?:\/ambercast\/|https:\/\/kotarotsubaki\.github\.io\/ambercast\/)[^\s)]*)\)/g;
const required = ['rule', 'path', 'claimHash', 'scope', 'reason', 'owner', 'removeWhen'];
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g;
const START_TAG_PATTERN = /<[A-Za-z][^>]*>/g;
const ATTRIBUTE_PATTERN = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { throw new Error(`check-claims: cannot read ${path}: ${error.message}`); }
}

/**
 * Collects literal IDs from one mdast html node's raw source, whether the node is a
 * block-level HTML region or inline HTML in a paragraph. HTML comments are stripped
 * first so tag-shaped text such as `<!-- <a id="x"> -->` cannot become an anchor.
 * Each start tag matching `<[A-Za-z][^>]*>` has its attributes tokenized in sequence;
 * consuming each quoted name=value pair whole prevents `id="x"` inside another
 * attribute's value, such as `title='id="x"'`, from being counted as an id attribute.
 * Only attributes named exactly `id` contribute values; values may use single or
 * double quotes. The tag-boundary pattern does not handle an unescaped `>` inside an
 * attribute value, as in `<a title="a > b" id="x">`.
 *
 * @param {string} value Raw source text of one mdast html node.
 * @returns {string[]} Values of literal id attributes on matched start tags.
 */
function idsFromHtml(value) {
  const withoutComments = value.replace(HTML_COMMENT_PATTERN, '');
  const ids = [];
  for (const tag of withoutComments.match(START_TAG_PATTERN) ?? []) {
    for (const attribute of tag.matchAll(ATTRIBUTE_PATTERN)) {
      if (attribute[1] === 'id') ids.push(attribute[2] ?? attribute[3]);
    }
  }
  return ids;
}

/**
 * Parses markdown once into an mdast tree and collects literal IDs from html nodes
 * alongside heading anchors. Headings retain explicit `{#id}` precedence; otherwise
 * their text and inline-code content feeds github-slugger in document order. Distinct
 * html, inlineCode, and code node types keep `id="…"` in inline or block code out of
 * the HTML anchor collection without a separate masking pass.
 *
 * @param {string} markdown Complete Markdown source for one page.
 * @returns {Set<string>} Literal HTML IDs and heading-derived anchors.
 */
function headingAnchors(markdown) {
  const tree = fromMarkdown(markdown);
  const anchors = new Set();
  function collectHtmlIds(node) {
    if (node.type === 'html') for (const id of idsFromHtml(node.value)) anchors.add(id);
    for (const child of node.children ?? []) collectHtmlIds(child);
  }
  collectHtmlIds(tree);
  const slugger = new GithubSlugger();
  function visit(node) {
    if (node.type === 'heading') {
      const last = node.children.at(-1);
      const explicit = last?.type === 'text' && HEADING_ID_PATTERN.exec(last.value);
      if (explicit) anchors.add(explicit[1]);
      else {
        const values = [];
        function collect(child) {
          if (child.type === 'text' || child.type === 'inlineCode') values.push(child.value);
          else for (const grandchild of child.children ?? []) collect(grandchild);
        }
        for (const child of node.children) collect(child);
        anchors.add(slugger.slug(values.join('')));
      }
    }
    for (const child of node.children ?? []) visit(child);
  }
  visit(tree);
  return anchors;
}

async function resolveLink(repoRoot, url, anchorsCache) {
  const withoutOrigin = url.replace(/^https:\/\/kotarotsubaki\.github\.io/, '');
  const [pathPart, fragment] = withoutOrigin.split(/(?<!\\)#/, 2);
  const rest = pathPart.split('?', 1)[0].slice('/ambercast/'.length).replace(/\/+$/, '');
  const finalSegment = rest.split('/').at(-1);
  if (rest.split('/').some((segment) => segment === '.' || segment === '..')) {
    return finalSegment?.includes('.') ? 'link-missing-artifact' : 'link-missing-page';
  }
  if (finalSegment?.includes('.')) {
    const target = join(repoRoot, 'website/public', rest);
    try { await access(target); return null; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return LLMS_OUTPUT_PATHS.includes(rest) ? null : 'link-missing-artifact';
  }
  const candidates = rest.startsWith('spec/') ? [join(repoRoot, 'docs/spec', `${rest.slice(5)}.md`)] :
    ['.md', '.mdx', '/index.md', '/index.mdx'].map((suffix) => join(repoRoot, 'website/src/content/docs', `${rest || 'index'}${suffix}`));
  let target;
  for (const candidate of candidates) {
    try { await access(candidate); target = candidate; break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!target) return 'link-missing-page';
  if (!fragment) return null;
  if (!anchorsCache.has(target)) anchorsCache.set(target, headingAnchors(await readFile(target, 'utf8')));
  return anchorsCache.get(target).has(fragment) ? null : 'link-missing-fragment';
}

function enumerations(line, vocabulary, locale) {
  const tokens = [...line.matchAll(/`([^`]+)`/g)].filter((match) => vocabulary.has(match[1]));
  const groups = [];
  let group = [];
  for (const token of tokens) {
    if (group.length && !separator.test(line.slice(group.at(-1).index + group.at(-1)[0].length, token.index))) {
      if (group.length >= 3) groups.push(group);
      group = [];
    }
    group.push(token);
  }
  if (group.length >= 3) groups.push(group);
  return groups.filter((matches) => {
    const first = matches[0].index;
    const last = matches.at(-1).index + matches.at(-1)[0].length;
    const window = locale === 'ja' ? line.slice(last, last + 20) : line.slice(Math.max(0, first - 40), first);
    const markers = locale === 'ja' ? /のみ|だけ/g : locale === 'zh-cn' ? /仅|只|恰好/g : /\b(?:only|exactly)\b/gi;
    return [...window.matchAll(markers)].some((marker) => {
      const between = locale === 'ja' ? window.slice(0, marker.index) : window.slice(marker.index + marker[0].length);
      return !/\.\s|。|;/.test(between);
    });
  }).map((matches) => [...new Set(matches.map((match) => match[1]))].sort());
}

/**
 * Collects deterministic hard violations from source-role documents across locales.
 * The scan masks fences and HTML comments but retains inline code. It finds
 * three-or-more-token enumerations from the union of available and planned commands.
 * Separator and exclusivity-marker vocabularies are part of the claim contract.
 * The marker window anchors at the first token for English and Chinese, and at
 * the last token for Japanese; only sentence boundaries between the marker and
 * enumeration disqualify it.
 * Only a marked token set differing from available commands
 * violates command-enumeration; expected and actual are sorted sets.
 *
 * The same masked lines yield local and canonical absolute site links. The
 * resolver splits at the first unescaped hash, strips a trailing page slash, treats a
 * dotted final segment as an artifact under public/ or a declared llms output, and
 * otherwise resolves spec pages or the first existing Markdown/MDX page candidate.
 * Target-page fragments use ATX headings: a trailing text-child explicit anchor takes
 * precedence; otherwise text and inline-code descendants feed one github-slugger
 * instance per file in document order. Literal id attributes count only on real HTML
 * tags, not in inline or block code, HTML comments, or another attribute's quoted
 * value. Missing artifacts, pages, and fragments remain distinct violations.
 *
 * Hard allowlist entries suppress only matching rule/path/claimHash findings. Invalid
 * entries, including every identifier-hit entry, violate allowlist-invalid; unmatched
 * hard entries violate allowlist-stale. Zero source files violate corpus-empty, even
 * when goldens exist. Required-input read or parse errors propagate to main so partial
 * findings cannot appear as a successful scan.
 *
 * @param {{ repoRoot?: string }} [options] Repository root, defaulting to the website parent.
 * @returns {Promise<Array<{ check: 'claims', page: string, line: number, rule: string, expected: string, actual: string }>>}
 * Sorted violations.
 */
export async function checkClaims({ repoRoot } = {}) {
  repoRoot = resolve(repoRoot ?? '..');
  const capabilities = await readJson(join(repoRoot, 'website/public/capabilities.json'));
  const allowlist = await readJson(join(repoRoot, 'website/docs-audit-allowlist.json'));
  const corpus = await listDocsCorpus({ repoRoot });
  const sources = corpus.filter(({ role }) => role === 'source');
  const findings = [];
  const anchorsCache = new Map();
  let links = 0;
  const add = (page, line, rule, expected, actual, hash) => findings.push({ check: 'claims', page, line, rule, expected, actual, claimHash: hash });
  if (!sources.length) add('', 0, 'corpus-empty', 'at least one source', 'none', '');
  const commands = new Set(capabilities.commands);
  const vocabulary = new Set([...capabilities.commands, ...capabilities.planned]);
  for (const { path, locale } of sources) {
    let markdown;
    try { markdown = await readFile(join(repoRoot, path), 'utf8'); }
    catch (error) { throw new Error(`check-claims: cannot read ${path}: ${error.message}`); }
    const masked = maskForClaims(markdown);
    const lines = masked.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const hash = claimHash(normalizeClaimLine(line));
      for (const tokens of enumerations(line, vocabulary, locale)) {
        if (tokens.join(',') !== [...commands].sort().join(',')) add(path, index + 1, 'command-enumeration', [...commands].sort().join(', '), tokens.join(', '), hash);
      }
      for (const match of line.matchAll(linkPattern)) {
        links += 1;
        const rule = await resolveLink(repoRoot, match[1], anchorsCache);
        if (rule) add(path, index + 1, rule, 'resolvable link', match[1], hash);
      }
    }
  }
  checkClaims.lastCounts = { sources: sources.length, links };
  const valid = [];
  if (!Array.isArray(allowlist)) add('website/docs-audit-allowlist.json', 0, 'allowlist-invalid', 'array', JSON.stringify(allowlist), '');
  const hardRules = new Set(['command-enumeration', 'link-missing-page', 'link-missing-fragment', 'link-missing-artifact']);
  const advisoryRules = new Set(['planned-claim', 'universal-claim']);
  for (const [index, entry] of (Array.isArray(allowlist) ? allowlist : []).entries()) {
    if (!required.every((key) => typeof entry?.[key] === 'string' && entry[key].trim()) ||
        (entry.scope === 'hard' ? !hardRules.has(entry.rule) : entry.scope === 'advisory' ? !advisoryRules.has(entry.rule) : true) ||
        !/^[0-9a-f]{16}$/.test(entry.claimHash)) {
      add('website/docs-audit-allowlist.json', index + 1, 'allowlist-invalid', 'complete valid entry', JSON.stringify(entry), '');
    } else valid.push(entry);
  }
  const raw = findings.slice();
  const kept = findings.filter((finding) => !valid.some((entry) => entry.scope === 'hard' && entry.rule === finding.rule && entry.path === finding.page && entry.claimHash === finding.claimHash));
  for (const entry of valid.filter(({ scope }) => scope === 'hard')) {
    if (!raw.some((finding) => entry.rule === finding.rule && entry.path === finding.page && entry.claimHash === finding.claimHash)) {
      kept.push({ check: 'claims', page: entry.path, line: 0, rule: 'allowlist-stale', expected: entry.rule, actual: entry.claimHash });
    }
  }
  return kept.map(({ claimHash: _hash, ...finding }) => finding).sort((a, b) => a.page.localeCompare(b.page) || a.line - b.line || a.rule.localeCompare(b.rule));
}

/**
 * Presents the hard checker with the same website-root convention as check-reference.
 * The CLI accepts --repo-root, writes sorted violations as JSONL, and exits
 * 0 or 1 according to their presence. A completed scan also reports source-file and
 * extracted-link counts on stderr, including links with valid targets. Required-input
 * failures instead leave stdout empty, print a path-bearing cannot-read diagnostic
 * on stderr, and set exit 2; they are never converted to documentation violations.
 *
 * @returns {Promise<void>} Process output and exit status are the CLI contract.
 */
export async function main() {
  let repoRoot = resolve('..');
  if (process.argv.length > 2) {
    if (process.argv.length !== 4 || process.argv[2] !== '--repo-root' || !process.argv[3]) {
      process.stderr.write('check-claims: cannot read arguments: invalid arguments\n');
      process.exitCode = 2;
      return;
    }
    repoRoot = resolve(process.argv[3]);
  }
  try {
    const findings = await checkClaims({ repoRoot });
    for (const finding of findings) process.stdout.write(`${JSON.stringify(finding)}\n`);
    const { sources, links } = checkClaims.lastCounts;
    process.stderr.write(`check-claims: scanned ${sources} source files, ${links} links\n`);
    process.exitCode = findings.length ? 1 : 0;
  } catch (error) {
    process.stderr.write(`${error.message.startsWith('check-claims: cannot read') ? error.message : `check-claims: cannot read input: ${error.message}`}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
