import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkProse, main } from '../scripts/check-prose.mjs';
import { createDocsFixture, runEntryPoint } from './cli-fixture.ts';

const script = new URL('../scripts/check-prose.mjs', import.meta.url);
const docs = 'website/src/content/docs';
const configPath = 'website/prose-lint.json';
const base: any = { pages: [], limits: { h3Max: 5, calloutMax: 2, sentence: { en: { warn: 20, error: 30 }, ja: { warn: 60, error: 80 }, 'zh-cn': { warn: 50, error: 70 } }, paragraphSentencesMax: 3, passiveRatioWarn: 0.3, words: { tutorials: 600, 'how-to': 900, explanation: 1000, agents: 900 } }, bannedTerms: ['RawConfig'], requiredAnchors: { tutorials: ['prerequisites', 'steps', 'verification', 'next-steps'], 'how-to': ['prerequisites', 'steps', 'verification', 'related'] }, severity: {} };
const fixtures: ReturnType<typeof createDocsFixture>[] = [];
afterEach(() => fixtures.splice(0).forEach((f) => f.dispose()));
const runners = () => ({ textlint: vi.fn(async (_files: unknown): Promise<any[]> => []), zhlint: vi.fn(async (_text: unknown): Promise<any[]> => []) });
const path = (slug: string, locale = 'en', ext = 'md') => `${docs}/${locale === 'en' ? '' : `${locale}/`}${slug}.${ext}`;
function fixture(pages: string[] = [], files: Record<string, string> = {}, change: (c: any) => void = () => {}) {
  const c = structuredClone(base); c.pages = pages; change(c);
  const f = createDocsFixture({ [configPath]: JSON.stringify(c), ...files }); fixtures.push(f); return f;
}
const input = (f: ReturnType<typeof fixture>, r = runners(), report = false) => ({ docsRoot: join(f.root, docs), configPath: join(f.root, configPath), report, runners: r });
const cli = (f: ReturnType<typeof fixture>, args: string[] = []) => runEntryPoint(script, f.website, args);
const realWebsite = fileURLToPath(new URL('../', import.meta.url));
function enableRealTools(f: ReturnType<typeof fixture>) {
  writeFileSync(join(f.website, '.textlintrc.json'), readFileSync(join(realWebsite, '.textlintrc.json')));
  symlinkSync(join(realWebsite, 'node_modules'), join(f.website, 'node_modules'), 'dir');
}
const realRunners = () => ({
  async textlint(files: string[]) {
    const { createLinter, loadTextlintrc } = await import('textlint');
    const descriptor = await loadTextlintrc({ configFilePath: join(realWebsite, '.textlintrc.json'), node_modulesDir: join(realWebsite, 'node_modules') });
    const linter = createLinter({ descriptor });
    const results = await Promise.all(files.map((file) => linter.lintFiles([file])));
    return results.flatMap((result) => result.flatMap((entry) => entry.messages));
  },
  async zhlint(source: string) {
    const { run } = await import('zhlint');
    return run(source, { rules: { preset: 'default', skipAbbrs: [] } }).validations.map((validation) => ({ message: validation.message }));
  },
});
function exit2(f: ReturnType<typeof fixture>, code: string, args: string[] = []) {
  const p = cli(f, args); expect(p.status).toBe(2); expect(p.stdout).toBe('');
  expect(p.stderr).toMatch(new RegExp(`^check-prose: ${code}: [^\\n]+\\n$`));
}
async function scan(slug: string, body: string, locale = 'en', change: (c: any) => void = () => {}) {
  const f = fixture([slug], { [path(slug, locale)]: body }, change);
  return (await checkProse(input(f))).violations.filter((v: any) => v.locale === locale && v.rule !== 'page-missing');
}
const only = (list: any[], name: string) => list.filter((v) => v.rule === name);
const anchors = '## Prerequisites {#prerequisites}\n## Steps {#steps}\n## Verification {#verification}\n## Next steps {#next-steps}\n';

