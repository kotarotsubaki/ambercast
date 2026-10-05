import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ExpressiveCodeEngine } from '@expressive-code/core';
import { toHtml } from '@expressive-code/core/hast';
import { pluginLineNumbers } from '@expressive-code/plugin-line-numbers';
import { pluginCollapsibleSections } from '@expressive-code/plugin-collapsible-sections';

const engine = new ExpressiveCodeEngine({ plugins: [pluginLineNumbers(), pluginCollapsibleSections()], defaultProps: { showLineNumbers: false } });
const render = async (meta = '') => toHtml((await engine.render({ code: 'first\nsecond\nthird', language: 'text', meta })).renderedGroupAst);

describe('TEST-13 Expressive Code plugins', () => {
  it('registers both plugins in the Astro configuration', () => { const config = readFileSync(new URL('../astro.config.mjs', import.meta.url), 'utf8'); expect(config).toMatch(/\bpluginLineNumbers\s*\(/); expect(config).toMatch(/\bpluginCollapsibleSections\s*\(/); });
  it('shows line number gutters when enabled per block', async () => { expect(await render('showLineNumbers')).toMatch(/class="ln"/); });
  it('omits line number gutters by default', async () => { expect(await render()).not.toMatch(/class="ln"/); });
  it('marks collapsed sections from fence metadata', async () => { expect(await render('collapse={2-3}')).toMatch(/class="ec-section/); });
  it('omits collapsed sections without fence metadata', async () => { expect(await render()).not.toMatch(/class="ec-section/); });
});
