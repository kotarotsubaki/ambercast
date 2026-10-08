import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PLAN_SCHEMA_VERSION, GROUNDING_SCHEMA_VERSION, FINGERPRINT_ALGORITHM } from '../../../src/core/ir/schema.js';
import { REPORT_SCHEMA_VERSION } from '../../../src/report/schema.js';

const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { version: string };
const isReleasePr = process.env.GITHUB_HEAD_REF?.startsWith('release-please--') === true;
const locales = ['', 'ja/', 'zh-cn/'] as const;
const reference = (locale: string, name: string) => readFileSync(new URL(`../../../website/src/content/docs/${locale}reference/${name}.md`, import.meta.url), 'utf8');
const localizedDoc = (locale: string, name: string) => readFileSync(new URL(`../../../website/src/content/docs/${locale}${name}.md`, import.meta.url), 'utf8');
const overview = () => readFileSync(fileURLToPath(new URL('../../../docs/spec/overview.md', import.meta.url)), 'utf8');

// The table's own header-row text (e.g. "package version", "invariant") is
// translated per locale and is not a stable search key; the heading anchor
// right before the table (e.g. "{#compatibility-table}") is locale-invariant
// (confirmed identical across en/ja/zh-cn), so the table is located relative
// to that anchor instead of by matching header-cell text.
function tableRows(document: string, anchor: string): string[][] {
  const lines = document.split('\n');
  const anchorIndex = lines.findIndex((line) => line.includes(anchor));
  expect(anchorIndex).toBeGreaterThanOrEqual(0);
  const start = lines.findIndex((line, index) => index > anchorIndex && /^\|.*\|$/.test(line));
  expect(start).toBeGreaterThan(anchorIndex);
  expect(lines[start + 1]).toMatch(/^\|\s*---\s*\|/);
  const rows: string[][] = [];
  for (const line of lines.slice(start + 2)) {
    if (line.trim() === '' || line.startsWith('#')) break;
    expect(line).toMatch(/^\|.*\|$/);
    rows.push(line.split('|').slice(1, -1).map((cell) => cell.trim()));
  }
  return rows;
}

function versionTuple(version: string): [number, number, number] {
  expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  const parts = version.split('.').map(Number);
  return [parts[0]!, parts[1]!, parts[2]!] as [number, number, number];
}

function compareVersions(left: string, right: string): number {
  const a = versionTuple(left);
  const b = versionTuple(right);
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index]! - b[index]!;
  }
  return 0;
}

function compatibilityVersions(locale: string): { token: string; cells: string[] }[] {
  const rows = tableRows(reference(locale, 'compatibility'), '{#compatibility-table}');
  return rows.map((cells) => {
    expect(cells[0], locale).toMatch(/^`\d+\.\d+\.\d+`$/);
    return { token: cells[0]!.slice(1, -1), cells };
  });
}

function glossaryRows(locale: string): string[][] {
  return tableRows(reference(locale, 'glossary'), '{#translation-invariant-registry}');
}

function glossaryVersionRows(locale: string): { token: string; cells: string[] }[] {
  return glossaryRows(locale).flatMap((cells) => {
    if (!/\d+\.\d+\.\d+/.test(cells[0] ?? '')) return [];
    expect(cells[0], locale).toMatch(/^`\d+\.\d+\.\d+`$/);
    return [{ token: cells[0]!.slice(1, -1), cells }];
  });
}

function cellValue(cell: string): string {
  return cell.replace(/^`|`$/g, '');
}