describe('TEST-1 configuration', () => {
  it('short-circuits empty pages without output', async () => { const f = fixture(); expect(await checkProse(input(f))).toEqual({ violations: [], report: null }); expect(cli(f)).toMatchObject({ status: 0, stdout: '' }); });
  it('detects residue before empty pages', async () => { const f = fixture([], { [path('preview-blocks', 'en', 'mdx')]: '# Preview' }); await expect(checkProse(input(f))).rejects.toMatchObject({ code: 'preview-residue' }); exit2(f, 'preview-residue'); });
  const invalid: [string, (c: any) => void][] = [
    ['unknown top-level key', (c) => { c.extra = 1; }], ['unknown nested key', (c) => { c.limits.extra = 1; }],
    ['pages not array', (c) => { c.pages = 'tutorials/x'; }], ['empty page', (c) => { c.pages = ['']; }],
    ['locale-prefixed page', (c) => { c.pages = ['ja/x']; }], ['page extension', (c) => { c.pages = ['x.md']; }],
    ['leading slash', (c) => { c.pages = ['/x']; }], ['trailing slash', (c) => { c.pages = ['tutorials/x/']; }],
    ['surrounding page whitespace', (c) => { c.pages = [' tutorials/x ']; }], ['unknown page group', (c) => { c.pages = ['other/x']; }],
    ['duplicate page', (c) => { c.pages = ['tutorials/x', 'tutorials/x']; }],
    ['duplicate banned term', (c) => { c.bannedTerms = ['RawConfig', 'RawConfig']; }], ['empty banned terms', (c) => { c.bannedTerms = []; }],
    ['non-string banned term', (c) => { c.bannedTerms = ['RawConfig', 42]; }],
    ['duplicate anchor', (c) => { c.requiredAnchors.tutorials = ['steps', 'steps']; }],
    ['non-array required anchors', (c) => { c.requiredAnchors.tutorials = 'steps'; }],
    ['non-string required anchor', (c) => { c.requiredAnchors.tutorials = ['steps', 42]; }],
    ['missing h3Max', (c) => { delete c.limits.h3Max; }], ['missing calloutMax', (c) => { delete c.limits.calloutMax; }],
    ['missing sentence.en.warn', (c) => { delete c.limits.sentence.en.warn; }],
    ['missing sentence.ja.warn', (c) => { delete c.limits.sentence.ja.warn; }],
    ['missing sentence.ja.error', (c) => { delete c.limits.sentence.ja.error; }],
    ['missing sentence.zh-cn.warn', (c) => { delete c.limits.sentence['zh-cn'].warn; }],
    ['missing sentence.zh-cn.error', (c) => { delete c.limits.sentence['zh-cn'].error; }],
    ['missing paragraphSentencesMax', (c) => { delete c.limits.paragraphSentencesMax; }],
    ['missing passiveRatioWarn', (c) => { delete c.limits.passiveRatioWarn; }], ['missing words', (c) => { delete c.limits.words; }],
    ['fractional integer', (c) => { c.limits.h3Max = 5.5; }], ['negative integer', (c) => { c.limits.h3Max = -1; }],
    ['non-finite limit', (c) => { c.limits.h3Max = Infinity; }], ['string limit', (c) => { c.limits.h3Max = '5'; }],
    ['warn equal error', (c) => { c.limits.sentence.en.warn = 30; }], ['ratio one', (c) => { c.limits.passiveRatioWarn = 1; }],
    ['ratio zero', (c) => { c.limits.passiveRatioWarn = 0; }],
    ['unknown anchor group', (c) => { c.requiredAnchors.other = ['x']; }], ['unknown words group', (c) => { c.limits.words.other = 10; }],
    ['malformed anchor', (c) => { c.requiredAnchors.tutorials = ['Bad ID']; }], ['invalid severity', (c) => { c.severity['textlint:x'] = 'fatal'; }],
  ];
  for (const [name, change] of invalid) it(`rejects ${name}`, async () => { const f = fixture([], {}, change); await expect(checkProse(input(f))).rejects.toMatchObject({ code: 'config-invalid' }); exit2(f, 'config-invalid'); });
  it('classifies missing config as io-failure', async () => { const f = fixture(); rmSync(join(f.root, configPath)); await expect(checkProse(input(f))).rejects.toMatchObject({ code: 'io-failure' }); exit2(f, 'io-failure'); });
  it('classifies config directory as io-failure', async () => { const f = fixture(); rmSync(join(f.root, configPath)); mkdirSync(join(f.root, configPath)); await expect(checkProse(input(f))).rejects.toMatchObject({ code: 'io-failure' }); exit2(f, 'io-failure'); });
  it('classifies invalid JSON as config-invalid', async () => { const f = fixture([], { [configPath]: '{' }); await expect(checkProse(input(f))).rejects.toMatchObject({ code: 'config-invalid' }); exit2(f, 'config-invalid'); });
});

