/**
 * Shared Mermaid fence rules for the raw-source renderer and the mdast plugin.
 * Both paths must derive the same ID from the same source fence or generated
 * images cannot be resolved during the site build.
 */

import crypto from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join, relative, posix } from 'node:path';

/**
 * Derive a stable ID from a normalized Mermaid body.
 *
 * @param {string} body - The normalized diagram body.
 * @returns {string} The first 12 lowercase hexadecimal characters of its SHA-256 digest.
 * @remarks The 48-bit prefix has negligible collision probability for this corpus.
 */
export function diagramId(body) {
  return crypto.createHash('sha256').update(body).digest('hex').slice(0, 12);
}

/**
 * Read accessible alternative text from Mermaid fence metadata.
 *
 * @param {string} infoOrMeta - The fence info or mdast metadata to validate.
 * @returns {string | null} The nonempty alternative text, or `null` for invalid metadata.
 * @remarks Only a standalone double-quoted `alt="…"` field without a raw newline
 * is accepted. Allowing adjacent tokens or other quoting forms would introduce
 * unsupported metadata syntax. The alt field must be the only metadata present
 * (no other tokens before or after).
 */
export function parseAlt(infoOrMeta) {
  // The info string is like "mermaid alt="diagram"" or just "alt="diagram""
  // We need to extract alt="..." and verify nothing follows it
  const match = /alt="([^\n"]*)"/.exec(infoOrMeta);
  if (!match) return null;
  const value = match[1];
  if (value === '') return null;

  // Verify alt="..." is the only metadata (no trailing content)
  const altEndIndex = match.index + match[0].length;
  const remaining = infoOrMeta.slice(altEndIndex).trim();
  if (remaining !== '') return null;

  // Also verify no content before alt="..."
  const prefix = infoOrMeta.slice(0, match.index).trim();
  if (prefix !== '' && prefix !== 'mermaid') return null;

  return value;
}

/**
 * Normalize the content of a fenced code block for hashing.
 *
 * @param {string[]} contentLines - Lines between the opening and closing fences.
 * @param {number} indent - Opening fence indentation in spaces.
 * @returns {string} The normalized body with LF line separators.
 * @remarks CommonMark removes up to the opening fence's indentation from each
 * content line. Matching that rule keeps raw-source IDs equal to mdast `code.value` IDs.
 */
export function extractFenceBody(contentLines, indent) {
  const re = new RegExp(`^ {0,${indent}}`);
  return contentLines.map((line) => line.replace(re, '')).join('\n');
}

/**
 * Recognize an opening Mermaid code fence in a source line.
 *
 * @param {string} line - The source line to inspect.
 * @returns {{ indent: number, fence: string, info: string } | null} The fence details, or `null` when it does not match.
 * @remarks The first info token must be exactly lowercase `mermaid`; a prefix
 * such as `mermaidx` and case variants are different languages.
 */
export function matchMermaidFenceOpen(line) {
  // Match backtick fence: info string excludes backticks and newlines (CommonMark ambiguity rule)
  let match = /^( {0,3})(`{3,})([^`\n]*)$/.exec(line);
  if (!match) {
    // Match tilde fence: info string excludes only newlines (backticks allowed)
    match = /^( {0,3})(~{3,})([^\n]*)$/.exec(line);
  }
  if (!match) return null;

  const indent = match[1].length;
  const fence = match[2];
  const info = match[3].trim();

  // First info token must be exactly 'mermaid'
  const firstToken = info.split(/\s+/)[0];
  if (firstToken !== 'mermaid') return null;

  return { indent, fence, info };
}

