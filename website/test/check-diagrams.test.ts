import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkDiagrams } from '../scripts/check-diagrams.mjs';
import { createDocsFixture } from './cli-fixture.ts';

const fixtures: ReturnType<typeof createDocsFixture>[] = [];
afterEach(() => fixtures.splice(0).forEach((fixture) => fixture.dispose()));
const body = 'graph TD\nA-->B';
const id = createHash('sha256').update(body).digest('hex').slice(0, 12);
const fence = (meta = 'alt="Diagram"') => `\`\`\`mermaid ${meta}\n${body}\n\`\`\`\n`;
const setup = (source?: string) => { const fixture = createDocsFixture(source === undefined ? {} : { 'website/src/content/docs/guide.md': source }); fixtures.push(fixture); const publicDiagramsDir = join(fixture.website, 'public/diagrams'); mkdirSync(publicDiagramsDir, { recursive: true }); return { publicDiagramsDir, args: { docsRoot: join(fixture.website, 'src/content/docs'), specRoot: join(fixture.root, 'docs/spec'), skillRoot: join(fixture.root, '.agents/skills/docs-writing/references/blocks.mdx'), publicDiagramsDir } }; };

describe('checkDiagrams', () => {
  it('accepts a complete SVG pair', async () => { const { args, publicDiagramsDir } = setup(fence()); for (const theme of ['light', 'dark']) writeFileSync(join(publicDiagramsDir, `${id}.${theme}.svg`), '<svg/>'); expect(await checkDiagrams(args)).toEqual([]); });
  it('reports a missing theme as stale', async () => { const { args, publicDiagramsDir } = setup(fence()); writeFileSync(join(publicDiagramsDir, `${id}.light.svg`), '<svg/>'); expect(await checkDiagrams(args)).toContainEqual(expect.objectContaining({ rule: 'diagram-stale', id, page: expect.stringContaining('guide.md') })); });
  it('reports an unreferenced SVG as an orphan', async () => { const { args, publicDiagramsDir } = setup(); writeFileSync(join(publicDiagramsDir, `${id}.light.svg`), '<svg/>'); expect(await checkDiagrams(args)).toContainEqual(expect.objectContaining({ rule: 'diagram-orphan', filename: `${id}.light.svg` })); });
  it.each([`${id}.svg`, `${id}.preview.svg`])('reports a nonconforming filename for a referenced ID as an orphan: %s', async (filename) => { const { args, publicDiagramsDir } = setup(fence()); for (const theme of ['light', 'dark']) writeFileSync(join(publicDiagramsDir, `${id}.${theme}.svg`), '<svg/>'); writeFileSync(join(publicDiagramsDir, filename), '<svg/>'); expect(await checkDiagrams(args)).toContainEqual(expect.objectContaining({ rule: 'diagram-orphan', filename })); });
  it('reports invalid alt and a missing SVG pair independently', async () => { const { args } = setup(fence('alt=""')); const findings = await checkDiagrams(args); expect(findings).toContainEqual(expect.objectContaining({ rule: 'diagram-alt-missing', page: expect.stringContaining('guide.md'), line: 1 })); expect(findings).toContainEqual(expect.objectContaining({ rule: 'diagram-stale', page: expect.stringContaining('guide.md'), id })); });
  it('reports invalid alt in an authored MDX file inside the docs spec directory', async () => { const { args, publicDiagramsDir } = setup(); const page = join(args.docsRoot, 'spec/example.mdx'); mkdirSync(join(args.docsRoot, 'spec'), { recursive: true }); writeFileSync(page, fence('alt=""')); for (const theme of ['light', 'dark']) writeFileSync(join(publicDiagramsDir, `${id}.${theme}.svg`), '<svg/>'); expect(await checkDiagrams(args)).toContainEqual(expect.objectContaining({ rule: 'diagram-alt-missing', page, line: 1 })); });
  for (const meta of ['', 'alt=""', 'alt="Diagram" extra']) it(`reports invalid alt metadata ${JSON.stringify(meta)}`, async () => { const { args, publicDiagramsDir } = setup(fence(meta)); for (const theme of ['light', 'dark']) writeFileSync(join(publicDiagramsDir, `${id}.${theme}.svg`), '<svg/>'); expect(await checkDiagrams(args)).toContainEqual(expect.objectContaining({ rule: 'diagram-alt-missing', page: expect.stringContaining('guide.md'), line: 1 })); });
  it('accepts an empty fence set and empty SVG directory', async () => { const { args } = setup(); expect(await checkDiagrams(args)).toEqual([]); });
});