describe('TEST-2 resolution and API contract', () => {
  it('reports two missing translations and exits one', async () => { const f = fixture(['tutorials/x'], { [path('tutorials/x')]: anchors }); const v = only((await checkProse(input(f))).violations, 'page-missing'); expect(v).toEqual(['ja', 'zh-cn'].map((locale) => expect.objectContaining({ check: 'prose', page: 'tutorials/x', locale, line: null, severity: 'error' }))); expect(cli(f).status).toBe(1); });
  it('reports three missing locales', async () => { const f = fixture(['reference/x']); expect(only((await checkProse(input(f))).violations, 'page-missing').map((v: any) => v.locale)).toEqual(['en', 'ja', 'zh-cn']); });
  it('reports md/mdx ambiguity', async () => { const f = fixture(['reference/x'], { [path('reference/x')]: '# X', [path('reference/x', 'en', 'mdx')]: '# X' }); expect(only((await checkProse(input(f))).violations, 'page-ambiguous')).toContainEqual(expect.objectContaining({ locale: 'en', page: 'reference/x', line: null, severity: 'error' })); });
  it('rejects an unreadable existing page', async () => { const f = fixture(['reference/x']); mkdirSync(join(f.root, path('reference/x')), { recursive: true }); await expect(checkProse(input(f))).rejects.toMatchObject({ code: 'io-failure' }); exit2(f, 'io-failure'); });
  it('warnings alone exit zero', async () => { const files = Object.fromEntries(['en', 'ja', 'zh-cn'].map((locale) => [path('reference/x', locale), locale === 'en' ? `${Array(21).fill('word').join(' ')}.` : '# X\n'])); const f = fixture(['reference/x'], files); const violations = (await checkProse(input(f))).violations; expect(violations).toContainEqual(expect.objectContaining({ rule: 'sentence-length', severity: 'warning' })); expect(violations.length).toBeGreaterThan(0); expect(violations.every((v: any) => v.severity === 'warning')).toBe(true); });
  it('warnings alone exit zero via the real CLI subprocess', () => { const files = Object.fromEntries(['en', 'ja', 'zh-cn'].map((locale) => [path('reference/x', locale), locale === 'en' ? `${Array(21).fill('word').join(' ')}.` : '# X\n'])); const f = fixture(['reference/x'], files); enableRealTools(f); expect(cli(f).status).toBe(0); });
  it('emits a real textlint finding as JSON Lines via the CLI subprocess', () => {
    const f = fixture(['reference/x'], { [path('reference/x', 'ja')]: '# X\n\nこれはテストです。\n\nこれは正しい。\n' });
    enableRealTools(f);
    const p = cli(f);
    expect(p.status).toBe(1);
    const violations = p.stdout.trim().split('\n').map((line) => JSON.parse(line));
    expect(violations).toContainEqual(expect.objectContaining({
      locale: 'ja', rule: expect.stringMatching(/^textlint:.*no-mix-dearu-desumasu/),
    }));
  });
  it('emits a real zhlint finding as JSON Lines via the CLI subprocess', () => {
    const f = fixture(['reference/x'], { [path('reference/x', 'zh-cn')]: '# X\n\n中文English混排。\n' });
    enableRealTools(f);
    const p = cli(f);
    expect(p.status).toBe(1);
    const violations = p.stdout.trim().split('\n').map((line) => JSON.parse(line));
    expect(violations).toContainEqual(expect.objectContaining({ locale: 'zh-cn', rule: 'zhlint' }));
  });
  it('sorts page, locale, null-first line, rule, actual', async () => {
    const f = fixture(['tutorials/a', 'reference/b'], { [path('tutorials/a')]: '#### alpha beta\n', [path('reference/b')]: '# X\n\n---\n' }, (c) => { c.requiredAnchors = {}; c.bannedTerms = ['beta', 'alpha']; });
    const key = (x: any) => [x.page, x.locale, x.line, x.rule, x.actual];
    expect((await checkProse(input(f))).violations.map(key)).toEqual([
      ['reference/b', 'en', 3, 'no-thematic-break', 'thematic break'],
      ['reference/b', 'ja', null, 'page-missing', expect.any(String)],
      ['reference/b', 'zh-cn', null, 'page-missing', expect.any(String)],
      ['tutorials/a', 'en', 1, 'banned-term', 'alpha'],
      ['tutorials/a', 'en', 1, 'banned-term', 'beta'],
      ['tutorials/a', 'en', 1, 'heading-depth', '4'],
      ['tutorials/a', 'ja', null, 'page-missing', expect.any(String)],
      ['tutorials/a', 'zh-cn', null, 'page-missing', expect.any(String)],
    ]);
  });
  for (const tool of ['textlint', 'zhlint'] as const) it(`maps ${tool} runner exceptions to tool-failure`, async () => { const locale = tool === 'textlint' ? 'ja' : 'zh-cn'; const f = fixture(['reference/x'], { [path('reference/x', locale)]: 'Text.' }); const r = runners(); r[tool].mockRejectedValue(new Error('failure')); await expect(checkProse(input(f, r))).rejects.toMatchObject({ code: 'tool-failure' }); });
  it('direct API throws a tagged Error and writes neither stream', async () => { const f = fixture([], { [configPath]: '{' }); const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true); const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true); try { await expect(checkProse(input(f))).rejects.toMatchObject({ code: 'config-invalid' }); expect(out).not.toHaveBeenCalled(); expect(err).not.toHaveBeenCalled(); } finally { out.mockRestore(); err.mockRestore(); } });
});