function singleBacktickToken(cell: string): string {
  const matches = [...cell.matchAll(/`([^`]+)`/g)];
  expect(matches).toHaveLength(1);
  return matches[0]![1]!;
}

// Version-row consistency checks prevent recurrence of the two-version-drift
// incidents in #523 and #569, where documentation referred to stale schema
// versions. Every row-identity comparison below first verifies the raw first
// column cell is a single code span (matches /^`[^`]+`$/) before stripping
// backticks and comparing the inner token — a cell that merely contains the
// version token without code-span formatting must not count as "the V row".

describe('release version rows (SPEC-6, SPEC-6b)', () => {
  describe('compatibility table', () => {
    // Presence/non-duplication/no-newer-than-V runs on every PR; only the
    // 4th check below (live schema constants) is release-PR-only, because
    // this repo's CI checkout is shallow and carries no tags, so only a
    // release PR's own head constants are a meaningful comparison target.
    it('has exactly one row whose 1st column is the package.json version V, no duplicate version across all rows, and no row whose version is semver-greater than V', () => {
      for (const locale of locales) {
        const rows = compatibilityVersions(locale);
        const tokens = rows.map(({ token }) => token);
        expect(tokens.filter((token) => token === pkg.version), locale).toHaveLength(1);
        expect(new Set(tokens).size, locale).toBe(tokens.length);
        for (const token of tokens) expect(compareVersions(token, pkg.version), `${locale}${token}`).toBeLessThanOrEqual(0);
      }
    });
    // SPEC-6b fixes these 5 rows' exact Plan/Grounding/fingerprint/report
    // values as docs facts, independent of which release is current, so this
    // runs unconditionally and does not skip once V moves past 0.8.0 — it
    // only requires these rows to still be present with these values.
    it('carries the 0.1.0/0.2.0/0.5.0/0.7.0/0.8.0 rows with their fixed Plan/Grounding/fingerprint/report values, and has no 0.4.0 row', () => {
      const expected = [
        ['0.1.0', '2', '1', 'a11y-neighborhood-v2', '3.0'],
        ['0.2.0', '2', '1', 'a11y-neighborhood-v2', '3.0'],
        ['0.5.0', '3', '1', 'a11y-neighborhood-v2', '3.5'],
        ['0.7.0', '5', '3', 'a11y-neighborhood-v2', '3.8'],
        ['0.8.0', '5', '3', 'a11y-neighborhood-v2', '3.9'],
      ];
      for (const locale of locales) {
        const rows = compatibilityVersions(locale);
        expect(rows.some(({ token }) => token === '0.4.0'), locale).toBe(false);
        for (const [version, ...values] of expected) {
          const matches = rows.filter(({ token }) => token === version);
          expect(matches, `${locale}${version}`).toHaveLength(1);
          expect(matches[0]!.cells.slice(1).map(cellValue), `${locale}${version}`).toEqual(values);
        }
      }
    });
    // Only a release PR's own head constants describe the same release this
    // row is about; this repo's CI checkout is shallow and carries no tags, so
    // off a release PR there is nothing meaningful to compare against.
    it.skipIf(!isReleasePr)('matches PLAN_SCHEMA_VERSION, GROUNDING_SCHEMA_VERSION, FINGERPRINT_ALGORITHM, and REPORT_SCHEMA_VERSION for the V row (release PR only)', () => {
      for (const locale of locales) {
        const matches = compatibilityVersions(locale).filter(({ token }) => token === pkg.version);
        expect(matches, locale).toHaveLength(1);
        expect(matches[0]!.cells.slice(1).map(cellValue), locale).toEqual([
          String(PLAN_SCHEMA_VERSION), String(GROUNDING_SCHEMA_VERSION), FINGERPRINT_ALGORITHM, REPORT_SCHEMA_VERSION,
        ]);
      }
    });
  });

  describe('glossary', () => {
    // "Current version" is a 2-column claim, not just row presence: the 1st
    // column must be V AND the 2nd column (the definition sentence) must
    // match that locale's current-version phrase (en "is the current
    // package version", ja "現在のパッケージバージョン", zh-cn "当前软件包版本").
    // Exactly one row may satisfy both; every other row's 2nd column must
    // NOT match that phrase, even if some other row happens to have V as its
    // 1st column (shouldn't happen, but the check is independent of check 1
    // above since this file reads its own table).
    it('has exactly one row whose 1st column is V and whose 2nd column is that locale\'s "is the current package version" phrase; no other row\'s 2nd column matches that phrase', () => {
      const phrases = { '': 'is the current package version', 'ja/': '現在のパッケージバージョン', 'zh-cn/': '当前软件包版本' };
      for (const locale of locales) {
        const rows = glossaryRows(locale);
        const current = rows.filter((cells) => cells[1]?.includes(phrases[locale]));
        expect(current, locale).toHaveLength(1);
        expect(current[0]![0], locale).toMatch(/^`[^`]+`$/);
        expect(current[0]![0]!.slice(1, -1), locale).toBe(pkg.version);
      }
    });
    // This pin on the 0.8.0 row is gated by it.skipIf(pkg.version !== '0.8.0')
    // from the start, not a manual retirement step performed later: once a
    // future release moves V past 0.8.0, the pin skips itself automatically
    // and the generic check above (which reads live V) takes over entirely.
    it.skipIf(pkg.version !== '0.8.0')('(skipIf V !== 0.8.0) carries the 0.8.0 row with report 3.9 in the 4th column, and has no 0.7.0 row', () => {
      for (const locale of locales) {
        const rows = glossaryVersionRows(locale);
        const matches = rows.filter(({ token }) => token === '0.8.0');
        expect(matches, locale).toHaveLength(1);
        expect(singleBacktickToken(matches[0]!.cells[3]!), locale).toBe('3.9');
        expect(rows.some(({ token }) => token === '0.7.0'), locale).toBe(false);
      }
    });
    // Only a release PR's own head constants describe the same release this
    // row is about; this repo's CI checkout is shallow and carries no tags, so
    // off a release PR there is nothing meaningful to compare against.
    it.skipIf(!isReleasePr)('matches REPORT_SCHEMA_VERSION in the 4th column of the V row', () => {
      for (const locale of locales) {
        const matches = glossaryVersionRows(locale).filter(({ token }) => token === pkg.version);
        expect(matches, locale).toHaveLength(1);
        expect(singleBacktickToken(matches[0]!.cells[3]!), locale).toBe(REPORT_SCHEMA_VERSION);
      }
    });
  });

  describe('spec overview target version', () => {
    // The root en file is untracked by the website's locale-sync step, so it
    // is read directly from docs/spec/overview.md rather than through the
    // sync pipeline the ja/zh-cn pages go through.
    it('names V in the root docs/spec/overview.md "## Status" section\'s first sentence', () => {
      const section = overview().split(/^## Status[^\n]*\n/m)[1]?.split(/^## /m)[0];
      expect(section).toBeDefined();
      const firstSentence = section!.trim().split(/\.\s+/)[0];
      expect(firstSentence).toContain(`ambercast ${pkg.version}`);
    });
    it('names V in the localized ja/zh-cn spec overview body\'s corresponding sentence AND in that file\'s frontmatter description', () => {
      for (const locale of ['ja/', 'zh-cn/'] as const) {
        const document = localizedDoc(locale, 'spec/overview');
        const description = document.match(/^description:\s*(.+)$/m)?.[1];
        expect(description, locale).toBeDefined();
        expect(description, locale).toContain(`ambercast ${pkg.version}`);
        const body = document.split(/^---\s*$/m).slice(2).join('---');
        const pattern = locale === 'ja/' ? /本仕様は、ambercast [^。]+が受け付けるアーティファクトについて記述する。/ : /本规范描述了 ambercast [^。]+接受的工件。/;
        const sentence = body.match(pattern)?.[0];
        expect(sentence, locale).toBeDefined();
        expect(sentence, locale).toContain(`ambercast ${pkg.version}`);
      }
    });
  });

  describe('fixed docs facts (SPEC-6b)', () => {
    it('has no release-040 anchor and no 0.4.0 heading in the changelog; has a release-050 anchor, a 0.5.0 heading, and the 2026-09-15 date', () => {
      for (const locale of locales) {
        const document = reference(locale, 'changelog');
        const lines = document.split('\n');
        const headings = lines.filter((line) => line.startsWith('## '));
        expect(document, locale).not.toContain('{#release-040}');
        expect(headings.some((line) => /(^|\D)0\.4\.0(\D|$)/.test(line)), locale).toBe(false);
        const release050Index = lines.findIndex((line) => /(^|\D)0\.5\.0(\D|$)/.test(line) && line.includes('{#release-050}'));
        expect(release050Index, locale).toBeGreaterThanOrEqual(0);
        const nextH2Index = lines.slice(release050Index + 1).findIndex((line) => line.startsWith('## '));
        const sectionEnd = nextH2Index < 0 ? lines.length : release050Index + 1 + nextH2Index;
        expect(lines.slice(release050Index, sectionEnd).join('\n'), locale).toContain('2026-09-15');
      }
    });
    // Scoped to these 3 pages specifically: SPEC-6b requires 0.3.1 to be
    // absent entirely from the glossary, baseline-restore, and review pages
    // (not just from their "current version" claims) — distinct from the
    // status-and-roadmap check below, which excludes that page's own
    // past-fact 0.3.1 mentions and checks only the current-version sentence.
    it('has no "0.3.1" text anywhere in the glossary, baseline-restore, or review pages', () => {
      for (const locale of locales) {
        for (const name of ['glossary', 'cli/baseline-restore', 'cli/review']) {
          expect(reference(locale, name), `${locale}${name}`).not.toContain('0.3.1');
        }
      }
    });
    it('has no current-version "published package version is 0.3.1" sentence (or locale equivalent) in status-and-roadmap, and has a link to the compatibility table anchor — that page\'s own past-fact 0.3.1 mentions are not checked', () => {
      const oldClaims = { '': 'The published package version is 0.3.1', 'ja/': '現在公開されているパッケージバージョンは 0.3.1', 'zh-cn/': '目前已发布的软件包版本为 0.3.1' };
      for (const locale of locales) {
        const document = localizedDoc(locale, 'explanation/status-and-roadmap');
        expect(document, locale).not.toContain(oldClaims[locale]);
        expect(document, locale).toContain(`](/ambercast/${locale}reference/compatibility/#compatibility-table)`);
      }
    });
    it('references src/report/schema.ts:58 in docs/spec/overview.md', () => {
      expect(overview()).toContain('repo:src/report/schema.ts:58');
    });
  });
});
