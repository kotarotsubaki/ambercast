/**
 * Parses the site's deliberately small YAML-frontmatter subset into the metadata needed by
 * the llms artifacts. The parser follows the parity checker's CRLF-tolerant leading-block
 * convention so both build-time consumers agree about where document content begins.
 *
 * Omitted `status` defaults to `available`. The content schema keeps that field optional, but
 * generated indexes require an explicit publication state for every page; an omitted status means
 * the page is available and published.
 *
 * @param {string} markdown Complete Markdown or MDX source text.
 * @returns {{ title: string, description: string | undefined, status: 'available' | 'planned', body: string }}
 * Parsed metadata and the source after its frontmatter block, without modifying that body.
 * @throws {Error} If the leading frontmatter block or its `title` is missing, or if a supplied
 * `status` is not `available` or `planned`.
 */
export function parseFrontmatter(markdown) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
  if (!match) throw new Error('Missing leading frontmatter block');

  const valueFor = (key) => {
    const value = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(match[1])?.[1]?.trim();
    return value === undefined ? undefined : value.replace(/^(['"])(.*)\1$/, '$2');
  };
  const title = valueFor('title');
  const description = valueFor('description');
  const suppliedStatus = valueFor('status');
  const status = suppliedStatus ?? 'available';

  if (!title) throw new Error('Frontmatter title is required');
  if (status !== 'available' && status !== 'planned') throw new Error(`Invalid frontmatter status: ${status}`);

  return { title, description, status, body: markdown.slice(match[0].length) };
}