describe('TEST-3 structural rules', () => {
  for (const [name, body, line] of [['h4', '#### Deep\n', 1], ['Steps h4', '<Steps>\n\n1. #### Deep\n\n</Steps>\n', 3]] as const) it(`detects ${name}`, async () => { expect(only(await scan('reference/x', body, 'en', () => {}), 'heading-depth')).toEqual([expect.objectContaining({ line, severity: 'error', expected: '<= 3', actual: '4' })]); });
  for (const [count, n] of [[5, 0], [6, 1]] as const) it(`h3 count ${count}`, async () => { const v = only(await scan('reference/x', '### X\n'.repeat(count)), 'h3-count'); expect(v).toHaveLength(n); if (n) expect(v[0]).toMatchObject({ severity: 'error', expected: '<= 5', actual: '6' }); });
  it('reports each thematic break', async () => { expect(only(await scan('reference/x', '# X\n\n---\n\nText.\n\n***\n'), 'no-thematic-break')).toEqual([3, 7].map((line) => expect.objectContaining({ line, severity: 'error', expected: 'none', actual: 'thematic break' }))); });
  for (const [name, body] of [['fenced h4', '```md\n#### X\n```\n'], ['HTML h4', '<h4>X</h4>\n'], ['frontmatter', '---\ntitle: X\n---\n# X\n'], ['fenced break', '```md\n---\n```\n']] as const) it(`ignores ${name}`, async () => { const v = await scan('reference/x', body); expect(only(v, 'heading-depth')).toEqual([]); expect(only(v, 'no-thematic-break')).toEqual([]); });
});

