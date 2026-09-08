const FIGURE_IDS = {
  cycle: ['prompt', 'generate', 'artifacts', 'run', 'replay', 'heal'],
  files: ['prompt-file', 'plan-file', 'grounding-file'],
  ledger: ['generate', 'replay', 'heal'],
};

const FIGURE_ANCHORS = {
  cycle: 'generate-run-heal-cycle',
  files: 'three-files',
  ledger: 'ai-call-ledger',
};

const ALT_LABEL = /^(Accessibility text alternative|代替テキスト|\*\*无障碍替代文本\*\*)\s*[:：]\s*(.+)$/;
const CAPTION_LABEL = /^(?:キャプション|Caption)\s*[:：]\s*(.+)$/;
const QUOTE_PAIRS = [['"', '"'], ['“', '”'], ['「', '」']];
const SUPPORTED_LOCALES = new Set(['en', 'ja', 'zh-cn']);
const NODE_BULLET = /^- `([^`]+)`\s*(—|:|：)\s*(.+)$/;
const EDGE_BULLET = /^- `([^`]+) (→|↔) ([^`]+)`\s*\(`([^`]+)`\)$/;

// Figure identity comes from stable explicit anchors, not from document order. Translated
// introductions may gain prose or rearrange sections, while a misplaced visual must never be
// silently assigned another figure's fixed data shape. Each bounded section is therefore read
// independently, ending at its next level-two heading or at end of file.
//
// The IDs are intentionally not read from the prose bullets. The page copy supplies labels and
// descriptions, but the component layouts require a stable id-to-position correspondence across
// every locale. Matching nodes in document order against these fixed lists preserves that
// correspondence and turns an editorially incomplete figure into a diagnosable input error.
//
// Node and edge bullets share a deliberately narrow backtick-led surface. A line in that surface
// which matches neither grammar is rejected instead of skipped: ignoring it could produce
// convincing but incomplete JSON after a documentation edit. Likewise, duplicate directed edge
// triples are invalid even when their visible copy is identical, because later structural checks
// compare edge sets and would otherwise hide the duplicate.
//
// Alternative text is content rather than Markdown punctuation. One matched outer quote pair is
// removed only when both delimiters agree, so localized prose is normalized without damaging a
// mismatched or meaningful quote inside the value. Captions remain nullable because only some
// locales author one.

/**
 * Extracts the three introduction figures from one localized Markdown document.
 *
 * Each figure is found by its fixed anchor, then its required alternative text, optional caption,
 * ordered nodes, and directed edges are validated before plain data is returned for the migration
 * script and Astro components.
 *
 * @example
 * const figures = extractIntroFigures(markdown, { locale: 'en' });
 * console.log(figures.cycle.alt);
 *
 * @remarks
 * This module neither reads files nor depends on document state, keeping parser failures small
 * and unit-testable.
 *
 * @param {string} markdown Localized introduction Markdown.
 * @param {{ locale: 'en' | 'ja' | 'zh-cn' }} options Locale identifier included in diagnostics.
 * @returns {{
 *   cycle: {
 *     alt: string,
 *     caption: string | null,
 *     nodes: Array<{ id: string, label: string, text: string }>,
 *     edges: Array<{ from: string, to: string, label: string, direction: 'forward' | 'bidirectional' }>
 *   },
 *   files: {
 *     alt: string,
 *     caption: string | null,
 *     nodes: Array<{ id: string, label: string, text: string }>,
 *     edges: Array<{ from: string, to: string, label: string, direction: 'forward' | 'bidirectional' }>
 *   },
 *   ledger: {
 *     alt: string,
 *     caption: string | null,
 *     nodes: Array<{ id: string, label: string, text: string }>,
 *     edges: Array<{ from: string, to: string, label: string, direction: 'forward' | 'bidirectional' }>
 *   }
 * }} Figures keyed by their fixed component names.
 * @throws {Error} If `locale` is unsupported; an anchor is missing or duplicated; required
 * alternative text is absent or ambiguous; a caption is ambiguous; a node or edge count is
 * invalid; an edge refers to an unknown figure id; an edge is duplicated; or a backtick-led
 * bullet does not match a supported node or edge grammar. Diagnostics identify the locale and
 * figure, and node or edge count diagnostics list every matched source line so documentation
 * errors can be corrected directly.
 */
export function extractIntroFigures(markdown, { locale }) {
  if (!SUPPORTED_LOCALES.has(locale)) {
    throw new Error(`Unsupported introduction figure locale: ${locale}`);
  }

  return Object.fromEntries(
    Object.keys(FIGURE_IDS).map((key) => [key, extractFigure(markdown, key, locale)]),
  );
}

function extractFigure(markdown, key, locale) {
  const lines = findFigureSection(markdown, key, locale).split(/\r?\n/);
  const alternatives = [];
  const captions = [];
  const nodeMatches = [];
  const edgeMatches = [];

  for (const line of lines) {
    const alternative = ALT_LABEL.exec(line);
    if (alternative) alternatives.push(alternative);

    const caption = CAPTION_LABEL.exec(line);
    if (caption) captions.push(caption);

    const node = NODE_BULLET.exec(line);
    const edge = EDGE_BULLET.exec(line);
    if (node) {
      nodeMatches.push({ line, match: node });
    } else if (edge) {
      edgeMatches.push({ line, match: edge });
    } else if (line.startsWith('- `')) {
      throw figureError(key, locale, `unrecognized backtick-led bullet: ${line}`);
    }
  }

  if (alternatives.length !== 1) {
    throw figureError(key, locale, `expected exactly one alternative text line, found ${alternatives.length}`);
  }
  if (captions.length > 1) {
    throw figureError(key, locale, `expected at most one caption line, found ${captions.length}`);
  }

  const ids = FIGURE_IDS[key];
  if (nodeMatches.length !== ids.length) {
    throw figureError(
      key,
      locale,
      `expected ${ids.length} node lines, found ${nodeMatches.length}:\n${formatMatchedLines(nodeMatches)}`,
    );
  }
  if (edgeMatches.length === 0) {
    throw figureError(key, locale, `expected at least one edge line, found none:\n${formatMatchedLines(edgeMatches)}`);
  }

  const knownIds = new Set(ids);
  const edgeTriples = new Set();
  const edges = edgeMatches.map(({ line, match }) => {
    const [, from, arrow, to, label] = match;
    if (!knownIds.has(from) || !knownIds.has(to)) {
      throw figureError(key, locale, `edge references an unknown id: ${line}`);
    }

    const direction = arrow === '→' ? 'forward' : 'bidirectional';
    const triple = `${from}\u0000${to}\u0000${direction}`;
    if (edgeTriples.has(triple)) {
      throw figureError(key, locale, `duplicate edge ${from} ${to} ${direction}: ${line}`);
    }
    edgeTriples.add(triple);

    return { from, to, label, direction };
  });

  return {
    caption: captions.length === 0 ? null : captions[0][1].trim(),
    alt: stripOuterQuotePair(alternatives[0][2].trim()),
    nodes: nodeMatches.map(({ match }, index) => ({
      id: ids[index],
      label: match[1],
      text: match[3].trim(),
    })),
    edges,
  };
}

function findFigureSection(markdown, key, locale) {
  const anchor = FIGURE_ANCHORS[key];
  const anchorPattern = new RegExp(`^##[ \\t]+[^\\r\\n]*\\{#${anchor}\\}[ \\t]*\\r?$`, 'gm');
  const matches = [...markdown.matchAll(anchorPattern)];

  if (matches.length !== 1) {
    throw figureError(key, locale, `expected exactly one {#${anchor}} anchor, found ${matches.length}`);
  }

  const afterAnchor = markdown.slice(matches[0].index + matches[0][0].length);
  const nextHeading = /^##(?:[ \t]+|$)/m.exec(afterAnchor);
  return nextHeading ? afterAnchor.slice(0, nextHeading.index) : afterAnchor;
}

function stripOuterQuotePair(value) {
  for (const [opening, closing] of QUOTE_PAIRS) {
    if (value.startsWith(opening) && value.endsWith(closing)) {
      return value.slice(opening.length, -closing.length);
    }
  }

  return value;
}

function formatMatchedLines(matches) {
  return matches.length === 0 ? '(none)' : matches.map(({ line }) => line).join('\n');
}

function figureError(key, locale, detail) {
  return new Error(`Invalid ${key} figure for locale ${locale}: ${detail}`);
}
