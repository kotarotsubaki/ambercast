// The checker returns complete results before presentation so an input or tool
// failure can never expose partial findings as a successful scan.

import { readFileSync, accessSync, constants, readdirSync, copyFileSync, rmSync, mkdirSync, mkdtempSync, lstatSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { parseProseTree, stripFrontmatterOffset, extractTextBlocks } from './lib/prose-text.mjs';
import {
  headingDepth,
  h3Count,
  requiredAnchors,
  bannedTerm,
  calloutCount,
  relatedLinkcardOnly,
  sentenceLength,
  paragraphSentences,
  pageLength,
  passiveDensity,
  noThematicBreak
} from './lib/prose-rules.mjs';
import { selectChanges, newViolations } from './lib/changed-pages.mjs';

const GROUPS = ['start-here', 'tutorials', 'how-to', 'explanation', 'reference', 'spec', 'agents'];
const LOCALES = ['en', 'ja', 'zh-cn'];
// Path lists and diagnostics are bounded; archive content travels through disk.
const MAX_CHILD_OUTPUT = 64 * 1024 * 1024;
const REQUIRED_LIMITS = ['h3Max', 'calloutMax', 'paragraphSentencesMax', 'passiveRatioWarn'];
const REQUIRED_SENTENCE_LOCALES = ['en', 'ja', 'zh-cn'];
const RULES = [headingDepth, h3Count, requiredAnchors, bannedTerm, calloutCount,
  relatedLinkcardOnly, sentenceLength, paragraphSentences, pageLength,
  passiveDensity, noThematicBreak];
const RULE_NAMES = ['heading-depth', 'h3-count', 'required-anchors', 'banned-term',
  'callout-count', 'related-linkcard-only', 'sentence-length', 'paragraph-sentences',
  'page-length', 'passive-density', 'no-thematic-break'];

function tagged(code, message) {
  return Object.assign(new Error(message), { code });
}

function firstLine(message) {
  return String(message ?? '').split(/\r?\n/).map((line) => line.trim()).find(Boolean);
}

function git(repoRoot, args, code = 'tool-failure') {
  const result = spawnSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd: repoRoot, encoding: 'utf8', maxBuffer: MAX_CHILD_OUTPUT,
  });
  if (result.error || result.status !== 0) {
    throw tagged(code, firstLine(result.error?.message) || firstLine(result.stderr) || 'git failed');
  }
  return result.stdout;
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function keys(value, allowed, required = allowed) {
  return object(value) && Object.keys(value).every((key) => allowed.includes(key)) &&
    required.every((key) => Object.hasOwn(value, key));
}