describe('TEST-4/5/6 group rules', () => {
  it('bans RawConfig in tutorials with its line', async () => { expect(only(await scan('tutorials/x', `${anchors}RawConfig is here.\n`), 'banned-term')).toEqual([expect.objectContaining({ line: 5, severity: 'error', expected: 'absent', actual: 'RawConfig' })]); });
  it('does not ban RawConfig in reference', async () => { expect(only(await scan('reference/x', 'RawConfig is here.\n'), 'banned-term')).toEqual([]); });
  it('requires missing next-steps', async () => { expect(only(await scan('tutorials/x', '## Prerequisites {#prerequisites}\n## Steps {#steps}\n## Verification {#verification}\n'), 'required-anchors')).toContainEqual(expect.objectContaining({ severity: 'error', expected: 'next-steps', actual: 'missing' })); });
  it('does not accept next-steps on h3', async () => { expect(only(await scan('tutorials/x', '## Prerequisites {#prerequisites}\n## Steps {#steps}\n## Verification {#verification}\n### Next steps {#next-steps}\n'), 'required-anchors')).toContainEqual(expect.objectContaining({ expected: 'next-steps', actual: 'missing' })); });
  for (const [ext, marker] of [['md', '{#steps}'], ['mdx', '\\{#steps}']] as const) it(`accepts a Steps-nested h2 anchor in .${ext}`, async () => { const anchor = (id: string) => (ext === 'mdx' ? `\\{#${id}}` : `{#${id}}`); const body = `## Prerequisites ${anchor('prerequisites')}\n<Steps>\n\n1. ## Steps ${marker}\n\n</Steps>\n\n## Verification ${anchor('verification')}\n## Next steps ${anchor('next-steps')}\n`; const f = fixture(['tutorials/x'], { [path('tutorials/x', 'en', ext)]: body }); expect(only((await checkProse(input(f))).violations.filter((v: any) => v.locale === 'en'), 'required-anchors')).toEqual([]); });
  it('reports two distinct banned terms on one line', async () => { const v = only(await scan('tutorials/x', `${anchors}RawConfig and dispatch.\n`, 'en', (c) => { c.bannedTerms = ['RawConfig', 'dispatch']; }), 'banned-term'); expect(v).toEqual([expect.objectContaining({ line: 5, actual: 'RawConfig' }), expect.objectContaining({ line: 5, actual: 'dispatch' })]); });
  it('reports a repeated banned term only once per line', async () => { expect(only(await scan('tutorials/x', `${anchors}RawConfig and RawConfig.\n`), 'banned-term')).toEqual([expect.objectContaining({ line: 5, actual: 'RawConfig' })]); });
  it('does not match an ASCII banned term inside a longer word', async () => { expect(only(await scan('tutorials/x', `${anchors}dispatcher.\n`, 'en', (c) => { c.bannedTerms = ['dispatch']; }), 'banned-term')).toEqual([]); });
  it('detects a banned term in a heading', async () => { expect(only(await scan('tutorials/x', `## RawConfig {#prerequisites}\n${anchors}`), 'banned-term')).toContainEqual(expect.objectContaining({ line: 1, actual: 'RawConfig' })); });
  for (const [count, n] of [[2, 0], [3, 1]] as const) it(`${count} callouts`, async () => { const v = only(await scan('reference/x', ':::note[t]\nBrief.\n:::\n\n'.repeat(count)), 'callout-count'); expect(v).toHaveLength(n); if (n) expect(v[0]).toMatchObject({ severity: 'error', expected: '<= 2', actual: '3' }); });
  it('rejects an indented link in related', async () => { const line = '  - [text](url)'; expect(only(await scan('how-to/x', `## Related {#related}\n${line}\n`, 'en', (c) => { c.requiredAnchors = {}; }), 'related-linkcard-only')).toEqual([expect.objectContaining({ line: 2, severity: 'error', expected: 'LinkCard only', actual: line.slice(0, 40) })]); });
  it('accepts LinkCard in related', async () => { expect(only(await scan('how-to/x', '## Related {#related}\n<LinkCard />\n', 'en', (c) => { c.requiredAnchors = {}; }), 'related-linkcard-only')).toEqual([]); });
  for (const line of ['リンク:', 'LINKS：']) it(`rejects ${line} in related`, async () => { expect(only(await scan('how-to/x', `## Related {#related}\n${line}\n`, 'en', (c) => { c.requiredAnchors = {}; }), 'related-linkcard-only')).toEqual([expect.objectContaining({ line: 2, actual: line })]); });
  it('stops related checking at the next h2', async () => { expect(only(await scan('how-to/x', '## Related {#related}\n<LinkCard />\n## Elsewhere\nリンク:\n', 'en', (c) => { c.requiredAnchors = {}; }), 'related-linkcard-only')).toEqual([]); });
  it('checks an h3 inside the related h2 span', async () => { expect(only(await scan('how-to/x', '## Related {#related}\n### More\nリンク:\n', 'en', (c) => { c.requiredAnchors = {}; }), 'related-linkcard-only')).toEqual([expect.objectContaining({ line: 3, actual: 'リンク:' })]); });
});