/**
 * Collect Mermaid fences from the diagram pipeline's documented source roots.
 *
 * @param {{ docsRoot: string, specRoot: string, skillRoot: string }} params - `specRoot` covers `docs/spec/**&#47;*.md`; `docsRoot` covers `website/src/content/docs/**&#47;*.{md,mdx}` except synchronized `src/content/docs/spec/*.md`; `skillRoot` is an optional file path ignored when absent.
 * @returns {Promise<{ file: string, line: number, id: string, body: string, alt: string | null }[]>} Source locations and normalized diagram data.
 * @remarks Scanning is limited to specification Markdown, website documentation
 * Markdown/MDX outside the synchronized spec copy, and the optional blocks
 * reference (`.agents/skills/docs-writing/references/blocks.mdx`). The broader docs corpus includes unrelated README, agent, and
 * fixture files, whose future edits must not affect diagram output. Source
 * text is normalized from CRLF to LF once before scanning. `splitFencedCodeRegions`
 * identifies fence regions and their source lines; `matchMermaidFenceOpen`
 * selects Mermaid fences, `extractFenceBody` derives each body, `diagramId`
 * derives its ID, and `parseAlt` reads its alt metadata. The raw scanner
 * and mdast have asymmetric blind spots around blockquote-nested fences and
 * fences inside HTML comments; the supported pages use neither form.
 */
export async function collectMermaidFences({ docsRoot, specRoot, skillRoot }) {
  const { stat } = await import('node:fs/promises');
  const { splitFencedCodeRegions } = await import('./wikilinks.mjs');

  const results = [];

  async function scanFile(filePath, fileContent) {
    const content = fileContent.replace(/\r\n/g, '\n');
    const regions = splitFencedCodeRegions(content);

    let charIndex = 0;
    let line = 1;

    for (const region of regions) {
      if (!region.isCode) {
        for (const ch of region.text) {
          if (ch === '\n') line++;
        }
        charIndex += region.text.length;
        continue;
      }

      const codeText = region.text;
      const lines = codeText.split('\n');

      const firstLine = lines[0];
      if (firstLine.startsWith('> ')) {
        for (const ch of region.text) {
          if (ch === '\n') line++;
        }
        charIndex += region.text.length;
        continue;
      }

      if (lines.length < 2) {
        for (const ch of region.text) {
          if (ch === '\n') line++;
        }
        charIndex += region.text.length;
        continue;
      }

      const openMatch = matchMermaidFenceOpen(lines[0]);
      if (!openMatch) {
        for (const ch of region.text) {
          if (ch === '\n') line++;
        }
        charIndex += region.text.length;
        continue;
      }

      const contentLines = lines.slice(1);

      const closePattern = new RegExp(`^ {0,${openMatch.indent}}${openMatch.fence[0]}{${openMatch.fence.length},}[ \\t]*$`);
      let closeLineIndex = -1;
      for (let i = 0; i < contentLines.length; i++) {
        if (closePattern.test(contentLines[i])) {
          closeLineIndex = i;
          break;
        }
      }

      if (closeLineIndex === -1) {
        for (const ch of region.text) {
          if (ch === '\n') line++;
        }
        charIndex += region.text.length;
        continue;
      }

      const body = extractFenceBody(contentLines.slice(0, closeLineIndex), openMatch.indent);
      const alt = parseAlt(openMatch.info);

      if (alt === null) {
        for (const ch of region.text) {
          if (ch === '\n') line++;
        }
        charIndex += region.text.length;
        continue;
      }

      const id = diagramId(body);

      results.push({
        file: filePath,
        line: line,
        id,
        body,
        alt,
      });

      line += closeLineIndex + 1;
    }
  }

  async function walk(relativePath, accept, rootDir) {
    let children;
    try { children = await readdir(join(rootDir, relativePath), { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const child of children) {
      const path = posix.join(relativePath, child.name);
      if (child.isDirectory()) await walk(path, accept, rootDir);
      else if (child.isFile() && accept(path)) {
        const filePath = join(rootDir, path);
        const content = await import('node:fs/promises').then(m => m.readFile(filePath, 'utf8'));
        await scanFile(filePath, content);
      }
    }
  }

  if (specRoot) {
    await walk('', (path) => path.endsWith('.md'), specRoot);
  }

  if (docsRoot) {
    await walk('', (path) => {
      if (!path.endsWith('.md') && !path.endsWith('.mdx')) return false;
      // Exclude synchronized spec copy (only .md files)
      if (path.startsWith('spec' + '/') || path.startsWith('spec\\')) {
        return !path.endsWith('.md');
      }
      return true;
    }, docsRoot);
  }

  if (skillRoot) {
    try {
      const st = await stat(skillRoot);
      if (st.isFile()) {
        const content = await import('node:fs/promises').then(m => m.readFile(skillRoot, 'utf8'));
        await scanFile(skillRoot, content);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  return results;
}
