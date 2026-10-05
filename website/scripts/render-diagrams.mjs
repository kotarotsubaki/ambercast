/**
 * Produce the SVG assets consumed by the documentation build.
 */

import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { collectMermaidFences, matchMermaidFenceOpen, parseAlt } from './lib/mermaid-fences.mjs';
import { splitFencedCodeRegions } from './lib/wikilinks.mjs';

async function validateAlt(roots) {
  async function checkFile(file) {
    const source = (await readFile(file, 'utf8')).replace(/\r\n/g, '\n');
    let line = 1;
    for (const region of splitFencedCodeRegions(source)) {
      if (region.isCode) {
        const open = matchMermaidFenceOpen(region.text.split('\n', 1)[0]);
        if (open && parseAlt(open.info) === null) {
          throw new Error(`Invalid Mermaid alt at ${file}:${line}`);
        }
      }
      line += (region.text.match(/\n/g) ?? []).length;
    }
  }

  async function walk(root, accepts, optional = false) {
    if (!root) return;
    let entries;
    try { entries = await readdir(root, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT' && optional) return; throw error; }
    for (const entry of entries) {
      const path = join(root, entry.name);
      if (entry.isDirectory()) await walk(path, accepts, optional);
      else if (entry.isFile() && accepts(entry.name)) await checkFile(path);
    }
  }

  await walk(roots.specRoot, (name) => name.endsWith('.md'), true);
  if (roots.docsRoot) {
    let entries;
    try { entries = await readdir(roots.docsRoot, { withFileTypes: true }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (const entry of entries ?? []) {
      if (entry.name === 'spec') continue;
      const path = join(roots.docsRoot, entry.name);
      if (entry.isDirectory()) await walk(path, (name) => /\.mdx?$/.test(name));
      else if (entry.isFile() && /\.mdx?$/.test(entry.name)) await checkFile(path);
    }
  }
  if (roots.skillRoot) {
    try { await checkFile(roots.skillRoot); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

async function createRenderer() {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.addScriptTag({ path: fileURLToPath(import.meta.resolve('mermaid/dist/mermaid.min.js')) });
    return {
      render: (id, body) => page.evaluate(async ({ id, body }) => {
        const variants = {};
        for (const [variant, theme] of [['light', 'neutral'], ['dark', 'dark']]) {
          window.mermaid.initialize({ theme, securityLevel: 'strict', deterministicIds: true, deterministicIDSeed: id });
          variants[variant] = (await window.mermaid.render(id, body)).svg;
        }
        return variants;
      }, { id, body }),
      close: () => browser.close(),
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

/**
 * Render Mermaid fences and publish their SVG assets as a complete batch.
 *
 * @param {{ roots: { docsRoot: string, specRoot: string, skillRoot: string }, outDir: string, renderer?: Function }} params - `roots` is passed to `collectMermaidFences`; `outDir` holds generated SVGs, and `renderer` optionally supplies both theme variants.
 * @returns {Promise<void>} Resolves after the complete batch has been published.
 * @throws {Error} If collection, rendering, or publication fails.
 * @remarks The renderer can be injected so tests can exercise the publication
 * contract without launching a browser. IDs with an existing light/dark SVG
 * pair need no redraw; a newly rendered ID succeeds only when both variants
 * are ready. Each SVG is first written as `<target>.tmp-<random>`. Every render
 * must succeed before temporary files are renamed to destinations. If
 * publication fails partway through, files
 * published by this invocation are rolled back while assets from earlier
 * invocations remain intact; a partial new batch must never remain visible.
 * Only after every rename succeeds are orphan SVGs for IDs absent from the
 * current fence set deleted. If orphan cleanup partly fails, deleted files
 * stay deleted, remaining failures are reported to stderr, and rendering
 * still exits successfully (status 0).
 */
export async function renderDiagrams({ roots, outDir, renderer }) {
  await validateAlt(roots);
  const fences = await collectMermaidFences(roots);
  const unique = new Map(fences.map(({ id, body }) => [id, body]));
  await mkdir(outDir, { recursive: true });
  const missing = [];
  for (const [id, body] of unique) {
    const targets = ['light', 'dark'].map((theme) => join(outDir, `${id}.${theme}.svg`));
    const present = await Promise.all(targets.map(async (target) => {
      try { await access(target); return true; }
      catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    }));
    if (!present.every(Boolean)) missing.push({ id, body, targets, present });
  }

  const pending = [];
  const placed = [];
  let realRenderer;
  try {
    if (missing.length && !renderer) {
      realRenderer = await createRenderer();
      renderer = realRenderer.render;
    }
    for (const { id, body, targets, present } of missing) {
      const variants = await renderer(id, body);
      for (const [index, theme] of ['light', 'dark'].entries()) {
        if (typeof variants?.[theme] !== 'string') throw new Error(`Missing ${theme} SVG for ${id}`);
        if (present[index]) continue;
        const temp = `${targets[index]}.tmp-${randomUUID()}`;
        pending.push({ temp, target: targets[index] });
        await writeFile(temp, variants[theme]);
      }
    }
    for (const { temp, target } of pending) {
      await rename(temp, target);
      placed.push(target);
    }
  } catch (error) {
    const results = await Promise.allSettled([...placed, ...pending.map(({ temp }) => temp)].map((path) => rm(path, { force: true })));
    for (const result of results) {
      if (result.status === 'rejected') console.error('Could not remove a partially published diagram during rollback:', result.reason);
    }
    throw error;
  } finally {
    await realRenderer?.close();
  }

  const expected = new Set([...unique.keys()].flatMap((id) => [`${id}.light.svg`, `${id}.dark.svg`]));
  for (const entry of await readdir(outDir)) {
    if (!entry.endsWith('.svg') || expected.has(entry)) continue;
    try { await rm(join(outDir, entry)); }
    catch (error) { console.error(`Could not remove orphan SVG ${entry}:`, error); }
  }
}

// The CLI uses the same batch contract as programmatic callers.
if (import.meta.url === `file://${process.argv[1]}`) {
  const cwd = process.cwd();
  renderDiagrams({
    roots: {
      docsRoot: resolve(cwd, 'src/content/docs'),
      specRoot: resolve(cwd, '../docs/spec'),
      skillRoot: resolve(cwd, '../.agents/skills/docs-writing/references/blocks.mdx'),
    },
    outDir: resolve(cwd, 'public/diagrams'),
  }).catch((error) => { console.error(error); process.exitCode = 1; });
}
