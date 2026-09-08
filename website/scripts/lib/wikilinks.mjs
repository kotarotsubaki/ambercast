/**
 * Splits Markdown into editable prose and opaque code regions without changing either.
 *
 * The tokenizer is shared by link migration, fence normalization, and parity checking so
 * those operations cannot disagree about whether an example is documentation or literal
 * code. It follows the bounded CommonMark-adjacent contract used by the site: a fence may
 * be indented by zero to three spaces, opens with three or more identical backticks or
 * tildes, and closes only with the same marker at least as long at the same or lesser
 * indent. Inline spans remain opaque through the next delimiter run of the same length.
 *
 * @param {string} markdown Markdown to partition while preserving its exact text.
 * @returns {Array<{ text: string, isCode: boolean }>} Ordered regions whose concatenation
 * is the original Markdown. `isCode` marks fenced and inline-code regions.
 */
export function splitByCodeRegions(markdown) {
  const regions = [];
  let proseStart = 0;
  let offset = 0;
  let openFence = null;

  const push = (text, isCode) => {
    if (text) regions.push({ text, isCode });
  };

  for (const line of markdown.matchAll(/[^\n]*(?:\n|$)/g)) {
    const text = line[0];
    if (!text && offset === markdown.length) break;
    const content = text.endsWith('\n') ? text.slice(0, -1) : text;

    if (openFence) {
      const close = new RegExp(`^ {0,${openFence.indent}}${openFence.marker}{${openFence.length},}[ \\t]*$`);
      if (close.test(content)) {
        push(markdown.slice(proseStart, openFence.start), false);
        push(markdown.slice(openFence.start, offset + content.length), true);
        proseStart = offset + content.length;
        openFence = null;
      }
    } else {
      const match = /^( {0,3})(`{3,}|~{3,})/.exec(content);
      if (match) {
        openFence = {
          start: offset,
          indent: match[1].length,
          marker: match[2][0],
          length: match[2].length,
        };
      }
    }
    offset += text.length;
  }

  if (openFence) {
    push(markdown.slice(proseStart, openFence.start), false);
    push(markdown.slice(openFence.start), true);
  } else {
    push(markdown.slice(proseStart), false);
  }

  return regions.flatMap((region) => region.isCode ? [region] : splitInlineCode(region.text));
}

function splitInlineCode(text) {
  const regions = [];
  let proseStart = 0;
  const delimiter = /`+/g;
  let opener;

  while ((opener = delimiter.exec(text))) {
    const length = opener[0].length;
    let closer;
    while ((closer = delimiter.exec(text))) {
      if (closer[0].length === length) break;
    }
    if (!closer) break;
    if (text.slice(opener.index, closer.index).includes('\n')) continue;
    if (opener.index > proseStart) regions.push({ text: text.slice(proseStart, opener.index), isCode: false });
    regions.push({ text: text.slice(opener.index, closer.index + length), isCode: true });
    proseStart = closer.index + length;
  }
  if (proseStart < text.length) regions.push({ text: text.slice(proseStart), isCode: false });
  return regions;
}

/**
 * Replaces resolvable `[[target]]` and `[[target#anchor]]` references in Markdown with
 * canonical site links.
 *
 * Code regions from {@link splitByCodeRegions} are intentionally left verbatim: examples
 * must not become navigation. `titles` maps each canonical target key to its displayed
 * title; it contains all placed pages, including matching-locale `spec/<chapter>` pages.
 * URLs use no locale segment for the root
 * locale, include one for translated locales, and always end the page path with `/`.
 *
 * A malformed residual `[[` or an unresolved target is collected with every other offender
 * and reported in one thrown aggregate error. This lets command-line callers print all
 * diagnostics and avoid a partial migration rather than stopping at an arbitrary first
 * link. The `agents/setup-prompt` bare-URL substitution is deliberately caller-owned: it
 * has a different output shape for one page's fence contents and would make this otherwise
 * pure, single-purpose transform carry an unrelated exception.
 *
 * @param {string} markdown Markdown containing site wikilinks.
 * @param {{ locale: string, titles: Map<string, string> }} options Locale used for URL
 * construction and the complete target-to-title lookup.
 * @returns {string} Markdown with every valid non-code wikilink converted.
 * @throws {Error} Aggregate diagnostics when any residual or unresolved wikilink remains.
 */
export function convertWikilinks(markdown, { locale, titles }) {
  const diagnostics = [];
  const output = splitByCodeRegions(markdown).map((region) => {
    if (region.isCode) return region.text;

    const converted = region.text.replace(/\[\[([a-z0-9/-]+)(?:#([a-z0-9-]+))?\]\]/g, (source, target, anchor) => {
      const title = titles.get(target);
      if (!title) {
        diagnostics.push(`unresolved wikilink: ${anchor ? `${target}#${anchor}` : target}`);
        return source;
      }
      const localePrefix = locale === 'en' ? '' : `${locale}/`;
      return `[${title}](/ambercast/${localePrefix}${target}/${anchor ? `#${anchor}` : ''})`;
    });

    for (const residual of converted.matchAll(/\[\[[^\n]*/g)) {
      diagnostics.push(`malformed wikilink: ${residual[0]}`);
    }
    return converted;
  }).join('');

  if (diagnostics.length) throw new Error(diagnostics.join('\n'));
  return output;
}
