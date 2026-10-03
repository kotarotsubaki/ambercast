// The checker returns complete results before presentation so an input or tool
// failure can never expose partial findings as a successful scan.

import { readFileSync, accessSync, constants, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
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

const GROUPS = ['start-here', 'tutorials', 'how-to', 'explanation', 'reference', 'spec', 'agents'];
const LOCALES = ['en', 'ja', 'zh-cn'];
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
 * Checks configured documentation pages independently for each locale and returns
 * sorted SPEC-2 violations. In report mode, the returned report is the SPEC-7
 * Markdown table over the full corpus; otherwise it is null. This read-only async
 * API writes neither stdout nor stderr, allowing direct callers to receive either
 * a complete result or a code-tagged rejection without subprocess fixtures.
 *
 * @remarks Validation precedes the preview-residue check, which precedes the
 * empty-pages short circuit, which precedes page-by-locale inspection. Checking
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
 * @param {{ docsRoot: string, configPath: string, report: boolean, runners: { textlint: Function, zhlint: Function } }} input Paths, report mode, and injectable tool runners.
 * @returns {Promise<{ violations: Array<import('./lib/prose-text.mjs').Violation>, report: string|null }>} Complete violations and optional table.
 * @throws {Error} A code-tagged error for config-invalid, io-failure,
 * tool-failure, or preview-residue.
 */
export async function checkProse({ docsRoot, configPath, report, runners }) {
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
  if (!report && config.pages.length === 0) return { violations: [], report: null };

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
          try { findings = await runners.zhlint(block.joinedText); }
          catch (error) { throw tagged('tool-failure', error.message); }
          for (const finding of findings) {
            violations.push({ check: 'prose', locale, page: slug,
              line: block.segments[0]?.line ?? null, rule: 'zhlint', severity: 'error',
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
 * Translates checkProse's complete result or code-tagged rejection into the CLI
 * contract. This is the only boundary that reads process.argv or writes stdout,
 * stderr, and process.exitCode: violations become JSON Lines or the report table;
 * exit-2 failures leave stdout empty and emit one diagnostic line.
 * @returns {Promise<void>} Resolves after output and exit status are set.
 */
export async function main() {
  const report = process.argv.includes('--report');
  const docsRoot = join(process.cwd(), 'src/content/docs');
  const configPath = join(process.cwd(), 'prose-lint.json');
  const runners = {
    async textlint(files) {
      const textlint = await import('textlint');
      const { createLinter, loadTextlintrc } = textlint;
      const config = await loadTextlintrc({ configFilePath: join(process.cwd(), '.textlintrc.json'),
        node_modulesDir: join(process.cwd(), 'node_modules') });
      const linter = createLinter({ descriptor: config });
      const results = await Promise.all(files.map((file) => linter.lintFiles([file])));
      return results.flatMap((result) => result.flatMap((entry) => entry.messages));
    },
    async zhlint(source) {
      const { run } = await import('zhlint');
      // zhlint 0.8.2's abbreviation-skip rule throws on some ordinary English-only sentences
      // (e.g. a quote immediately followed by a period); an empty skip list avoids that crash
      // without disabling the spacing checks this integration actually relies on.
      const result = run(source, { rules: { preset: 'default', skipAbbrs: [] } });
      return result.validations.map((validation) => ({ message: validation.message }));
    }
  };
  try {
    const result = await checkProse({ docsRoot, configPath, report, runners });
    if (report) process.stdout.write(result.report);
    else for (const violation of result.violations) process.stdout.write(`${JSON.stringify(violation)}\n`);
    process.exitCode = !report && result.violations.some((v) => v.severity === 'error') ? 1 : 0;
  } catch (error) {
    process.stderr.write(`check-prose: ${error.code ?? 'tool-failure'}: ${error.message}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
