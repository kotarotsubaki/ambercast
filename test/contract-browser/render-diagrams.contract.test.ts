import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error The website's JavaScript module has no TypeScript declarations.
import { diagramId } from '../../website/scripts/lib/mermaid-fences.mjs';
// @ts-expect-error The website's JavaScript module has no TypeScript declarations.
import { renderDiagrams } from '../../website/scripts/render-diagrams.mjs';
// @ts-expect-error The website fixture uses a .ts import outside the root tsconfig's extension setting.
import { createDocsFixture } from '../../website/test/cli-fixture.ts';
import { resolveChromiumAvailability } from './support/chromium-availability.js';

const spec = 'docs/spec';
const fence = (body: string, open = '```mermaid alt="diagram"', close = '```') => `${open}\n${body}\n${close}\n`;
const body = 'flowchart LR\n  A --> B';
function fixture(files: Record<string, string> = {}) { const f = createDocsFixture(files); mkdirSync(f.website, { recursive: true }); return f; }
function paths(f: ReturnType<typeof fixture>) { return { roots: { docsRoot: join(f.root, 'website/src/content/docs'), specRoot: join(f.root, 'docs/spec'), skillRoot: join(f.root, '.agents/skills/docs-writing/references/blocks.mdx') }, outDir: join(f.website, 'public/diagrams') }; }
function asset(f: ReturnType<typeof fixture>, id: string, theme: 'light' | 'dark') { return join(paths(f).outDir, `${id}.${theme}.svg`); }

let chromiumAvailable = false;

beforeAll(async () => {
  chromiumAvailable = await resolveChromiumAvailability(() => chromium.launch());
});

beforeEach((context) => {
  if (!chromiumAvailable) context.skip('Chromium is unavailable for this opt-in contract lane; run `npx playwright install chromium` once.');
});

describe('Mermaid diagram rendering real-Chromium contract', () => {
  it('produces byte-identical SVGs across two real Chromium renders', async () => { const f = fixture({ [`${spec}/a.md`]: fence(body) }); try { await renderDiagrams(paths(f)); const id = diagramId(body); const first = ['light', 'dark'].map((theme) => readFileSync(asset(f, id, theme as 'light' | 'dark'))); rmSync(paths(f).outDir, { recursive: true, force: true }); await renderDiagrams(paths(f)); for (const [i, theme] of (['light', 'dark'] as const).entries()) expect(readFileSync(asset(f, id, theme))).toEqual(first[i]); } finally { f.dispose(); } });
});
