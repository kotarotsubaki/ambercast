import { createHash } from 'node:crypto';
import { splitFencedCodeRegions } from './wikilinks.mjs';

/**
 * Inventories documentation once while leaving scan policy to each consumer. The
 * walk returns slash-separated repository-relative paths: source entries cover
 * website Markdown/MDX except generated root-locale spec pages, docs/spec Markdown,
 * the root README variants, AGENTS.md, CONTRIBUTING.md, and the published skill;
 * golden entries cover llms text fixtures. File-specific locale assignments take
 * precedence over path inference; website ja/ and zh-cn/ prefixes and golden filename
 * prefixes select translations, with all remaining entries English. The role is
 * independent of the reading tool: hard claims scan sources only, whereas identifier
 * impact also scans goldens. An empty source partition is therefore detectable even
 * if goldens exist.
 *
 * @param {{ repoRoot: string }} options Repository root containing the documentation trees.
 * @returns {Promise<Array<{ path: string, role: 'source' | 'golden', locale: 'en' | 'ja' | 'zh-cn' }>>}
 * Corpus entries with their scan role and file-level locale.
 */
export async function listDocsCorpus({ repoRoot }) {
  const { readdir, stat } = await import('node:fs/promises');
  const { join, posix } = await import('node:path');
  const entries = [];
  async function walk(relative, accept, role) {
    let children;
    try { children = await readdir(join(repoRoot, relative), { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const child of children) {
      const path = posix.join(relative, child.name);
      if (child.isDirectory()) await walk(path, accept, role);
      else if (child.isFile() && accept(path)) add(path, role);
    }
  }
  function add(path, role) {
    const locale = /^README-ja\.md$/.test(path) || /^website\/src\/content\/docs\/ja\//.test(path) || /\/llms\/ja-/.test(path) ? 'ja'
      : /^README-zh-CN\.md$/.test(path) || /^website\/src\/content\/docs\/zh-cn\//.test(path) || /\/llms\/zh-cn-/.test(path) ? 'zh-cn' : 'en';
    entries.push({ path, role, locale });
  }
  for (const path of ['README.md', 'README-ja.md', 'README-zh-CN.md', 'AGENTS.md', 'CONTRIBUTING.md', 'skills/ambercast/SKILL.md']) {
    try { if ((await stat(join(repoRoot, path))).isFile()) add(path, 'source'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  await walk('website/src/content/docs', (path) => /\.mdx?$/.test(path) && !path.startsWith('website/src/content/docs/spec/'), 'source');
  await walk('docs/spec', (path) => path.endsWith('.md'), 'source');
  await walk('website/test/fixtures/llms', (path) => path.endsWith('.txt'), 'golden');
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Preserves inline command tokens while hiding examples and comments from claim checks.
 * The existing reference-table masker also removes inline code, so it cannot serve this
 * contract. The first pass uses splitFencedCodeRegions to replace non-newline
 * characters in fenced regions with spaces. A second pass over the joined document
 * blanks non-newline characters in every HTML comment; doing this after fence blanking
 * keeps comments inside fences inert and catches comments across region boundaries.
 * Line numbers and non-fence inline code remain unchanged for both claim and link scans.
 *
 * @param {string} markdown Markdown source.
 * @returns {string} Source with excluded spans blanked.
 */
export function maskForClaims(markdown) {
  const blank = (value) => value.replace(/[^\n]/g, ' ');
  return splitFencedCodeRegions(markdown).map(({ text, isCode }) => isCode ? blank(text) : text).join('').replace(/<!--[\s\S]*?-->/g, blank);
}

/**
 * Gives allowlist matches and advisory candidate keys the same line identity despite
 * incidental spacing. The input is a line after claim masking; the normalizer
 * trims it and collapses every whitespace run to one ASCII space, without changing case
 * or other content.
 *
 * @param {string} line Masked source line.
 * @returns {string} Trimmed line with whitespace runs collapsed.
 */
export function normalizeClaimLine(line) {
  return line.trim().replace(/\s+/g, ' ');
}

/**
 * Computes the shared allowlist identity so the hard checker and advisory tool agree
 * byte for byte. The digest is SHA-256 of the normalized line's UTF-8 bytes,
 * encoded as lowercase hexadecimal and truncated to its first 16 characters. Callers
 * normalize the masked line first; this function does not hash a path or rule.
 *
 * @param {string} normalizedLine Normalized claim text.
 * @returns {string} First 16 hexadecimal digits of its SHA-256 digest.
 */
export function claimHash(normalizedLine) {
  return createHash('sha256').update(normalizedLine, 'utf8').digest('hex').slice(0, 16);
}
