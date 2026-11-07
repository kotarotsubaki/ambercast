/**
 * Documentation check that keeps Mermaid fences out of the documentation sources.
 *
 * Diagrams on the site are shared `ac-flow` HTML figures that work in `.md` and
 * `.mdx` alike. Nothing renders a Mermaid fence, so it would reach readers as a
 * raw code block; the check refuses the fence and tells the author what to use.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Finding message shared by every violation. It names the replacement so the
 * author does not have to look up the rule.
 */
export const MERMAID_MESSAGE = 'Mermaid fences are not supported; draw the diagram as the shared `ac-flow` HTML figure (see .agents/skills/docs-writing/references/blocks.mdx).';

/**
 * Report every Mermaid code fence opening under the given roots.
 *
 * @param {{ roots: string[] }} params - Directories scanned recursively for `.md` and `.mdx` files; a missing directory is skipped.
 * @returns {Promise<Array<{ rule: 'mermaid-fence', page: string, line: number, message: string }>>} One finding per opening line, in file-walk order. `page` is the file path joined from the root as given, so same-named files under different roots stay distinguishable, and `line` is 1-based and counts CRLF and LF line ends alike.
 * @remarks Detection is deliberately line based and independent of the shared
 * fence tokenizer. That tokenizer needs LF input and a restricted indentation
 * and nesting grammar, so a normal fence closed with unusual indentation, a
 * CRLF file, or a fence inside a blockquote or list item can hide a later
 * Mermaid fence from it. A line is a violation when, after optional
 * indentation, blockquote markers and list markers, it opens a backtick or
 * tilde fence whose first info token is exactly lowercase `mermaid` (`mermaidx`
 * and `Mermaid` are different languages). A Mermaid opening shown inside a
 * longer outer fence is also reported: the rule is not to use Mermaid, and a
 * literal example can be written without that exact opening line.
 */
export async function checkNoMermaid({ roots }) {
  const findings = [];
  for (const root of roots) await walk(root, findings);
  return findings;
}

// The prefix grammar is a deliberate superset of CommonMark's container rules
// (any order and depth), because over-reporting an odd prefix costs nothing
// while a missed fence defeats the check.
const MERMAID_OPENING = /^(?:[ \t]|>|[-*+][ \t]|\d{1,9}[.)][ \t])*(?:`{3,}|~{3,})[ \t]*mermaid(?=\s|$)/;

async function walk(directory, findings) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path, findings);
    else if (entry.isFile() && /\.mdx?$/.test(entry.name)) {
      const lines = (await readFile(path, 'utf8')).split(/\r?\n/);
      lines.forEach((text, index) => {
        if (MERMAID_OPENING.test(text)) findings.push({ rule: 'mermaid-fence', page: path, line: index + 1, message: MERMAID_MESSAGE });
      });
    }
  }
}

// The CLI participates in the final documentation check step. It runs from
// `website/`, resolves the roots below from that directory, prints each finding
// object to stderr as the other checks do, and exits 0 with no findings, 1 with
// findings, and 1 when a root cannot be read (the error is printed; a missing
// root is not an error).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cwd = process.cwd();
  try {
    const findings = await checkNoMermaid({
      roots: [
        resolve(cwd, 'src/content/docs'),
        resolve(cwd, '../docs'),
        resolve(cwd, '../skills'),
        resolve(cwd, '../.agents/skills/docs-writing/references'),
      ],
    });
    for (const finding of findings) console.error(finding);
    process.exitCode = findings.length ? 1 : 0;
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