describe('TEST-7 thresholds', () => {
  const thresholds: [string, number, string | null, string | null][] = [['en', 19, null, null], ['en', 20, null, null], ['en', 21, 'warning', '<= 20'], ['en', 29, 'warning', '<= 20'], ['en', 30, 'warning', '<= 20'], ['en', 31, 'error', '<= 30'], ['ja', 59, null, null], ['ja', 60, null, null], ['ja', 61, 'warning', '<= 60'], ['ja', 79, 'warning', '<= 60'], ['ja', 80, 'warning', '<= 60'], ['ja', 81, 'error', '<= 80'], ['zh-cn', 49, null, null], ['zh-cn', 50, null, null], ['zh-cn', 51, 'warning', '<= 50'], ['zh-cn', 69, 'warning', '<= 50'], ['zh-cn', 70, 'warning', '<= 50'], ['zh-cn', 71, 'error', '<= 70']];
  for (const [locale, length, severity, expected] of thresholds) it(`sentence ${locale} ${length}`, async () => { const body = locale === 'en' ? `${Array(length).fill('word').join(' ')}.` : `${'文'.repeat(length - 1)}。`; const v = only(await scan('reference/x', body, locale), 'sentence-length'); expect(v).toHaveLength(severity ? 1 : 0); if (severity) expect(v[0]).toMatchObject({ severity, expected, actual: String(length) }); });
  it('attributes a multiline sentence to its first source line', async () => { const body = `${Array(10).fill('word').join(' ')}\n${Array(11).fill('word').join(' ')}.`; expect(only(await scan('reference/x', `# X\n\n${body}\n`), 'sentence-length')).toEqual([expect.objectContaining({ line: 3, severity: 'warning', actual: '21' })]); });
  for (const [count, n] of [[3, 0], [4, 1]] as const) it(`paragraph ${count} sentences`, async () => { const v = only(await scan('reference/x', 'Short. '.repeat(count)), 'paragraph-sentences'); expect(v).toHaveLength(n); if (n) expect(v[0]).toMatchObject({ severity: 'warning', expected: '<= 3', actual: '4' }); });
  it('counts each list item paragraph independently', async () => { const body = '- One. Two. Three. Four.\n- Five. Six. Seven. Eight.\n'; expect(only(await scan('reference/x', body), 'paragraph-sentences')).toEqual([expect.objectContaining({ line: 1, actual: '4' }), expect.objectContaining({ line: 2, actual: '4' })]); });
  for (const [locale, values, limit] of [['en', [600, 601, 780, 781], 600], ['ja', [1200, 1201, 1560, 1561], 1200], ['zh-cn', [1200, 1201, 1560, 1561], 1200]] as const) for (const [i, length] of values.entries()) it(`page ${locale} ${length}`, async () => { const body = locale === 'en' ? Array(length).fill('word').join(' ') : '文'.repeat(length); const v = only(await scan('tutorials/x', body, locale, (c) => { c.requiredAnchors = {}; }), 'page-length'); expect(v).toHaveLength(i ? 1 : 0); if (i) expect(v[0]).toMatchObject({ severity: i === 3 ? 'error' : 'warning', expected: `<= ${i === 3 ? Math.ceil(limit * 1.3) : limit}`, actual: String(length) }); });
  it('excludes table cells from page length', async () => { const body = `${Array(600).fill('word').join(' ')}\n\n| Header |\n| --- |\n| extra |\n`; expect(only(await scan('tutorials/x', body, 'en', (c) => { c.requiredAnchors = {}; }), 'page-length')).toEqual([]); });
  it('excludes image alt text from page length', async () => { const body = `${Array(600).fill('word').join(' ')}\n\n![extra](image.png)\n`; expect(only(await scan('tutorials/x', body, 'en', (c) => { c.requiredAnchors = {}; }), 'page-length')).toEqual([]); });
  it('includes emphasis child text in page length', async () => { const body = `${Array(600).fill('word').join(' ')} *extra*`; expect(only(await scan('tutorials/x', body, 'en', (c) => { c.requiredAnchors = {}; }), 'page-length')).toEqual([expect.objectContaining({ actual: '601', severity: 'warning' })]); });
  it('includes link child text in page length', async () => { const body = `${Array(600).fill('word').join(' ')} [extra](target)`; expect(only(await scan('tutorials/x', body, 'en', (c) => { c.requiredAnchors = {}; }), 'page-length')).toEqual([expect.objectContaining({ actual: '601', severity: 'warning' })]); });
  it('counts combining marks and emoji as code points rather than UTF-16 units', async () => { const body = `${'文'.repeat(56)}e\u0301😀。`; expect([...body].length).toBe(60); expect(body.length).toBe(61); expect(only(await scan('reference/x', body, 'ja'), 'sentence-length')).toEqual([]); });
  for (const [passive, n] of [[3, 0], [4, 1]] as const) it(`passive ${passive}/10`, async () => { const v = only(await scan('reference/x', `${'処理される。'.repeat(passive)}${'処理する。'.repeat(10 - passive)}`, 'ja'), 'passive-density'); expect(v).toHaveLength(n); if (n) expect(v[0]).toMatchObject({ severity: 'warning', expected: '<= 0.3', actual: '0.40' }); });
  it('skips zero-sentence passive ratio', async () => { expect(only(await scan('reference/x', '# Heading\n', 'ja'), 'passive-density')).toEqual([]); });
});

