/**
 * Keeps the AGENTS.md citation index and the three-locale Philosophy page in step.
 * An agent reads AGENTS.md for the binding product principles, so adding or removing
 * a principle on the page must force the citation index to follow.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { parseProseTree, stripFrontmatterOffset } from '../scripts/lib/prose-text.mjs';
import { HEADING_ID_PATTERN } from '../scripts/lib/remark-heading-id.mjs';
import { createDocsFixture } from './cli-fixture';

/** Pins the section boundary so unrelated AGENTS.md guidance cannot enter the index. */
const PRINCIPLES_HEADING = '## Product principles (binding)';
/** Resolves repository paths from import.meta.url so checks do not depend on the working directory. */
const repoRoot = new URL('../../', import.meta.url);
/** Pins all three published locales and their repository-relative paths for the same coverage everywhere. */
const LOCALES = [
  ['en', 'website/src/content/docs/philosophy.md'],
  ['ja', 'website/src/content/docs/ja/philosophy.md'],
  ['zh-cn', 'website/src/content/docs/zh-cn/philosophy.md'],
] as const;
/** Pins the citation index order so a reworded or reordered index requires a visible test change. */
const EXPECTED_ANCHORS = [
  'tests-as-assets',
  'intent-primary',
  'plans-are-disposable',
  'simple-surface-rigorous-core',
  'wrong-pass',
  'humans-and-agents',
  'assets-stay-local',
  'five-pains',
];

/**
 * Slices the principles section before matching so backticked bullets elsewhere in
 * AGENTS.md cannot count. The section ends at the next line starting with `## ` or
 * the end of the file. The regex is /^- `([a-z][a-z0-9-]*)` — /gm:
 * only the first backticked token of a line shaped like "- `anchor` — " is an
 * anchor, and avoiding an end-of-line match keeps CRLF input acceptable.
 * A missing section, an empty anchor list, or a duplicate throws rather than
 * returning an empty or partial list: a mangled index must fail loudly and must
 * never let the page checks pass vacuously.
 */
function readPrincipleAnchors(agentsSource: string): string[] {
  const lines = agentsSource.split('\n');
  const start = lines.findIndex((line) => line.replace(/\r$/, '') === PRINCIPLES_HEADING);
  if (start === -1) throw new Error(`Missing ${PRINCIPLES_HEADING}`);
  const following = lines.slice(start + 1);
  const end = following.findIndex((line) => line.startsWith('## '));
  const section = following.slice(0, end === -1 ? undefined : end).join('\n');
  const anchors = Array.from(section.matchAll(/^- `([a-z][a-z0-9-]*)` — /gm), (match) => match[1]);
  if (anchors.length === 0) throw new Error(`No anchors in ${PRINCIPLES_HEADING}`);
  const seen = new Set<string>();
  for (const anchor of anchors) {
    if (seen.has(anchor)) throw new Error(`Duplicate anchor: ${anchor}`);
    seen.add(anchor);
  }
  return anchors;
}

/**
 * Uses stripFrontmatterOffset(markdown).body and parseProseTree with isMdx: false
 * to share the site's Markdown interpretation. A line scan would mistake a `## `
 * line inside a fence or a YAML frontmatter comment for a heading, allowing a
 * required heading moved into a fence to satisfy the check.
 * Only root heading children with depth === 2 belong to the principle inventory;
 * nested headings and other levels cannot stand in for page-level principles.
 * In document order, each heading takes its id from HEADING_ID_PATTERN applied
 * only when its last child is text. This is the rendered site's exact trailing
 * {#id} grammar, so published anchors and the test cannot disagree; an earlier
 * {#decoy} in the text is not an id. A heading without a matching trailing token
 * still counts with id undefined, which makes the count check meaningful.
 */
function secondLevelHeadings(markdown: string): Array<{ id: string | undefined }> {
  const { body } = stripFrontmatterOffset(markdown);
  const tree = parseProseTree(body, { isMdx: false });
  return tree.children.filter((node) => node.type === 'heading' && node.depth === 2).map((heading) => {
    const lastChild = heading.children.at(-1);
    return { id: lastChild?.type === 'text' ? HEADING_ID_PATTERN.exec(lastChild.value)?.[1] : undefined };
  });
}

/**
 * Returns problem strings so one production assertion names every drifted locale
 * at once, while fixtures can assert exact arrays. For each locale in object key
 * order, emit "<locale>: missing heading id {#<anchor>}" for each missing anchor
 * in anchor order, then, if counts differ, emit
 * "<locale>: <n> level-two headings but AGENTS.md lists <m> anchors".
 * Both checks use the same heading inventory but provide separate signals: the
 * id check catches a dropped id or removed heading, while the count check catches
 * an added heading with no anchor in AGENTS.md. Invalid AGENTS.md propagates as a
 * throw rather than a problem entry because a broken citation index cannot supply
 * a trustworthy baseline for reporting page drift.
 */
