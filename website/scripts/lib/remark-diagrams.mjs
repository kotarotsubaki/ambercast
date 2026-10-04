/**
 * Replace Mermaid code nodes with references to pre-rendered SVG pairs.
 */

import { access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { visit } from 'unist-util-visit';
import { diagramId, parseAlt } from './mermaid-fences.mjs';

/**
 * Create a remark transformer for Mermaid diagrams.
 *
 * @param {{ base?: string, publicDiagramsDir?: string }} options - URL base and directory containing generated SVG assets.
 * @returns {Function} An asynchronous mdast transformer.
 * @throws {Error} During transformation, if `parseAlt` rejects metadata or either referenced SVG is absent.
 * @remarks mdast `code.value` already applies fence dedentation and newline
 * normalization. Hashing that value with the shared ID function must select
 * the same assets as the raw-source renderer. Only `code` nodes whose `lang`
 * is exactly `mermaid` are replaced. Invalid alt metadata and missing assets
 * fail the build rather than allowing broken image references into the site.
 * Each replacement is an HTML node containing `<figure class="ac-diagram">`
 * with both light and dark `<img>` elements; CSS displays only the image for
 * the active theme. Alt text is escaped for safe use in HTML attributes.
 */
export function remarkDiagrams({ base, publicDiagramsDir } = {}) {
  const diagramsDir = publicDiagramsDir ?? resolve(process.cwd(), 'public/diagrams');
  return async (tree) => {
    const nodes = [];
    visit(tree, 'code', (code, index, parent) => {
      if (code.lang === 'mermaid') nodes.push({ code, index, parent });
    });

    for (const { code, index, parent } of nodes) {
      const id = diagramId(code.value);
      const alt = code.meta == null ? null : parseAlt(code.meta);
      if (alt === null) throw new Error(`Invalid alt metadata for Mermaid diagram ${id}`);

      for (const theme of ['light', 'dark']) {
        const filename = `${id}.${theme}.svg`;
        try {
          await access(join(diagramsDir, filename));
        } catch {
          throw new Error(`Missing Mermaid diagram SVG: ${filename}`);
        }
      }

      const escapedAlt = alt.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      const prefix = base ?? '';
      parent.children[index] = {
        type: 'html',
        value: `<figure class="ac-diagram"><img class="ac-diagram-light" src="${prefix}/diagrams/${id}.light.svg" alt="${escapedAlt}"><img class="ac-diagram-dark" src="${prefix}/diagrams/${id}.dark.svg" alt="${escapedAlt}"></figure>`,
      };
    }
  };
}
