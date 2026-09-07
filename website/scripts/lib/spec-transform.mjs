import { convertWikilinks } from './wikilinks.mjs';

/**
 * Converts one source specification chapter into a Starlight document for a locale.
 *
 * The fixed transformation validates and removes the sole H1 into the title, expands `repo:`
 * tokens, removes residual vault quotes, converts wikilinks, derives the description, and
 * otherwise preserves content, including explicit anchor tokens.
 * Description extraction must follow wikilink conversion because Markdown link syntax is
 * not acceptable metadata text. `chapter`, rather than a heading-derived guess, selects both
 * the generated `editUrl` and the changelog-only description branch.
 *
 * The description scanner skips non-paragraph blocks and ends at the first English or CJK
 * sentence punctuation that is not immediately between two digits. A naive scan for the
 * first `.`, `?`, or `!` would truncate the real `ambercast 0.2.0.` sentence in the overview
 * source. The `repo:` lexer similarly treats a comma as part of one line-range token only
 * when its next non-space character is a digit; commas before another token or prose remain
 * outer separators.
 *
 * @param {string} markdown Raw chapter Markdown.
 * @param {{ locale: string, version: string, titles: Map<string, string>, chapter: string }} options
 * Locale and release metadata, a complete title lookup for shared wikilink conversion, and
 * the source chapter identifier used for chapter-specific metadata.
 * @returns {string} Generated Markdown with frontmatter and normalized specification prose.
 * @throws {Error} When the source cannot supply exactly one H1 or a delegated wikilink
 * conversion reports unresolved input.
 */
export function transformSpec(markdown, { locale, version, titles, chapter }) {
  const h1s = [...markdown.matchAll(/^# (.+)$/gm)];
  if (h1s.length !== 1) throw new Error(`Expected exactly one H1, found ${h1s.length}`);

  const title = h1s[0][1];
  let body = markdown.slice(0, h1s[0].index) + markdown.slice(h1s[0].index + h1s[0][0].length);
  body = expandRepoTokens(body, version);
  body = body.replace(/\[vault:[^\]]*\]/g, '');
  body = convertWikilinks(body, { locale, titles });

  const descriptionSource = chapter === 'changelog'
    ? body.slice(findCompatibilityPolicy(body))
    : body;
  const description = firstSentence(firstNormalParagraph(descriptionSource));
  const frontmatter = [
    '---',
    `title: ${JSON.stringify(title)}`,
    `description: ${JSON.stringify(description)}`,
    ...(locale === 'en' ? [`editUrl: ${JSON.stringify(editUrl(chapter))}`] : []),
    '---',
  ].join('\n');
  return `${frontmatter}${body}`;
}

function expandRepoTokens(markdown, version) {
  return markdown.replace(/\[?repo:([a-zA-Z0-9_./-]+):(\d+(?:-\d+)?(?:,\s*\d+(?:-\d+)?)*)\]?/g, (_source, path, lineList) => lineList
    .split(/,\s*/)
    .map((lines) => {
      const [start, end] = lines.split('-');
      const fragment = end ? `#L${start}-L${end}` : `#L${start}`;
      return `[${path}:${lines}](https://github.com/kotarotsubaki/ambercast/blob/v${version}/${path}${fragment})`;
    })
    .join(', '));
}

function findCompatibilityPolicy(body) {
  const match = /^## +.+\s+\{#compatibility-policy\}\s*$/m.exec(body);
  if (!match || match.index === undefined) return body.length;
  return match.index + match[0].length;
}

function firstNormalParagraph(body) {
  for (const block of body.split(/\n{2,}/)) {
    const trimmed = block.trim();
    if (!trimmed || /^(#{1,6}\s|>|\||`{3,}|~{3,})/.test(trimmed)) continue;
    return trimmed.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  }
  return '';
}

function firstSentence(paragraph) {
  for (let index = 0; index < paragraph.length; index += 1) {
    if (!'.?!。！？'.includes(paragraph[index])) continue;
    if (/\d/.test(paragraph[index - 1] ?? '') && /\d/.test(paragraph[index + 1] ?? '')) continue;
    return paragraph.slice(0, index + 1);
  }
  return paragraph;
}

function editUrl(chapter) {
  const path = chapter === 'changelog' ? 'CHANGELOG.md' : `docs/spec/${chapter}.md`;
  return `https://github.com/kotarotsubaki/ambercast/edit/main/${path}`;
}
