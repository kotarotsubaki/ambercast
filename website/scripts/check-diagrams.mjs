/**
 * Validate diagram assets and metadata as part of the documentation checks.
 */

import { access, readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve, posix } from 'node:path';
import { collectMermaidFences, diagramId, extractFenceBody, matchMermaidFenceOpen, parseAlt } from './lib/mermaid-fences.mjs';
import { splitFencedCodeRegions } from './lib/wikilinks.mjs';

/**
 * Report missing SVG pairs, unused diagram assets, and invalid alternative text.
 *
 * @param {{ docsRoot: string, specRoot: string, skillRoot: string, publicDiagramsDir: string }} params - Source roots and generated asset directory.
 * @returns {Promise<Array<{ rule: string, page?: string, id?: string, line?: number, filename?: string }>>} The collected violations.
 * @remarks `diagram-stale`, `diagram-orphan`, and `diagram-alt-missing` are
 * independent findings. A fence with invalid alt metadata and a missing SVG
 * pair reports both facts, so fixing one does not conceal the other.
 * `diagram-stale` reports page and ID when either theme SVG is missing;
 * `diagram-alt-missing` reports page and line when `parseAlt` rejects metadata.
 * `diagram-orphan` reports the filename of any asset not exactly matching a
 * current ID's `<id>.light.svg` or `<id>.dark.svg`, including unexpected
 * extensions. When called from the CLI, any violation causes a nonzero exit.
 */
export async function checkDiagrams({ docsRoot, specRoot, skillRoot, publicDiagramsDir }) {
  const fences = await collectMermaidFences({ docsRoot, specRoot, skillRoot });
  const findings = [];

  async function scanInvalidAlt(file) {
    const source = (await readFile(file, 'utf8')).replace(/\r\n/g, '\n');
    let line = 1;
    for (const region of splitFencedCodeRegions(source)) {
      if (region.isCode) {
        const lines = region.text.split('\n');
        const open = matchMermaidFenceOpen(lines[0]);
        if (open && parseAlt(open.info) === null) {
          const close = new RegExp(`^ {0,${open.indent}}${open.fence[0]}{${open.fence.length},}[ \\t]*$`);
          const end = lines.findIndex((value, index) => index > 0 && close.test(value));
          if (end !== -1) {
            const body = extractFenceBody(lines.slice(1, end), open.indent);
            fences.push({ file, line, id: diagramId(body), body, alt: null });
            findings.push({ rule: 'diagram-alt-missing', page: file, line });
          }
        }
      }
      line += (region.text.match(/\n/g) ?? []).length;
    }
  }

  async function walk(root, accepts, relativePath = '') {
    if (!root) return;
    let entries;
    try { entries = await readdir(root, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const entryRelPath = relativePath ? posix.join(relativePath, entry.name) : entry.name;
      const path = join(root, entry.name);
      if (entry.isDirectory()) await walk(path, accepts, entryRelPath);
      else if (entry.isFile() && accepts(entry.name, entryRelPath)) await scanInvalidAlt(path);
    }
  }

  await walk(specRoot, (name) => name.endsWith('.md'));
  await walk(docsRoot, (name, relPath) => {
    if (!relPath) return false;
    const parts = relPath.split(posix.sep);
    if (parts[0] === 'spec') {
      // Only .mdx files under spec/ are authored content; the synchronized .md copies are excluded.
      return name.endsWith('.mdx');
    }
    return /\.mdx?$/.test(name);
  });
  if (skillRoot) {
    try { if ((await stat(skillRoot)).isFile()) await scanInvalidAlt(skillRoot); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }

  const expected = new Set(fences.flatMap(({ id }) => [`${id}.light.svg`, `${id}.dark.svg`]));
  for (const { file, id } of fences) {
    const present = await Promise.all(['light', 'dark'].map(async (theme) => {
      try { await access(join(publicDiagramsDir, `${id}.${theme}.svg`)); return true; }
      catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    }));
    if (!present.every(Boolean)) findings.push({ rule: 'diagram-stale', page: file, id });
  }

  let assets;
  try { assets = await readdir(publicDiagramsDir, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') assets = []; else throw error; }
  for (const asset of assets) {
    if (asset.isFile() && !expected.has(asset.name)) {
      findings.push({ rule: 'diagram-orphan', filename: asset.name });
    }
  }
  return findings;
}

// The CLI participates in the final documentation check step.
if (import.meta.url === `file://${process.argv[1]}`) {
  const cwd = process.cwd();
  try {
    const findings = await checkDiagrams({
      docsRoot: resolve(cwd, 'src/content/docs'),
      specRoot: resolve(cwd, '../docs/spec'),
      skillRoot: resolve(cwd, '../.agents/skills/docs-writing/references/blocks.mdx'),
      publicDiagramsDir: resolve(cwd, 'public/diagrams'),
    });
    for (const finding of findings) console.error(finding);
    process.exitCode = findings.length ? 1 : 0;
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
