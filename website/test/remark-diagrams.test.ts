import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { remarkDiagrams } from '../scripts/lib/remark-diagrams.mjs';
import { createDocsFixture } from './cli-fixture.ts';

const fixtures: ReturnType<typeof createDocsFixture>[] = [];
afterEach(() => fixtures.splice(0).forEach((fixture) => fixture.dispose()));
const setup = (body = 'graph TD\nA-->B') => { const fixture = createDocsFixture({}); fixtures.push(fixture); const dir = join(fixture.website, 'public/diagrams'); mkdirSync(dir, { recursive: true }); const id = createHash('sha256').update(body).digest('hex').slice(0, 12); return { dir, id, body }; };
const node = (lang: string, value: string, meta?: string) => ({ type: 'code', lang, meta, value });

describe('remarkDiagrams', () => {
  it('replaces a Mermaid code node with two escaped, themed image references', async () => { const { dir, id, body } = setup(); for (const theme of ['light', 'dark']) writeFileSync(join(dir, `${id}.${theme}.svg`), '<svg/>'); const tree: any = { type: 'root', children: [node('mermaid', body, 'alt="A & <B>"')] }; await remarkDiagrams({ base: '/ambercast', publicDiagramsDir: dir })(tree); expect(tree.children).toEqual([{ type: 'html', value: `<figure class="ac-diagram"><img class="ac-diagram-light" src="/ambercast/diagrams/${id}.light.svg" alt="A &amp; &lt;B&gt;"><img class="ac-diagram-dark" src="/ambercast/diagrams/${id}.dark.svg" alt="A &amp; &lt;B&gt;"></figure>` }]); });
  it('leaves other code languages untouched', async () => { const { dir, body } = setup(); const code = node('js', body); const tree: any = { type: 'root', children: [code] }; await remarkDiagrams({ publicDiagramsDir: dir })(tree); expect(tree.children[0]).toBe(code); });
  for (const meta of [undefined, 'description="x"', 'alt="x" extra']) it(`rejects invalid metadata ${String(meta)}`, async () => { const { dir, id, body } = setup(); for (const theme of ['light', 'dark']) writeFileSync(join(dir, `${id}.${theme}.svg`), '<svg/>'); const transform = remarkDiagrams({ publicDiagramsDir: dir }); const valid: any = { type: 'root', children: [node('mermaid', body, 'alt="Valid"')] }; await transform(valid); expect(valid.children[0].type).toBe('html'); await expect(transform({ type: 'root', children: [node('mermaid', body, meta)] })).rejects.toThrow(); });
  for (const missing of ['light', 'dark']) it(`names a missing ${missing} SVG`, async () => { const { dir, id, body } = setup(); const present = missing === 'light' ? 'dark' : 'light'; writeFileSync(join(dir, `${id}.${present}.svg`), '<svg/>'); await expect(remarkDiagrams({ publicDiagramsDir: dir })({ type: 'root', children: [node('mermaid', body, 'alt="Diagram"')] })).rejects.toThrow(`${id}.${missing}.svg`); });
});