function verifyPrinciples(agentsSource: string, pages: Record<string, string>): string[] {
  const anchors = readPrincipleAnchors(agentsSource);
  const problems: string[] = [];
  for (const [locale, source] of Object.entries(pages)) {
    const headings = secondLevelHeadings(source);
    const ids = new Set(headings.map((heading) => heading.id));
    for (const anchor of anchors) {
      if (!ids.has(anchor)) problems.push(`${locale}: missing heading id {#${anchor}}`);
    }
    if (headings.length !== anchors.length) {
      problems.push(`${locale}: ${headings.length} level-two headings but AGENTS.md lists ${anchors.length} anchors`);
    }
  }
  return problems;
}

const DEFAULT_PAGE = '---\ntitle: Philosophy\n---\n\nIntro.\n\n## A one {#a-one}\n\nText.\n\n## B two {#b-two}\n\nText.\n\n## C three {#c-three}\n\nText.\n';
const fixtures: ReturnType<typeof createDocsFixture>[] = [];

/**
 * Builds a synthetic repository with an unrelated earlier AGENTS.md section that
 * also has a backticked bullet, followed by a minimal valid principles section
 * citing a-one, b-two, and c-three. Every fixture therefore exercises exclusion of
 * bullets outside the section without needing a separate setup. The three pages
 * each have frontmatter with title: and three matching level-two headings, giving
 * each case a consistent baseline from which to isolate one variation.
 * Overrides replace the complete AGENTS.md text or individual locale pages;
 * pages without an override retain the valid baseline. createDocsFixture supplies
 * the temporary files and read/dispose operations used by the cases.
 */
function principlesFixture(overrides?: {
  agents?: string;
  pages?: Partial<Record<'en' | 'ja' | 'zh-cn', string>>;
}): ReturnType<typeof createDocsFixture> {
  const files: Record<string, string> = {
    'AGENTS.md': overrides?.agents ?? '## Unrelated\n\n- `not-an-anchor` — ignored\n\n## Product principles (binding)\n\nAn introduction.\n\n- `a-one` — first.\n- `b-two` — second.\n- `c-three` — third.\n\n## Next section\n\nFollowing prose.\n',
  };
  for (const [locale, path] of LOCALES) files[path] = overrides?.pages?.[locale] ?? DEFAULT_PAGE;
  const fixture = createDocsFixture(files);
  fixtures.push(fixture);
  return fixture;
}

/*
 * Proves the real citation index stays pinned and every published locale exposes
 * the required ids and heading count, with per-locale diagnostics as well as one
 * combined drift report. Read files and extract anchors inside it callbacks so a
 * missing section fails individual tests rather than aborting file collection.
 */
describe('principles anchors (repository files)', () => {
  it('AGENTS.md lists the eight Philosophy anchors in order', () => {
    const agents = readFileSync(new URL('AGENTS.md', repoRoot), 'utf8');
    expect(readPrincipleAnchors(agents)).toEqual(EXPECTED_ANCHORS);
  });

  it("every locale's Philosophy page is consistent with AGENTS.md", () => {
    const agents = readFileSync(new URL('AGENTS.md', repoRoot), 'utf8');
    const en = readFileSync(new URL(LOCALES[0][1], repoRoot), 'utf8');
    const ja = readFileSync(new URL(LOCALES[1][1], repoRoot), 'utf8');
    const zh = readFileSync(new URL(LOCALES[2][1], repoRoot), 'utf8');
    expect(verifyPrinciples(agents, { en, ja, 'zh-cn': zh })).toEqual([]);
  });

  it.each(LOCALES)('%s philosophy.md has every anchor as a level-two heading id and the same heading count', (_locale, path) => {
    const agents = readFileSync(new URL('AGENTS.md', repoRoot), 'utf8');
    const page = readFileSync(new URL(path, repoRoot), 'utf8');
    const anchors = readPrincipleAnchors(agents);
    const headings = secondLevelHeadings(page);
    for (const anchor of anchors) expect(headings.map((heading) => heading.id)).toContain(anchor);
    expect(headings).toHaveLength(anchors.length);
  });
});

/*
 * Proves malformed indexes fail loudly, page drift yields the exact ordered
 * diagnostics, and benign Markdown variations remain valid. Build and read fixture
 * files inside it callbacks so missing-section cases are per-test failures rather
 * than collection errors; afterEach disposes the temporary repositories.
 */
