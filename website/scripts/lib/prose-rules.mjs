// The eleven pure rules share one module because the SPEC-4 table already indexes
// their contracts; splitting each short rule into a file would obscure that view.

import { splitSentences } from './prose-text.mjs';

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @typedef {import('./prose-text.mjs').TextBlock} TextBlock
 * @typedef {import('./prose-text.mjs').Violation} Violation
 * @typedef {import('mdast').Root} Root
 */

/**
 * Implements the `heading-depth` row of SPEC-4: each heading deeper than h3,
 * including one inside an MDX flow element, is an error. It reads tree because
 * heading depth is structural; textBlocks cannot distinguish heading syntax.
 * @param {{ tree: Root, textBlocks: TextBlock[], lines: string[], frontmatterLineOffset: number, locale: string, group: string, config: object, calloutCount: number, isMdx: boolean }} ctx - Rule context.
 * @returns {Array<Violation>} - Violations.
 */
export function headingDepth(ctx) {
  const violations = [];
  function visit(node) {
    if (node.type === 'heading' && node.depth >= 4) {
      violations.push({ check: 'prose', locale: ctx.locale, line: node.position.start.line + ctx.frontmatterLineOffset, rule: 'heading-depth', severity: 'error', expected: '<= 3', actual: String(node.depth) });
    }
    for (const child of node.children ?? []) visit(child);
  }
  visit(ctx.tree);
  return violations;
}

/**
 * Implements the `h3-count` row of SPEC-4 using config.limits.h3Max (initially 5).
 * It counts heading nodes in tree, rather than heading-like text, and returns one
 * error when the page exceeds the limit.
 * @param {{ tree: Root, textBlocks: TextBlock[], lines: string[], frontmatterLineOffset: number, locale: string, group: string, config: object, calloutCount: number, isMdx: boolean }} ctx - Rule context.
 * @returns {Array<Violation>} - Violations.
 */
export function h3Count(ctx) {
  let count = 0;
  function visit(node) {
    if (node.type === 'heading' && node.depth === 3) count += 1;
    for (const child of node.children ?? []) visit(child);
  }
  visit(ctx.tree);
  const limit = ctx.config.limits.h3Max;
  if (count > limit) {
    return [{ check: 'prose', locale: ctx.locale, line: null, rule: 'h3-count', severity: 'error', expected: `<= ${limit}`, actual: String(count) }];
  }
  return [];
}

/**
 * Implements the `required-anchors` row of SPEC-4 using
 * config.requiredAnchors[group]. It reads tree to require each id at the end of an
 * h2, including h2 nodes nested in MDX; an h3 anchor cannot satisfy the contract.
 * Markdown and MDX use their specified literal and escaped anchor forms.
 * ctx.isMdx selects the literal `{#id}` form for Markdown or the escaped `\\{#id}` form for MDX.
 * @param {{ tree: Root, textBlocks: TextBlock[], lines: string[], frontmatterLineOffset: number, locale: string, group: string, config: object, calloutCount: number, isMdx: boolean }} ctx - Rule context.
 * @returns {Array<Violation>} - Violations.
 */
export function requiredAnchors(ctx) {
  const required = ctx.config.requiredAnchors?.[ctx.group] ?? [];
  if (required.length === 0) return [];
  const marker = ctx.isMdx ? '\\{#' : '{#';
  const h2Lines = [];
  function visit(node) {
    if (node.type === 'heading' && node.depth === 2) h2Lines.push(ctx.lines[node.position.start.line + ctx.frontmatterLineOffset - 1] ?? '');
    for (const child of node.children ?? []) visit(child);
  }
  visit(ctx.tree);
  const violations = [];
  for (const anchorId of required) {
    const needle = `${marker}${anchorId}}`;
    const found = h2Lines.some((line) => line.trimEnd().endsWith(needle));
    if (!found) {
      violations.push({ check: 'prose', locale: ctx.locale, line: null, rule: 'required-anchors', severity: 'error', expected: anchorId, actual: 'missing' });
    }
  }
  return violations;
}