describe('TEST-8/9 tool merge', () => {
  for (const [name, severity, expected] of [['default', undefined, 'error'], ['warning', 'warning', 'warning'], ['off', 'off', null]] as const) it(`textlint ${name}`, async () => { const f = fixture(['reference/x'], { [path('reference/x', 'ja')]: '# X\n\nFirst.\n\nMixed register.\n' }, (c) => { if (severity) c.severity['no-mix-dearu-desumasu'] = severity; }); const r = runners(); r.textlint.mockResolvedValue([{ ruleId: 'no-mix-dearu-desumasu', line: 5, message: 'mixed register', severity: 2 }]); const v = only((await checkProse(input(f, r))).violations, 'textlint:no-mix-dearu-desumasu'); expect(v).toHaveLength(expected ? 1 : 0); if (expected) expect(v[0]).toMatchObject({ line: 5, expected: '', actual: 'mixed register', severity: expected }); });
  it('merges zhlint at paragraph start', async () => { const f = fixture(['reference/x'], { [path('reference/x', 'zh-cn')]: '# X\n\n中文English。\n' }); const r = runners(); r.zhlint.mockResolvedValue([{ message: 'spacing' }]); expect(only((await checkProse(input(f, r))).violations, 'zhlint')).toEqual([expect.objectContaining({ line: 3, expected: '', actual: 'spacing', severity: 'error' })]); });
  it.each([
    ['multiple inline codes', '运行 `x` 后使用 `y`。', '运行 code 后使用 code。', 3],
    ['punctuation after inline code', '运行 `x`。', '运行 code。', 3],
    ['soft wrap', '运行 `x`\n后查看结果。', '运行 code后查看结果。', 3],
    ['nested link code', '运行 [命令 `x`](https://example.com) 后查看。', '运行 命令 code 后查看。', 3],
    ['nested MDX element code', '运行 <em>命令 `x`</em> 后查看。', '运行 命令 code 后查看。', 3],
    ['inline code starts paragraph', '`x`\n中文English。', 'code中文English。', 3],
  ] as const)('passes %s replacement to zhlint and attributes its finding to paragraph start', async (_name, paragraph, expected, line) => {
    const ext = _name === 'nested MDX element code' ? 'mdx' : 'md';
    const f = fixture(['reference/x'], { [path('reference/x', 'zh-cn', ext)]: `# X\n\n${paragraph}\n` });
    const r = runners(); r.zhlint.mockResolvedValue([{ message: 'spacing' }]);
    const violations = (await checkProse(input(f, r))).violations;
    expect(r.zhlint.mock.calls[0][0]).toBe(expected);
    expect(only(violations, 'zhlint')).toEqual([expect.objectContaining({ line, actual: 'spacing' })]);
  });
  it('accepts inline code spacing with real zhlint', async () => {
    const f = fixture(['reference/x'], { [path('reference/x', 'zh-cn')]: '# X\n\n运行 `ambercast run`。\n\n使用 `--resolve` 选项。\n' });
    expect(only((await checkProse(input(f, realRunners()))).violations, 'zhlint')).toEqual([]);
  });
  it('keeps zh-cn sentence and page length measurements based on joined text', async () => {
    const prose = `${'文'.repeat(50)}。`;
    const withCode = `${'文'.repeat(50)}\`x\`。`;
    const baseline = await scan('reference/x', prose, 'zh-cn');
    const changed = await scan('reference/x', withCode, 'zh-cn');
    expect(only(changed, 'sentence-length')).toEqual(only(baseline, 'sentence-length'));
    expect(only(changed, 'sentence-length')).toEqual([expect.objectContaining({ actual: '51', severity: 'warning' })]);

    const page = '文'.repeat(1201);
    const baselinePage = await scan('tutorials/x', page, 'zh-cn', (c) => { c.requiredAnchors = {}; });
    const changedPage = await scan('tutorials/x', `${page}\`x\``, 'zh-cn', (c) => { c.requiredAnchors = {}; });
    expect(only(changedPage, 'page-length')).toEqual(only(baselinePage, 'page-length'));
    expect(only(changedPage, 'page-length')).toEqual([expect.objectContaining({ actual: '1201', severity: 'warning' })]);
  });
  it('keeps ja real textlint findings when a zh-cn page with inline code is present', async () => {
    const ja = '# X\n\nこれはテストです。\n\nこれは正しい。\n';
    const jaPath = path('reference/x', 'ja');
    const baseline = fixture(['reference/x'], { [jaPath]: ja });
    const combined = fixture(['reference/x'], {
      [jaPath]: ja,
      [path('reference/x', 'zh-cn')]: '# X\n\n运行 `x` 后查看。\n',
    });
    const jaTextlint = (violations: any[]) => violations.filter((v) => v.locale === 'ja' && v.rule.startsWith('textlint:'));
    const before = jaTextlint((await checkProse(input(baseline, realRunners()))).violations);
    const after = jaTextlint((await checkProse(input(combined, realRunners()))).violations);
    expect(before).toContainEqual(expect.objectContaining({ rule: expect.stringMatching(/^textlint:.*no-mix-dearu-desumasu/) }));
    expect(after).toEqual(before);
  });
  for (const ext of ['md', 'mdx']) it(`ja .${ext} fixture with mixed register → real textlint reports no-mix-dearu-desumasu`, async () => {
    const f = fixture(['reference/x'], { [path('reference/x', 'ja', ext)]: '# X\n\nこれはテストです。\n\nこれは正しい。\n' });
    const violations = (await checkProse(input(f, realRunners()))).violations;
    expect(violations.some((v: any) => v.rule.startsWith('textlint:') && v.rule.includes('no-mix-dearu-desumasu'))).toBe(true);
  });
  it('することができる → real textlint reports redundant-expression finding', async () => {
    const f = fixture(['reference/x'], { [path('reference/x', 'ja')]: '# X\n\nすることができる。\n' });
    const violations = (await checkProse(input(f, realRunners()))).violations;
    expect(violations.some((v: any) => v.rule.startsWith('textlint:') && v.rule.includes('redundant-expression'))).toBe(true);
  });
  for (const ext of ['md', 'mdx']) it(`zh-cn .${ext} fixture with 中文English spacing → real zhlint reports a finding`, async () => {
    const f = fixture(['reference/x'], { [path('reference/x', 'zh-cn', ext)]: '# X\n\n中文English混排。\n' });
    expect((await checkProse(input(f, realRunners()))).violations.some((v: any) => v.rule === 'zhlint')).toBe(true);
  });
});