describe('principles verifier (synthetic fixtures)', () => {
  afterEach(() => fixtures.splice(0).forEach((fixture) => fixture.dispose()));

  // Each page variation isolates one change on `ja` around `b-two` so failures
  // point to a single cause, while untouched locales must stay silent.
  // Rejections assert complete diagnostic arrays rather than substrings because
  // diagnostic order is part of the verifier's contract.
  it('AGENTS.md without the section → readPrincipleAnchors throws, message names the heading', () => {
    const fixture = principlesFixture({ agents: '## Unrelated\n\nSome prose.\n' });
    expect(() => readPrincipleAnchors(fixture.read('AGENTS.md'))).toThrow(/## Product principles \(binding\)/);
  });

  it('Section present but no bullet anchors → throws', () => {
    const fixture = principlesFixture({ agents: '## Product principles (binding)\n\nOnly prose.\n' });
    expect(() => readPrincipleAnchors(fixture.read('AGENTS.md'))).toThrow(/No anchors/);
  });

  it('Duplicate anchor in the section → throws', () => {
    const fixture = principlesFixture({ agents: '## Product principles (binding)\n\n- `a-one` — first.\n- `b-two` — second.\n- `b-two` — repeated.\n' });
    expect(() => readPrincipleAnchors(fixture.read('AGENTS.md'))).toThrow(/b-two/);
  });

  it("One locale lacks one anchor's heading entirely", () => {
    const fixture = principlesFixture({ pages: { ja: DEFAULT_PAGE.replace('## B two {#b-two}\n\nText.\n\n', '') } });
    expect(verifyPrinciples(fixture.read('AGENTS.md'), Object.fromEntries(LOCALES.map(([locale, path]) => [locale, fixture.read(path)])))).toEqual(['ja: missing heading id {#b-two}', 'ja: 2 level-two headings but AGENTS.md lists 3 anchors']);
  });

  it('One locale has a heading whose {#id} was dropped', () => {
    const fixture = principlesFixture({ pages: { ja: DEFAULT_PAGE.replace('## B two {#b-two}', '## B two') } });
    expect(verifyPrinciples(fixture.read('AGENTS.md'), Object.fromEntries(LOCALES.map(([locale, path]) => [locale, fixture.read(path)])))).toEqual(['ja: missing heading id {#b-two}']);
  });

  it('One locale has an extra level-two heading (with an id not in the list)', () => {
    const fixture = principlesFixture({ pages: { ja: DEFAULT_PAGE + '\n## Extra {#d-four}\n' } });
    expect(verifyPrinciples(fixture.read('AGENTS.md'), Object.fromEntries(LOCALES.map(([locale, path]) => [locale, fixture.read(path)])))).toEqual(['ja: 4 level-two headings but AGENTS.md lists 3 anchors']);
  });

  it('A required heading moved inside a fenced code block', () => {
    const fixture = principlesFixture({ pages: { ja: DEFAULT_PAGE.replace('## B two {#b-two}', '```\n## B two {#b-two}\n```') } });
    expect(verifyPrinciples(fixture.read('AGENTS.md'), Object.fromEntries(LOCALES.map(([locale, path]) => [locale, fixture.read(path)])))).toEqual(['ja: missing heading id {#b-two}', 'ja: 2 level-two headings but AGENTS.md lists 3 anchors']);
  });

  it('A ### heading carrying a required anchor instead of a ##', () => {
    const fixture = principlesFixture({ pages: { ja: DEFAULT_PAGE.replace('## B two {#b-two}', '### B two {#b-two}') } });
    expect(verifyPrinciples(fixture.read('AGENTS.md'), Object.fromEntries(LOCALES.map(([locale, path]) => [locale, fixture.read(path)])))).toEqual(['ja: missing heading id {#b-two}', 'ja: 2 level-two headings but AGENTS.md lists 3 anchors']);
  });

  it('Bullets outside the principles section of AGENTS.md are not collected; the three anchors are returned in order', () => {
    const fixture = principlesFixture();
    expect(readPrincipleAnchors(fixture.read('AGENTS.md'))).toEqual(['a-one', 'b-two', 'c-three']);
  });

  it('An unrelated ## Example line inside a fenced code block in a page', () => {
    const fixture = principlesFixture({ pages: { ja: DEFAULT_PAGE + '\n```\n## Example {#example}\n```\n' } });
    expect(verifyPrinciples(fixture.read('AGENTS.md'), Object.fromEntries(LOCALES.map(([locale, path]) => [locale, fixture.read(path)])))).toEqual([]);
  });

  it('A frontmatter block containing a YAML comment line ## not a heading', () => {
    const fixture = principlesFixture({ pages: { ja: DEFAULT_PAGE.replace('title: Philosophy', 'title: Philosophy\n## not a heading') } });
    expect(verifyPrinciples(fixture.read('AGENTS.md'), Object.fromEntries(LOCALES.map(([locale, path]) => [locale, fixture.read(path)])))).toEqual([]);
  });

  it('A heading whose text contains an earlier {#decoy} followed by the real trailing {#c-three}', () => {
    const fixture = principlesFixture({ pages: { ja: DEFAULT_PAGE.replace('## C three {#c-three}', '## C {#decoy} three {#c-three}') } });
    expect(verifyPrinciples(fixture.read('AGENTS.md'), Object.fromEntries(LOCALES.map(([locale, path]) => [locale, fixture.read(path)])))).toEqual([]);
  });

  it('Trailing whitespace after {#id} and CRLF line endings in a page', () => {
    const fixture = principlesFixture({ pages: { ja: DEFAULT_PAGE.replace('{#b-two}', '{#b-two}  ').replaceAll('\n', '\r\n') } });
    expect(verifyPrinciples(fixture.read('AGENTS.md'), Object.fromEntries(LOCALES.map(([locale, path]) => [locale, fixture.read(path)])))).toEqual([]);
  });

  it('A heading with inline code and a trailing {#id}', () => {
    const fixture = principlesFixture({ pages: { ja: DEFAULT_PAGE.replace('## B two {#b-two}', '## B `two` {#b-two}') } });
    expect(verifyPrinciples(fixture.read('AGENTS.md'), Object.fromEntries(LOCALES.map(([locale, path]) => [locale, fixture.read(path)])))).toEqual([]);
  });

  it('The same anchor appearing in all three locales is the normal state, not a duplicate', () => {
    const fixture = principlesFixture();
    expect(verifyPrinciples(fixture.read('AGENTS.md'), Object.fromEntries(LOCALES.map(([locale, path]) => [locale, fixture.read(path)])))).toEqual([]);
  });

  it('Multiple missing anchors across locales preserve caller and anchor order', () => {
    const fixture = principlesFixture({ pages: { 'zh-cn': '---\ntitle: Philosophy\n---\n\nIntro.\n', ja: '---\ntitle: Philosophy\n---\n\nIntro.\n' } });
    const pages = Object.fromEntries(LOCALES.map(([locale, path]) => [locale, fixture.read(path)]));
    expect(verifyPrinciples(fixture.read('AGENTS.md'), { 'zh-cn': pages['zh-cn'], ja: pages.ja, en: pages.en })).toEqual(['zh-cn: missing heading id {#a-one}', 'zh-cn: missing heading id {#b-two}', 'zh-cn: missing heading id {#c-three}', 'zh-cn: 0 level-two headings but AGENTS.md lists 3 anchors', 'ja: missing heading id {#a-one}', 'ja: missing heading id {#b-two}', 'ja: missing heading id {#c-three}', 'ja: 0 level-two headings but AGENTS.md lists 3 anchors']);
  });

  it('Following-section anchor bullets are excluded', () => {
    const fixture = principlesFixture({ agents: '## Unrelated\n\n- `not-an-anchor` — ignored\n\n## Product principles (binding)\n\nAn introduction.\n\n- `a-one` — first.\n- `b-two` — second.\n- `c-three` — third.\n\n## Next section\n\nFollowing prose.\n- `d-four` — later.\n' });
    expect(readPrincipleAnchors(fixture.read('AGENTS.md'))).toEqual(['a-one', 'b-two', 'c-three']);
  });

  it('A valid principles section at EOF returns all anchors', () => {
    const fixture = principlesFixture({ agents: '## Unrelated\n\nProse.\n\n## Product principles (binding)\n\nIntro.\n\n- `a-one` — first.\n- `b-two` — second.\n- `c-three` — third.\n' });
    expect(readPrincipleAnchors(fixture.read('AGENTS.md'))).toEqual(['a-one', 'b-two', 'c-three']);
  });

  it('An id-like token inside a final inline-code child is not a heading id', () => {
    const fixture = principlesFixture({ pages: { ja: DEFAULT_PAGE.replace('## B two {#b-two}', '## B two `{#b-two}`') } });
    expect(verifyPrinciples(fixture.read('AGENTS.md'), Object.fromEntries(LOCALES.map(([locale, path]) => [locale, fixture.read(path)])))).toEqual(['ja: missing heading id {#b-two}']);
  });
});

