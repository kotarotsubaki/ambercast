import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { checkDiagrams } from '../scripts/check-diagrams.mjs';
import { renderDiagrams } from '../scripts/render-diagrams.mjs';
import { createDocsFixture } from './cli-fixture.ts';

const scriptsDir = fileURLToPath(new URL('../scripts', import.meta.url));

/**
 * Copy check-diagrams.mjs and render-diagrams.mjs (with their shared lib/
 * dependency) into a subdirectory of the real scripts/ directory whose name
 * contains a space and a non-ASCII character, run the given callback with
 * both copies' paths, then always remove the copy -- proving each CLI's
 * fail-open guard fix (finding 1) actually runs from such a path, while
 * keeping bare-specifier imports (playwright-core, etc.) resolvable via the
 * real ancestor node_modules this copy still sits under.
 */
function withSpecialPathCopy(run) {
  const specialDir = join(scriptsDir, '.cli-guard-test café éé');
  cpSync(join(scriptsDir, 'lib'), join(specialDir, 'lib'), { recursive: true });
  cpSync(join(scriptsDir, 'check-diagrams.mjs'), join(specialDir, 'check-diagrams.mjs'));
  cpSync(join(scriptsDir, 'render-diagrams.mjs'), join(specialDir, 'render-diagrams.mjs'));
  try {
    return run({ checkDiagrams: join(specialDir, 'check-diagrams.mjs'), renderDiagrams: join(specialDir, 'render-diagrams.mjs') });
  } finally {
    rmSync(specialDir, { recursive: true, force: true });
  }
}

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
  for (const meta of ['', 'alt=""', 'alt="Diagram" extra', 'extra alt="Diagram"']) it(`reports invalid alt metadata ${JSON.stringify(meta)}`, async () => { const { args, publicDiagramsDir } = setup(fence(meta)); for (const theme of ['light', 'dark']) writeFileSync(join(publicDiagramsDir, `${id}.${theme}.svg`), '<svg/>'); expect(await checkDiagrams(args)).toContainEqual(expect.objectContaining({ rule: 'diagram-alt-missing', page: expect.stringContaining('guide.md'), line: 1 })); });
  it('accepts an empty fence set and empty SVG directory', async () => { const { args } = setup(); expect(await checkDiagrams(args)).toEqual([]); });
});

describe('check-diagrams.mjs and render-diagrams.mjs CLI guard (finding 1)', () => {
  it('runs check-diagrams.mjs for real from a path containing a space and a non-ASCII character, detecting a real orphan', () => {
    withSpecialPathCopy(({ checkDiagrams: checkDiagramsScript }) => {
      const fixture = createDocsFixture({});
      fixtures.push(fixture);
      const publicDiagramsDir = join(fixture.website, 'public/diagrams');
      mkdirSync(publicDiagramsDir, { recursive: true });
      writeFileSync(join(publicDiagramsDir, 'orphan.light.svg'), '<svg/>');
      const result = spawnSync(process.execPath, [checkDiagramsScript], { cwd: fixture.website, encoding: 'utf8' });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('diagram-orphan');
    });
  });

  it('runs render-diagrams.mjs for real from a path containing a space and a non-ASCII character, detecting a real invalid-alt violation', () => {
    withSpecialPathCopy(({ renderDiagrams: renderDiagramsScript }) => {
      const fixture = createDocsFixture({ 'docs/spec/a.md': '```mermaid\ngraph TD\nA-->B\n```\n' });
      fixtures.push(fixture);
      mkdirSync(fixture.website, { recursive: true });
      const result = spawnSync(process.execPath, [renderDiagramsScript], { cwd: fixture.website, encoding: 'utf8' });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(join(fixture.root, 'docs/spec/a.md'));
    });
  });
});

describe('render-diagrams.mjs render-error file/id wrapping (finding 2)', () => {
  it("names the failing fence's source file and diagram id when a renderer rejects, without launching a real browser", async () => {
    const fixture = createDocsFixture({ 'docs/spec/bad.md': '```mermaid alt="Diagram"\nflowchart TD\n  A --> B\n```\n' });
    fixtures.push(fixture);
    const specRoot = join(fixture.root, 'docs/spec');
    const outDir = join(fixture.website, 'public/diagrams');
    const renderBody = 'flowchart TD\n  A --> B';
    const id = createHash('sha256').update(renderBody).digest('hex').slice(0, 12);
    const filePath = join(fixture.root, 'docs/spec/bad.md');
    const renderer = async () => { throw new Error('mermaid parse error'); };
    let caught;
    try { await renderDiagrams({ roots: { specRoot }, outDir, renderer }); }
    catch (error) { caught = error; }
    expect(caught?.message).toContain(filePath);
    expect(caught?.message).toContain(id);
    expect(caught?.message).toContain('mermaid parse error');
    expect(caught?.cause).toBeInstanceOf(Error);
    expect(caught?.cause?.message).toBe('mermaid parse error');
  });
});