function uniqueStrings(value, pattern, nonempty = false) {
  return Array.isArray(value) && (!nonempty || value.length > 0) &&
    value.every((entry) => typeof entry === 'string' && pattern.test(entry)) &&
    new Set(value).size === value.length;
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function validConfig(config) {
  if (!keys(config, ['pages', 'limits', 'bannedTerms', 'requiredAnchors', 'severity'])) return false;
  const slugPattern = /^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/;
  if (!uniqueStrings(config.pages, slugPattern) ||
      !config.pages.every((slug) => { try { groupForSlug(slug); return true; } catch { return false; } })) return false;
  if (!uniqueStrings(config.bannedTerms, /\S/, true) ||
      !keys(config.requiredAnchors, GROUPS, []) ||
      !Object.values(config.requiredAnchors).every((ids) => uniqueStrings(ids, /^[a-z0-9-]+$/)) ||
      !keys(config.severity, Object.keys(config.severity ?? {}), []) ||
      !Object.values(config.severity).every((value) => ['error', 'warning', 'off'].includes(value))) return false;
  const limits = config.limits;
  if (!keys(limits, [...REQUIRED_LIMITS, 'sentence', 'words']) ||
      !['h3Max', 'calloutMax', 'paragraphSentencesMax'].every((key) => positiveInteger(limits[key])) ||
      typeof limits.passiveRatioWarn !== 'number' || !Number.isFinite(limits.passiveRatioWarn) ||
      limits.passiveRatioWarn <= 0 || limits.passiveRatioWarn >= 1 ||
      !keys(limits.sentence, REQUIRED_SENTENCE_LOCALES) ||
      !REQUIRED_SENTENCE_LOCALES.every((locale) => {
        const value = limits.sentence[locale];
        return keys(value, ['warn', 'error']) && positiveInteger(value.warn) &&
          positiveInteger(value.error) && value.warn < value.error;
      }) || !keys(limits.words, GROUPS, []) ||
      !Object.values(limits.words).every(positiveInteger)) return false;
  return true;
}

function exists(path) {
  try { accessSync(path, constants.F_OK); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw tagged('io-failure', error.message); }
}

function hasPage(docsRoot, slug) {
  return LOCALES.some((locale) => {
    const stem = join(docsRoot, locale === 'en' ? '' : locale, slug);
    return exists(`${stem}.md`) || exists(`${stem}.mdx`);
  });
}

function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Maps a validated page slug to one of the seven terminology-defined page groups.
 * Most groups match the slug's first path segment. The start-here group instead
 * contains the introduction, philosophy, and how-it-works root pages.
 * @param {string} slug Validated page slug.
 * @returns {'start-here'|'tutorials'|'how-to'|'explanation'|'reference'|'spec'|'agents'} Page group.
 */
function groupForSlug(slug) {
  const segments = slug.split('/');
  const first = segments[0];
  if (first === 'introduction' || first === 'philosophy' || first === 'how-it-works') {
    return 'start-here';
  }
  if (GROUPS.includes(first)) {
    return first;
  }
  throw new Error(`Invalid page group: ${first}`);
}

/**
 * Checks selected documentation pages independently for each locale and returns
 * sorted SPEC-2 violations. In report mode, the returned report is the SPEC-7
 * Markdown table over the full corpus; otherwise it is null. This read-only async
 * API writes neither stdout nor stderr, allowing direct callers to receive either
 * a complete result or a code-tagged rejection without subprocess fixtures.
 *
 * @remarks Validation precedes the preview-residue check, which precedes the
 * selection and empty-pages short circuit, then page-by-locale inspection. Checking
 * residue before returning for empty pages is required by SPEC-9. A failed config
 * read is `io-failure`; readable invalid JSON or shape is `config-invalid`.
 * Ambiguous or absent page variants are error violations, while an existing page
 * that cannot be read rejects with `io-failure`. Runner exceptions reject with
 * `tool-failure`. Deferring all output to main preserves SPEC-2's empty-stdout
 * guarantee on every exit-2 path, including failures after earlier pages passed.
 * The injected runners let tests exercise these paths, including tool-failure,
 * independently of the real textlint and zhlint Node API packages.
 * runners.textlint receives the original ja page file because textlint's Node API
 * lints files and reports line numbers directly against that original source.
 * runners.zhlint receives already-SPEC-3-extracted zh-cn text per paragraph because
 * zhlint has no Markdown or MDX awareness; its reported line is the extracting
 * paragraph's starting line.
 * Report mode ignores pages. Otherwise optional pages replaces config.pages and
 * bypasses the empty-config short circuit. Selected slugs use the existing slug
 * grammar and known groups, with no locale prefix or extension; invalid slugs
 * reject with page-invalid. Only
 * when the pages override is supplied (--page and --changed), a slug with no
 * file in any locale rejects with page-unknown, preventing typos from silently
 * passing. Configured-page inspection in plain and report modes keeps reporting
 * page-missing for every absent locale. With the override, one or two absent
 * locales also remain page-missing violations.
 * @param {{ docsRoot: string, configPath: string, report: boolean, runners: { textlint: Function, zhlint: Function }, pages?: string[] }} input Paths, report mode, injectable runners, and optional validated page selection.
 * @returns {Promise<{ violations: Array<import('./lib/prose-text.mjs').Violation>, report: string|null }>} Complete violations and optional table.
 * @throws {Error} A code-tagged error for config-invalid, io-failure,
 * tool-failure, preview-residue, page-invalid, or page-unknown.
 */
export async function checkProse({ docsRoot, configPath, report, runners, pages }) {
  let source;
  try { source = readFileSync(configPath, 'utf8'); }
  catch (error) { throw tagged('io-failure', error.message); }
  let config;
  try { config = JSON.parse(source); }
  catch (error) { throw tagged('config-invalid', error.message); }
  if (!validConfig(config)) throw tagged('config-invalid', 'Invalid prose lint configuration');
  if (exists(join(docsRoot, 'preview-blocks.mdx'))) {
    throw tagged('preview-residue', 'preview-blocks.mdx remains in the docs root');
  }
  if (!report && pages === undefined && config.pages.length === 0) return { violations: [], report: null };

  let slugs = config.pages;
  if (report) {
    let entries;
    try { entries = readdirSync(docsRoot, { recursive: true, withFileTypes: true }); }
    catch (error) { throw tagged('io-failure', error.message); }
    slugs = [...new Set(entries.filter((entry) => entry.isFile() && /\.mdx?$/.test(entry.name))
      .map((entry) => {
        const parent = entry.parentPath ?? entry.path;
        return relative(docsRoot, join(parent, entry.name)).replace(/\\/g, '/').replace(/\.mdx?$/, '');
      }).filter((slug) => !LOCALES.slice(1).some((locale) => slug.startsWith(`${locale}/`)) &&
        /^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(slug) &&
        (() => { try { groupForSlug(slug); return true; } catch { return false; } })()))];
  }

  if (!report && pages !== undefined) {
    slugs = selectPages(pages);

    // Resolve every selection before inspection so a typo wins over tool failures.
    for (const slug of slugs) {
      if (!hasPage(docsRoot, slug)) {
        throw tagged('page-unknown', `Page not found: ${slug}`);
      }
    }
  }

  const violations = [];
  for (const slug of slugs) {
    const group = groupForSlug(slug);
    for (const locale of LOCALES) {
      const stem = join(docsRoot, locale === 'en' ? '' : locale, slug);
      const md = `${stem}.md`;
      const mdx = `${stem}.mdx`;
      const hasMd = exists(md);
      const hasMdx = exists(mdx);
      if (hasMd && hasMdx || !hasMd && !hasMdx) {
        violations.push({ check: 'prose', locale, page: slug, line: null,
          rule: hasMd ? 'page-ambiguous' : 'page-missing', severity: 'error',
          expected: 'exactly one of .md/.mdx', actual: hasMd ? 'both' : 'neither' });
        continue;
      }
      const filePath = hasMd ? md : mdx;
      let markdown;
      try { markdown = readFileSync(filePath, 'utf8'); }
      catch (error) { throw tagged('io-failure', error.message); }
      const { body, frontmatterLineOffset } = stripFrontmatterOffset(markdown);
      const isMdx = hasMdx;
      const tree = parseProseTree(body, { isMdx });
      const lines = markdown.split('\n');
      const { textBlocks, calloutCount: asideCount } = extractTextBlocks(tree, lines, frontmatterLineOffset, isMdx);
      for (const block of textBlocks) {
        if (locale === 'en' && block.segments.length > 1) {
          block.joinedText = block.segments.map((segment) => segment.text).join(' ');
          let offset = 0;
          block.lineMap = block.segments.map((segment) => {
            const entry = { offset, line: segment.line };
            offset += segment.text.length + 1;
            return entry;
          });
        }
      }
      const ruleConfig = locale === 'en' ? config : { ...config, limits: { ...config.limits,
        words: Object.fromEntries(Object.entries(config.limits.words).map(([key, value]) => [key, value * 2])) } };
      const ctx = { tree, textBlocks, lines, frontmatterLineOffset, locale, group, config: ruleConfig, calloutCount: asideCount, isMdx };
      for (const rule of RULES) {
        for (const finding of rule(ctx)) {
          violations.push({ ...finding, page: slug });
        }
      }
      if (locale === 'ja') {
        let findings;
        try { findings = await runners.textlint([filePath]); }
        catch (error) { throw tagged('tool-failure', error.message); }
        for (const finding of findings) {
          const rule = `textlint:${finding.ruleId}`;
          const severity = config.severity[finding.ruleId] ?? (finding.severity === 2 ? 'error' : 'warning');
          if (severity !== 'off') violations.push({ check: 'prose', locale, page: slug,
            line: finding.line, rule, severity, expected: '', actual: finding.message });
        }
      }
      if (locale === 'zh-cn') {
        for (const block of textBlocks) {
          if (block.nodeType === 'heading') continue;
          let findings;
          try { findings = await runners.zhlint(block.zhlintText); }
          catch (error) { throw tagged('tool-failure', error.message); }
          for (const finding of findings) {
            violations.push({ check: 'prose', locale, page: slug,
              line: block.startLine ?? null, rule: 'zhlint', severity: 'error',
              expected: '', actual: finding.message });
          }
        }
      }
    }
  }
  violations.sort((a, b) => compare(a.page, b.page) ||
    compare(LOCALES.indexOf(a.locale), LOCALES.indexOf(b.locale)) ||
    compare(a.line ?? -1, b.line ?? -1) || compare(a.rule, b.rule) || compare(a.actual, b.actual));
  let table = null;
  if (report) {
    const columns = [...RULE_NAMES, 'textlint', 'zhlint', 'page-missing'];
    const header = ['group', 'locale', ...columns, 'total'];
    const rows = [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`];
    for (const group of GROUPS) for (const locale of LOCALES) {
      const groupFindings = violations.filter((v) => v.locale === locale && groupForSlug(v.page) === group);
      const counts = columns.map((column) => groupFindings.filter((v) =>
        column === 'textlint' ? v.rule.startsWith('textlint:') : v.rule === column).length);
      rows.push(`| ${[group, locale, ...counts, groupFindings.length].join(' | ')} |`);
    }
    table = `${rows.join('\n')}\n`;
  }
  return { violations, report: table };
}

/**
 * Validates and de-duplicates explicitly requested locale-independent slugs.
 *
 * @remarks Slugs match /^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/ and the existing known
 * groups, with no locale prefix or extension. Selection ignores config.pages
 * and addresses en, ja, and zh-cn together. Presence is checked by checkProse
 * after config validation and preview-residue detection, so unknown pages reject
 * with page-unknown while incomplete translations remain page-missing findings.
 * @param {string[]} pages Explicit --page values.
 * @returns {string[]} Validated, unique slugs.
 * @throws {Error} A page-invalid-tagged error for an invalid slug.
 */
function selectPages(pages) {
  const slugPattern = /^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/;
  if (!Array.isArray(pages)) {
    throw tagged('page-invalid', 'Pages must be an array of slugs');
  }
  for (const slug of pages) {
    if (typeof slug !== 'string' || !slugPattern.test(slug)) {
      throw tagged('page-invalid', `Invalid page: ${String(slug)}`);
    }
    try { groupForSlug(slug); } catch { throw tagged('page-invalid', `Invalid page group for: ${slug}`); }
  }
  return [...new Set(pages)];
}

/**
 * Parses the mutually exclusive plain, report, page, and changed CLI modes.
 *
 * @remarks Repeated --page values are allowed and de-duplicated. --changed accepts
 * --base, defaulting to origin/main; --base alone is invalid. --page is the only
 * repeatable flag; repeating --report, --changed, or --base is a usage error. Unknown arguments,
 * repeated mode flags, missing values, values starting with --, and combinations
 * of --report, --page, and --changed reject with usage before any output.
 * Slug validation belongs to page selection so it retains page-invalid rather
 * than becoming a usage diagnostic. Empty base values, values starting with -, and
 * values containing control characters reject with usage, keeping diagnostics
 * and successful summaries on one line.
 * @param {string[]} args Arguments excluding the executable and script paths.
 * @returns {{ mode: 'plain'|'report'|'page'|'changed', pages: string[], base: string }} Selected mode, unique page arguments, and base reference.
 * @throws {Error} A usage-tagged error for invalid argument combinations.
 */
function parseArguments(args) {
  let mode = 'plain';
  const pages = [];
  let base = 'origin/main';
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!['--report', '--page', '--changed', '--base'].includes(arg)) {
      throw tagged('usage', `Unknown argument: ${arg}`);
    }
    if (arg !== '--page' && seen.has(arg)) throw tagged('usage', `Repeated argument: ${arg}`);
    seen.add(arg);
    if (arg !== '--base') {
      const selected = arg.slice(2);
      if (mode !== 'plain' && mode !== selected) throw tagged('usage', 'Modes cannot be combined');
      mode = selected;
    }
    if (arg === '--base' || arg === '--page') {
      const value = args[++i];
      if (value === undefined || value.startsWith('--') ||
          (arg === '--base' && (!value || value.startsWith('-') || /[\u0000-\u001f\u007f-\u009f]/.test(value)))) {
        throw tagged('usage', `${arg} requires a value`);
      }
      if (arg === '--base') base = value;
      else pages.push(value);
    }
  }
  if (seen.has('--base') && mode !== 'changed') throw tagged('usage', '--base requires --changed');
  return { mode, pages: [...new Set(pages)], base };
}

/**
 * Collects working-tree changes relative to a resolved merge base.
 *
 * @remarks Resolution of ref^{commit} and its merge base with HEAD precedes
 * selection; either failure rejects with base-unresolved. git diff --name-status
 * -M -z <merge-base> includes committed, staged, and unstaged changes.
 * git diff --cached --name-status -M -z <merge-base> supplements provenance:
 * an index rename/copy replaces a working-tree addition and source deletion when
 * later edits lower similarity. A working-tree rename/copy into the same
 * destination takes precedence, preserving its current provenance.
 * Untracked paths from git ls-files --others --exclude-standard -z are appended
 * as A records. Both diffs disable external diff and use core.quotepath=false.
 * NUL parsing preserves filenames and rename endpoints without relying on
 * quoted display output. Pure selection maps these records to candidates and predecessors.
 * @param {{ repoRoot: string, base: string }} input Repository root and requested base reference.
 * @returns {{ mergeBase: string, changes: Array<{ status: string, path: string, from?: string }> }} Resolved comparison commit and parsed records.
 * @throws {Error} A base-unresolved-tagged resolution failure or an I/O/tool failure.
 */
function collectChanges({ repoRoot, base }) {
  const commit = git(repoRoot, ['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`], 'base-unresolved').trim();
  const mergeBase = git(repoRoot, ['merge-base', commit, 'HEAD'], 'base-unresolved').trim();
  const parse = (source) => {
    const records = source.split('\0');
    const changes = [];
    for (let i = 0; i < records.length - 1;) {
      const status = records[i++];
      if (/^[RC]/.test(status)) {
        const from = records[i++];
        changes.push({ status, from, path: records[i++] });
      } else {
        changes.push({ status, path: records[i++] });
      }
    }
    return changes;
  };
  let changes = parse(git(repoRoot, ['diff', '--no-ext-diff', '--name-status', '-M', '-z', mergeBase, '--']));
  const indexed = parse(git(repoRoot, ['diff', '--cached', '--no-ext-diff', '--name-status', '-M', '-z', mergeBase, '--']));
  for (const record of indexed) {
    if (!/^[RC]/.test(record.status) ||
        changes.some((change) => /^[RC]/.test(change.status) && change.path === record.path)) continue;
    if (changes.some((change) => change.status === 'A' && change.path === record.path) &&
        changes.some((change) => change.status === 'D' && change.path === record.from)) {
      changes = changes.filter((change) => !(change.status === 'A' && change.path === record.path) &&
        !(change.status === 'D' && change.path === record.from));
      changes.push(record);
    }
  }
  const untracked = git(repoRoot, ['ls-files', '--others', '--exclude-standard', '-z']);
  for (const path of untracked.split('\0').filter(Boolean)) changes.push({ status: 'A', path });
  return { mergeBase, changes };
}

/**
 * Populates fresh head and base trees without stale generated website output.
 *
 * @remarks Head copies existing files from git ls-files --cached --others
 * --exclude-standard -z -- docs/spec website/src/content/docs plus package.json.
 * Gitignored generated en spec pages and preview-blocks.mdx never enter the copy.
 * Git writes the base archive to a file in the temporary parent, and tar extracts
 * that file, so archive size does not consume a child-output buffer. The archive
 * contains the corresponding paths present at <merge-base>; absent source trees
 * are valid. The real docs root first
 * passes the preview-residue check, preserving that failure even though ignored
 * files are not copied.
 * Symbolic links in either documentation tree reject with io-failure before
 * generation or inspection, preventing baseline reads from reaching live files.
 * The caller owns both fresh directories and removes them in finally, including
 * when population fails partway through.
 * @param {{ repoRoot: string, mergeBase: string, headRoot: string, baseRoot: string }} input Source repository, comparison commit, and fresh destination roots.
 * @returns {Promise<void>} Resolves when both trees are materialized.
 * @throws {Error} A code-tagged I/O or tool failure.
 */
async function materializeTrees({ repoRoot, mergeBase, headRoot, baseRoot }) {
  const paths = ['docs/spec', 'website/src/content/docs', 'package.json'];
  const headFiles = git(repoRoot, [
    'ls-files', '--cached', '--others', '--exclude-standard', '-z',
    '--', ...paths,
  ]).split('\0').filter(Boolean);
  try {
    mkdirSync(join(headRoot, 'website'), { recursive: true });
    for (const filepath of new Set(headFiles)) {
      const srcPath = join(repoRoot, filepath);
      let current = repoRoot;
      let missing = false;
      for (const segment of filepath === 'package.json' ? [] : filepath.split('/')) {
        current = join(current, segment);
        let stat;
        try { stat = lstatSync(current); }
        catch (error) { if (error.code === 'ENOENT') { missing = true; break; } throw error; }
        if (stat.isSymbolicLink()) throw tagged('io-failure', `Symbolic link: ${current}`);
      }
      if (missing) continue;
      if (!exists(srcPath)) continue;
      const destPath = join(headRoot, filepath);
      mkdirSync(dirname(destPath), { recursive: true });
      copyFileSync(srcPath, destPath);
    }
    mkdirSync(join(baseRoot, 'website'), { recursive: true });
  } catch (error) {
    throw tagged('io-failure', error.message);
  }
  // Absent source trees are valid; archive only paths present at the base.
  const baseFiles = git(repoRoot, ['ls-tree', '-r', '--name-only', '-z', mergeBase, '--', ...paths])
    .split('\0').filter(Boolean);
  if (baseFiles.length === 0) return;
  // Keep the argument list bounded too, even when a tree contains many files.
  const basePaths = paths.filter((path) => baseFiles.some((file) => file === path || file.startsWith(`${path}/`)));
  const archivePath = join(dirname(baseRoot), 'base.tar');
  git(repoRoot, ['archive', '--format=tar', `--output=${archivePath}`, mergeBase, '--', ...basePaths]);
  const tarResult = spawnSync('tar', ['xf', archivePath, '-C', baseRoot], {
    encoding: 'utf8', maxBuffer: MAX_CHILD_OUTPUT,
  });
  if (tarResult.error || tarResult.status !== 0) {
    throw tagged('tool-failure', firstLine(tarResult.error?.message) || firstLine(tarResult.stderr) || 'tar extraction failed');
  }
  const rejectLinks = (path) => {
    let stat;
    try { stat = lstatSync(path); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (stat.isSymbolicLink()) throw tagged('io-failure', `Symbolic link: ${path}`);
    if (stat.isDirectory()) {
      for (const name of readdirSync(path)) rejectLinks(join(path, name));
    }
  };
  try {
    for (const path of paths.slice(0, 2)) rejectLinks(join(baseRoot, path));
  } catch (error) { throw tagged('io-failure', error.message); }
}

/**
 * Generates en spec pages in one materialized tree using the existing generator.
 *
 * @remarks A spec candidate requires generation on both sides. A node <script>
 * child runs with cwd set to the temporary website root and captures stdout and
 * stderr. Calling sync-spec.main directly cannot reliably communicate its
 * process exit status. A spawn failure, signal, or non-zero child exit rejects
 * with spec-sync-failure. The diagnostic is the first non-empty stderr line,
 * then stdout line, then sync-spec failed; child output never reaches checker stdout.
 * @param {{ scriptPath: string, websiteRoot: string }} input Existing sync-spec script and temporary website root.
 * @returns {Promise<void>} Resolves after successful generation.
 * @throws {Error} A spec-sync-failure-tagged error when generation fails.
 */
async function syncSpecTree({ scriptPath, websiteRoot }) {
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: websiteRoot,
    encoding: 'utf8',
    maxBuffer: MAX_CHILD_OUTPUT,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  if (result.error || result.status !== 0) {
    throw tagged('spec-sync-failure', firstLine(result.stderr) || firstLine(result.stdout) || 'sync-spec failed');
  }
}

/**
 * Resolves candidates against materialized presence before linting.
 *
 * @remarks A candidate with a base variant but no head variant is removed and
 * is not checked; one with no variant on either side is ignored. Presence comes
 * from these trees, never from status letters or the real working tree. This lets a deleted spec
 * source behave identically with or without stale generated output. Checked
 * slugs may still have missing locales, which the checker must diagnose.
 * @param {{ candidates: string[], headDocsRoot: string, baseDocsRoot: string }} input Candidate slugs and clean documentation roots.
 * @returns {{ pages: string[], removed: string[] }} Checked slugs and removed slugs.
 * @throws {Error} An io-failure-tagged error if presence cannot be determined.
 */
function resolvePresence({ candidates, headDocsRoot, baseDocsRoot }) {
  const checked = [];
  const removed = [];

  for (const slug of candidates) {
    if (hasPage(headDocsRoot, slug)) {
      checked.push(slug);
    } else if (hasPage(baseDocsRoot, slug)) {
      removed.push(slug);
    }
  }

  return { pages: checked, removed };
}

/**
 * Compares complete findings independently for each head variant's predecessor.
 *
 * @remarks checkChanged builds the baseline; this comparison consumes base
 * findings grouped by (page, locale), treating a group that does not exist as
 * empty. For each head variant, its predecessor's baseline is empty if the
 * predecessor slug has no variant at all in the base tree. If that slug has at
 * least one base variant but lacks the predecessor locale, the baseline is that
 * locale's page-missing finding. If the predecessor locale exists, the baseline
 * is its normal findings. Thus deleting a locale creates an error, while an
 * already missing locale stays old.
 * Rename predecessors are keyed by slug and locale, so translations that did not
 * move retain their own baseline. newViolations supplies multiset comparison;
 * unrelated base variants must not cancel a head finding.
 * @param {{ head: Array<import('./lib/prose-text.mjs').Violation>, base: Array<import('./lib/prose-text.mjs').Violation>, pages: string[], predecessor: Map<string, { slug: string, locale: string }> }} input Complete findings, checked slugs, and variant predecessors.
 * @returns {Array<import('./lib/prose-text.mjs').Violation>} Only new head findings.
 */
function compareVariants({ head, base, pages, predecessor }) {
  const result = [];

  const baseByPageLocale = new Map();
  for (const finding of base) {
    const key = `${finding.page}\0${finding.locale}`;
    if (!baseByPageLocale.has(key)) {
      baseByPageLocale.set(key, []);
    }
    baseByPageLocale.get(key).push(finding);
  }

  for (const slug of pages) {
    for (const locale of LOCALES) {
      const headKey = `${slug}\0${locale}`;

      const pred = predecessor.get(headKey);
      const predSlug = pred ? pred.slug : slug;
      const predLocale = pred ? pred.locale : locale;

      const predKey = `${predSlug}\0${predLocale}`;
      const baseFindings = baseByPageLocale.has(predKey) ? baseByPageLocale.get(predKey) : [];

      const headFindings = head.filter((v) => v.page === slug && v.locale === locale);

      const newViolationsForVariant = newViolations(headFindings, baseFindings);
      result.push(...newViolationsForVariant);
    }
  }

  result.sort((a, b) => compare(a.page, b.page) ||
    compare(LOCALES.indexOf(a.locale), LOCALES.indexOf(b.locale)) ||
    compare(a.line ?? -1, b.line ?? -1) || compare(a.rule, b.rule) || compare(a.actual, b.actual));

  return result;
}

/**
 * Checks changed documentation against its merge-base state without partial output.
 *
 * @remarks Validation precedence is argument usage, configuration, real docs-root
 * preview residue, base resolution (base-unresolved), change collection,
 * materialization, spec generation, presence, then inspection. After argument
 * validation, checkChanged reads and validates configuration with the same
 * validator checkProse uses through an empty explicit selection, before any git
 * command. Repository discovery also follows this validation when repoRoot is
 * omitted. Configuration and real-root residue are validated even
 * when no documentation page changed or only removals occurred.
 * Both sides use fresh temporary trees. Spec pages are generated on both sides
 * when any candidate is spec/*. Materialized presence determines checked and
 * removed slugs. checkChanged builds each head variant's predecessor baseline:
 * no variant of the predecessor slug in base means an empty baseline; an
 * existing base slug without that locale contributes its page-missing finding;
 * an existing predecessor locale contributes its normal findings. To obtain
 * these findings, checkProse runs on the base tree with pages set to predecessor
 * slugs having at least one base variant. page-unknown therefore cannot fire
 * for them, while absent locales yield page-missing. checkProse also inspects
 * checked head slugs. Both runs use head prose-lint.json and .textlintrc.json,
 * so limit changes apply only to touched pages. compareVariants consumes base
 * findings grouped by (page, locale), with nonexistent groups empty, and returns
 * only new errors and warnings relative to each variant's predecessor, sorted
 * with the same comparator checkProse uses (page, locale, line, rule, actual).
 * The checked count is the number of checked head slugs and the removed count
 * the number of removed candidates; main prints them in the summary line.
 * Both temporary trees share one uniquely created temporary parent and are
 * removed in finally on success and failure. A cleanup failure rejects with
 * io-failure unless an earlier failure already determines the diagnostic. Results
 * and summary are returned only after all work succeeds; main owns presentation
 * so a late tool failure still leaves stdout empty.
 * @param {{ repoRoot?: string, base: string, configPath: string, runners: { textlint: Function, zhlint: Function } }} input Optional repository root, requested reference, head config, and head-configured runners.
 * @returns {Promise<{ violations: Array<import('./lib/prose-text.mjs').Violation>, checked: number, removed: number }>} New findings and summary counts.
 * @throws {Error} A code-tagged config, residue, I/O, tool, base-unresolved, or spec-sync-failure rejection.
 */
async function checkChanged({ repoRoot, base, configPath, runners }) {
  const websiteRoot = dirname(configPath);
  const docsRoot = join(websiteRoot, 'src/content/docs');
  // Empty explicit selection reuses configuration and residue validation only.
  await checkProse({ docsRoot, configPath, report: false, runners, pages: [] });
  repoRoot ??= git(websiteRoot, ['rev-parse', '--show-toplevel']).trim();

  const { mergeBase, changes } = collectChanges({ repoRoot, base });

  const { candidates, predecessor } = selectChanges(changes);

  if (candidates.length === 0) return { violations: [], checked: 0, removed: 0 };
  let temporaryRoot;
  try { temporaryRoot = mkdtempSync(join(tmpdir(), 'prose-')); }
  catch (error) { throw tagged('io-failure', error.message); }
  const tempHeadRoot = join(temporaryRoot, 'head');
  const tempBaseRoot = join(temporaryRoot, 'base');
  let failure;
  try {
    await materializeTrees({ repoRoot, mergeBase, headRoot: tempHeadRoot, baseRoot: tempBaseRoot });

    const hasSpecCandidate = candidates.some((slug) => slug.startsWith('spec/'));

    if (hasSpecCandidate) {
      const specScript = fileURLToPath(new URL('./sync-spec.mjs', import.meta.url));
      await syncSpecTree({ scriptPath: specScript, websiteRoot: join(tempHeadRoot, 'website') });
      await syncSpecTree({ scriptPath: specScript, websiteRoot: join(tempBaseRoot, 'website') });
    }

    const headDocsRoot = join(tempHeadRoot, 'website/src/content/docs');
    const baseDocsRoot = join(tempBaseRoot, 'website/src/content/docs');

    const { pages: checkedSlugs, removed } = resolvePresence({
      candidates,
      headDocsRoot,
      baseDocsRoot
    });

    const baseVariantSlugs = new Set();
    for (const slug of checkedSlugs) {
      for (const locale of LOCALES) {
        const pred = predecessor.get(`${slug}\0${locale}`) || { slug, locale };
        if (hasPage(baseDocsRoot, pred.slug)) {
          baseVariantSlugs.add(pred.slug);
        }
      }
    }

    const headResult = await checkProse({
      docsRoot: headDocsRoot,
      configPath,
      report: false,
      runners,
      pages: checkedSlugs
    });

    const baseResult = await checkProse({
      docsRoot: baseDocsRoot,
      configPath,
      report: false,
      runners,
      pages: [...baseVariantSlugs]
    });

    const newViolations = compareVariants({
      head: headResult.violations,
      base: baseResult.violations,
      pages: checkedSlugs,
      predecessor
    });

    return {
      violations: newViolations,
      checked: checkedSlugs.length,
      removed: removed.length
    };
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try { rmSync(temporaryRoot, { recursive: true, force: true }); }
    catch (error) { if (!failure) throw tagged('io-failure', error.message); }
  }
}

/**
 * Translates the selected mode's complete result or code-tagged rejection into the CLI
 * contract. This is the only boundary that reads process.argv or writes stdout,
 * stderr, and process.exitCode: violations become JSON Lines or the report table;
 * exit-2 failures leave stdout empty and emit one diagnostic line.
 *
 * @remarks Plain mode checks config.pages; --report checks every page and always
 * exits 0 with a Markdown table. Repeatable --page checks exactly the named slugs
 * in all three locales. --changed [--base <ref>] compares against the merge base
 * (default origin/main) and emits only new findings. Plain and page modes exit 1
 * on any error; changed mode exits 1 only on a new error. Warnings never fail.
 * Usage, config, I/O, tool, residue, page-invalid, page-unknown, base-unresolved,
 * and spec-sync-failure rejections exit 2 with empty stdout and one stderr line
 * `check-prose: <code>: <message>`. On exit 0/1 stdout is complete JSONL or the
 * table. Changed mode alone also writes exactly one stderr summary line:
 * `check-prose: checked <n> changed page(s) since <ref>[, <m> removed]`, with the
 * removed suffix when applicable, or
 * `check-prose: no changed documentation pages since <ref>` for no docs changes.
 * @returns {Promise<void>} Resolves after output and exit status are set.
 */
export async function main() {
  try {
    const { mode, pages, base } = parseArguments(process.argv.slice(2));
    const websiteRoot = process.cwd();
    const docsRoot = join(websiteRoot, 'src/content/docs');
    const configPath = join(websiteRoot, 'prose-lint.json');
    const runners = {
      async textlint(files) {
        const { createLinter, loadTextlintrc } = await import('textlint');
        const configFilePath = join(websiteRoot, '.textlintrc.json');
        let config = await loadTextlintrc({ configFilePath,
          node_modulesDir: join(websiteRoot, 'node_modules') });
        if (config.rule.descriptors.length === 0) config = await loadTextlintrc({ configFilePath });
        // textlint falls back to empty rules on configuration errors; a rule-free
        // scan would pass silently. The retry also supports absolute rule paths.
        if (config.rule.descriptors.length === 0) throw new Error('textlint loaded no rules from .textlintrc.json');
        const linter = createLinter({ descriptor: config });
        const results = await Promise.all(files.map((file) => linter.lintFiles([file])));
        return results.flatMap((result) => result.flatMap((entry) => entry.messages));
      },
      async zhlint(source) {
        const { run } = await import('zhlint');
        // The abbreviation-skip rule throws on ordinary English-only sentences,
        // such as a quote followed by a period. An empty skip list avoids that
        // crash while preserving the spacing checks this integration relies on.
        const result = run(source, { rules: { preset: 'default', skipAbbrs: [] } });
        return result.validations.map((validation) => ({ message: validation.message }));
      }
    };

    if (mode === 'changed') {
      const result = await checkChanged({ base, configPath, runners });

      for (const violation of result.violations) process.stdout.write(`${JSON.stringify(violation)}\n`);

      if (result.checked === 0 && result.removed === 0) {
        process.stderr.write(`check-prose: no changed documentation pages since ${base}\n`);
      } else {
        let summary = `check-prose: checked ${result.checked} changed page(s) since ${base}`;
        if (result.removed > 0) {
          summary += `, ${result.removed} removed`;
        }
        process.stderr.write(`${summary}\n`);
      }

      process.exitCode = result.violations.some((v) => v.severity === 'error') ? 1 : 0;
    } else {
      const result = await checkProse({ docsRoot, configPath, report: mode === 'report', runners,
        pages: mode === 'page' ? pages : undefined });

      if (mode === 'report') {
        process.stdout.write(result.report);
        process.exitCode = 0;
      } else {
        for (const violation of result.violations) process.stdout.write(`${JSON.stringify(violation)}\n`);
        process.exitCode = result.violations.some((v) => v.severity === 'error') ? 1 : 0;
      }
    }

  } catch (error) {
    process.stderr.write(`check-prose: ${error.code ?? 'tool-failure'}: ${firstLine(error.message) || 'Check failed'}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