/**
 * Implements the `banned-term` row of SPEC-4 using config.bannedTerms for the
 * start-here, tutorials, how-to, explanation, and agents groups. It reads
 * textBlocks' source-line segments, not raw lines, so excluded syntax stays out.
 * Each term produces at most one error per original line; ASCII words use
 * case-insensitive word boundaries and non-ASCII terms use substring matching.
 * @param {{ tree: Root, textBlocks: TextBlock[], lines: string[], frontmatterLineOffset: number, locale: string, group: string, config: object, calloutCount: number, isMdx: boolean }} ctx - Rule context.
 * @returns {Array<Violation>} - Violations.
 */
export function bannedTerm(ctx) {
  const allowedGroups = new Set(['start-here', 'tutorials', 'how-to', 'explanation', 'agents']);
  if (!allowedGroups.has(ctx.group)) return [];
  const seen = new Set();
  const violations = [];
  for (const term of ctx.config.bannedTerms ?? []) {
    const isAscii = /^[\x00-\x7F]*$/.test(term);
    const regex = isAscii ? new RegExp(`\\b${escapeRegExp(term)}\\b`, 'i') : null;
    for (const block of ctx.textBlocks) {
      for (const segment of block.segments) {
        const matched = isAscii ? regex.test(segment.text) : segment.text.includes(term);
        if (matched) {
          const key = `${segment.line}::${term}`;
          if (!seen.has(key)) {
            seen.add(key);
            violations.push({ check: 'prose', locale: ctx.locale, line: segment.line, rule: 'banned-term', severity: 'error', expected: 'absent', actual: term });
          }
        }
      }
    }
  }
  return violations;
}

/**
 * Implements the `callout-count` row of SPEC-4 using config.limits.calloutMax
 * (initially 2). The aside count is computed during text extraction; this rule
 * only wraps that precomputed count into one error when it exceeds the limit.
 * Re-scanning tree would risk disagreeing with aside extraction.
 * This rule reads ctx.calloutCount instead of re-deriving the aside count.
 * @param {{ tree: Root, textBlocks: TextBlock[], lines: string[], frontmatterLineOffset: number, locale: string, group: string, config: object, calloutCount: number, isMdx: boolean }} ctx - Rule context.
 * @returns {Array<Violation>} - Violations.
 */
export function calloutCount(ctx) {
  const limit = ctx.config.limits.calloutMax;
  if (ctx.calloutCount > limit) {
    return [{ check: 'prose', locale: ctx.locale, line: null, rule: 'callout-count', severity: 'error', expected: `<= ${limit}`, actual: String(ctx.calloutCount) }];
  }
  return [];
}

/**
 * Implements the `related-linkcard-only` row of SPEC-4. Tree locates the
 * `{#related}` h2 and the next h2; lines supplies the literal source in that
 * interval. Raw leading whitespace and list markers are essential to detect
 * indented Markdown links and links labels. textBlocks deliberately strips this
 * syntax, which is why raw lines exist in the shared context. The first offending
 * line supplies the one error's truncated actual value.
 * @param {{ tree: Root, textBlocks: TextBlock[], lines: string[], frontmatterLineOffset: number, locale: string, group: string, config: object, calloutCount: number, isMdx: boolean }} ctx - Rule context.
 * @returns {Array<Violation>} - Violations.
 */