describe('TEST-10/11 report and wiring', () => {
  it('reports the entire corpus with zero rows despite empty pages', async () => {
    const groups = ['start-here', 'tutorials', 'how-to', 'explanation', 'reference', 'spec', 'agents'];
    const files = Object.fromEntries(groups.flatMap((group) => ['en', 'ja', 'zh-cn'].map((locale) => [path(group === 'start-here' ? 'introduction' : `${group}/x`, locale), '# X\n'])));
    const f = fixture([], files, (c) => { c.requiredAnchors = {}; });
    const result = await checkProse(input(f, runners(), true));
    expect(result.report).not.toBeNull();
    const rows = result.report!.trim().split('\n').filter((row: string) => row.trim().startsWith('|'));
    const data = rows.slice(2).map((row: string) => row.split('|').slice(1, -1).map((cell: string) => cell.trim()));
    expect(data).toHaveLength(21);
    expect(data.map((row: string[]) => row.slice(0, 2))).toEqual(groups.flatMap((group) => ['en', 'ja', 'zh-cn'].map((locale) => [group, locale])));
    expect(data.some((row: string[]) => row[0] === 'reference' && row[1] === 'en' && row.slice(2).length === 15 && row.slice(2).every((cell) => cell === '0'))).toBe(true);
  });
  it('reports the entire corpus with zero rows via the real CLI subprocess --report', () => { const groups = ['start-here', 'tutorials', 'how-to', 'explanation', 'reference', 'spec', 'agents']; const files = Object.fromEntries(groups.flatMap((group) => ['en', 'ja', 'zh-cn'].map((locale) => [path(group === 'start-here' ? 'introduction' : `${group}/x`, locale), '# X\n']))); const f = fixture([], files, (c) => { c.requiredAnchors = {}; }); enableRealTools(f); expect(cli(f, ['--report']).status).toBe(0); });
  it('validates configuration in report mode', async () => { const f = fixture([], { [configPath]: '{' }); await expect(checkProse(input(f, runners(), true))).rejects.toMatchObject({ code: 'config-invalid' }); exit2(f, 'config-invalid', ['--report']); });
  // Expected red in step 9: package.json wiring is deferred until the code step.
  it('wires prose lint into the real website check script', () => { const pkg = fileURLToPath(new URL('../package.json', import.meta.url)); expect(JSON.parse(readFileSync(pkg, 'utf8')).scripts.check).toContain('check-prose.mjs'); });
  // Expected red in step 9: the five pinned devDependencies are deferred until the code step.
  it('pins the five layer-1 prose lint devDependencies', () => { const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')); const names = ['textlint', 'textlint-rule-preset-ja-technical-writing', '@textlint-ja/textlint-rule-preset-ai-writing', 'textlint-plugin-mdx', 'zhlint']; expect(pkg.devDependencies).toBeDefined(); for (const name of names) { expect(pkg.devDependencies).toHaveProperty(name); expect(pkg.devDependencies[name]).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/); } });
});