export function relatedLinkcardOnly(ctx) {
  const marker = ctx.isMdx ? '\\{#related}' : '{#related}';
  let startLine = -1;
  let endLine = ctx.lines.length;
  const h2Lines = [];
  const codeRanges = [];
  function visit(node) {
    if (node.type === 'heading' && node.depth === 2) h2Lines.push(node.position.start.line + ctx.frontmatterLineOffset);
    if (node.type === 'code') codeRanges.push([node.position.start.line + ctx.frontmatterLineOffset, node.position.end.line + ctx.frontmatterLineOffset]);
    for (const child of node.children ?? []) visit(child);
  }
  visit(ctx.tree);
  // A self-closing HTML flow tag can absorb a following Markdown heading without
  // a blank line; the literal heading still ends the related section.
  for (let i = 1; i < ctx.lines.length; i += 1) {
    const lineNum = i + 1;
    if (/^\s*<[^>]+\/>\s*$/.test(ctx.lines[i - 1]) &&
        /^##\s+/.test(ctx.lines[i]) &&
        !codeRanges.some(([start, end]) => start <= lineNum && lineNum <= end)) {
      h2Lines.push(lineNum);
    }
  }
  h2Lines.sort((a, b) => a - b);
  for (let i = 0; i < h2Lines.length; i += 1) {
    const line = ctx.lines[h2Lines[i] - 1] ?? '';
    if (line.trimEnd().endsWith(marker)) {
      startLine = h2Lines[i] + 1;
      endLine = i + 1 < h2Lines.length ? h2Lines[i + 1] - 1 : ctx.lines.length;
      break;
    }
  }
  if (startLine === -1) return [];
  const listPattern = /^\s*(?:[-*]|\d+\.)\s*\[/;
  const labelPattern = /^\s*(?:links?|リンク|链接)\s*[:：]/i;
  for (let lineNum = startLine; lineNum <= endLine; lineNum += 1) {
    const text = ctx.lines[lineNum - 1] ?? '';
    if (listPattern.test(text) || labelPattern.test(text)) {
      return [{ check: 'prose', locale: ctx.locale, line: lineNum, rule: 'related-linkcard-only', severity: 'error', expected: 'LinkCard only', actual: text.slice(0, 40) }];
    }
  }
  return [];
}

/**
 * Implements the `sentence-length` row of SPEC-4 using
 * config.limits.sentence[locale].warn and .error. It reads textBlocks' joined
 * paragraphs and line maps so a sentence crossing source lines is attributed to
 * its start. Error subsumes warning: one sentence never yields both findings.
 * @param {{ tree: Root, textBlocks: TextBlock[], lines: string[], frontmatterLineOffset: number, locale: string, group: string, config: object, calloutCount: number, isMdx: boolean }} ctx - Rule context.
 * @returns {Array<Violation>} - Violations.
 */
export function sentenceLength(ctx) {
  function countLength(text) {
    return ctx.locale === 'en' ? text.split(/\s+/).filter(Boolean).length : [...text].filter((ch) => !/\s/.test(ch)).length;
  }
  const violations = [];
  for (const block of ctx.textBlocks) {
    if (block.nodeType === 'heading') continue;
    const limits = ctx.config.limits.sentence[ctx.locale];
    for (const sentence of splitSentences(block.joinedText, ctx.locale)) {
      const length = countLength(sentence.text);
      let line = block.lineMap[0]?.line ?? null;
      for (const entry of block.lineMap) if (entry.offset <= sentence.offset) line = entry.line;
      if (length > limits.error) {
        violations.push({ check: 'prose', locale: ctx.locale, line, rule: 'sentence-length', severity: 'error', expected: `<= ${limits.error}`, actual: String(length) });
      } else if (length > limits.warn) {
        violations.push({ check: 'prose', locale: ctx.locale, line, rule: 'sentence-length', severity: 'warning', expected: `<= ${limits.warn}`, actual: String(length) });
      }
    }
  }
  return violations;
}

/**
 * Implements the `paragraph-sentences` row of SPEC-4 using
 * config.limits.paragraphSentencesMax (initially 3). It reads textBlocks because
 * mdast paragraph boundaries, including paragraphs in list items, define the
 * denominator; headings do not count as paragraphs.
 * @param {{ tree: Root, textBlocks: TextBlock[], lines: string[], frontmatterLineOffset: number, locale: string, group: string, config: object, calloutCount: number, isMdx: boolean }} ctx - Rule context.
 * @returns {Array<Violation>} - Violations.
 */
export function paragraphSentences(ctx) {
  const limit = ctx.config.limits.paragraphSentencesMax;
  const violations = [];
  for (const block of ctx.textBlocks) {
    if (block.nodeType === 'heading') continue;
    const count = splitSentences(block.joinedText, ctx.locale).length;
    if (count > limit) {
      const line = block.segments[0]?.line ?? block.lineMap[0]?.line ?? null;
      violations.push({ check: 'prose', locale: ctx.locale, line, rule: 'paragraph-sentences', severity: 'warning', expected: `<= ${limit}`, actual: String(count) });
    }
  }
  return violations;
}

/**
 * Implements the `page-length` row of SPEC-4 using config.limits.words[group].
 * It reads textBlocks so excluded nodes and headings do not inflate page length.
 * English counts words; ja and zh-cn count non-whitespace code points against
 * twice the group base. Exceeding the base warns; exceeding its 1.3 multiplier
 * rounded up errors. A group without a configured limit has no finding.
 * @param {{ tree: Root, textBlocks: TextBlock[], lines: string[], frontmatterLineOffset: number, locale: string, group: string, config: object, calloutCount: number, isMdx: boolean }} ctx - Rule context.
 * @returns {Array<Violation>} - Violations.
 */
export function pageLength(ctx) {
  const limit = ctx.config.limits.words?.[ctx.group];
  if (limit === undefined) return [];
  function countLength(text) {
    return ctx.locale === 'en' ? text.split(/\s+/).filter(Boolean).length : [...text].filter((ch) => !/\s/.test(ch)).length;
  }
  let total = 0;
  for (const block of ctx.textBlocks) {
    if (block.nodeType === 'heading') continue;
    total += countLength(block.joinedText);
  }
  const errorThreshold = Math.ceil(limit * 1.3);
  if (total > errorThreshold) {
    return [{ check: 'prose', locale: ctx.locale, line: null, rule: 'page-length', severity: 'error', expected: `<= ${errorThreshold}`, actual: String(total) }];
  }
  if (total > limit) {
    return [{ check: 'prose', locale: ctx.locale, line: null, rule: 'page-length', severity: 'warning', expected: `<= ${limit}`, actual: String(total) }];
  }
  return [];
}

/**
 * Implements the `passive-density` row of SPEC-4 for ja using
 * config.limits.passiveRatioWarn (initially 0.3). It reads sentences from
 * textBlocks; zero sentences skip the ratio to avoid a zero denominator. The
 * threshold includes SPEC-4's 1e-9 tolerance and reports one warning.
 * @param {{ tree: Root, textBlocks: TextBlock[], lines: string[], frontmatterLineOffset: number, locale: string, group: string, config: object, calloutCount: number, isMdx: boolean }} ctx - Rule context.
 * @returns {Array<Violation>} - Violations.
 */
export function passiveDensity(ctx) {
  if (ctx.locale !== 'ja') return [];
  let total = 0;
  let passive = 0;
  for (const block of ctx.textBlocks) {
    if (block.nodeType === 'heading') continue;
    for (const sentence of splitSentences(block.joinedText, ctx.locale)) {
      total += 1;
      if (sentence.text.includes('され')) passive += 1;
    }
  }
  if (total === 0) return [];
  const ratio = passive / total;
  const limit = ctx.config.limits.passiveRatioWarn;
  if (ratio > limit + 1e-9) {
    return [{ check: 'prose', locale: ctx.locale, line: null, rule: 'passive-density', severity: 'warning', expected: `<= ${limit}`, actual: ratio.toFixed(2) }];
  }
  return [];
}

/**
 * Implements the `no-thematic-break` row of SPEC-4. It reads tree so only actual
 * thematicBreak nodes produce errors, one per occurrence; frontmatter delimiters
 * and code containing `---` must not count. Headings and spacing supply section
 * separation instead of decorative rules.
 * @param {{ tree: Root, textBlocks: TextBlock[], lines: string[], frontmatterLineOffset: number, locale: string, group: string, config: object, calloutCount: number, isMdx: boolean }} ctx - Rule context.
 * @returns {Array<Violation>} - Violations.
 */
export function noThematicBreak(ctx) {
  const violations = [];
  function visit(node) {
    if (node.type === 'thematicBreak') {
      violations.push({ check: 'prose', locale: ctx.locale, line: node.position.start.line + ctx.frontmatterLineOffset, rule: 'no-thematic-break', severity: 'error', expected: 'none', actual: 'thematic break' });
    }
    for (const child of node.children ?? []) visit(child);
  }
  visit(ctx.tree);
  return violations;
}
