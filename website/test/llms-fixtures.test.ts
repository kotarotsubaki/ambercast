import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { orderedPages } from '../src/sidebar.mjs';
import { siteDescriptions } from '../src/data/site-descriptions.mjs';
import { parseFrontmatter } from '../scripts/lib/frontmatter.mjs';
import { main as syncSpec } from '../scripts/sync-spec.mjs';
import {
  buildPageUrl,
  inflateIntroduction,
  renderLlmsFullTxt,
  renderLlmsPlannedTxt,
  renderLlmsTxt,
} from '../scripts/lib/llms.mjs';

const fixturesDirectory = new URL('./fixtures/llms/', import.meta.url);
const specDirectory = new URL('../src/content/docs/spec/', import.meta.url);
const websiteRoot = fileURLToPath(new URL('../', import.meta.url));

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

/**
 * Names the fixtures whose expected content actually depends on `package.json`'s
 * live version. `sync-spec.mjs` regenerates only the English `spec/` content root
 * from the live version on every test run (see its `main()`); the `ja`/`zh-cn`
 * translations under `src/content/docs/{ja,zh-cn}/spec/` are ordinary committed
 * Markdown, refreshed only by a separate, manually-run migration script, so their
 * `blob/v<version>/` links never move when a release bumps the version. The
 * three full fixtures (`llms-full.txt`, `ja-llms-full.txt`, and
 * `zh-cn-llms-full.txt`) all inline page bodies, but only the English one reads
 * from the live-version content root; the locale fixtures read committed static
 * translations. The planned/index fixtures (`llms.txt`, `ja-llms.txt`,
 * `zh-cn-llms.txt`, and `llms-planned.txt`) never inline page bodies, so none
 * contains a `blob/v.../` link. `llms-full.txt` is therefore the only fixture
 * whose expected value should ever be rewritten to a different version.
 */
const VERSION_TRACKED_FIXTURES = new Set(['llms-full.txt']);

/**
 * Rewrites every `blob/v<frozen>/` repository permalink in fixture text to point
 * at a different version, so a golden fixture can stay byte-pinned for its
 * non-version content while still tracking whatever version the real generator
 * currently produces. The frozen version is read from the fixture text itself
 * rather than hardcoded, so this function needs no edit the next time a release
 * moves it forward — there is nothing version-specific left in the test file.
 *
 * A fixture with no `blob/v.../` occurrences at all (any fixture not listed in
 * {@link VERSION_TRACKED_FIXTURES}) is returned unchanged: absence of
 * version-pinned content is a valid, silent no-op, not an error condition.
 *
 * It collects every `blob/v<version>/` occurrence with
 * a global regex scan, reduces the captured versions to a `Set` to confirm the
 * fixture pins exactly one consistent value, then performs an exact-substring
 * global replacement rather than a dynamic `RegExp`-based `.replace` —
 * sidestepping both the pattern-escaping and the `$`-prefixed-replacement-string
 * pitfalls a dynamic pattern/replacement pair would otherwise introduce.
 *
 * @param fixtureText Raw fixture file contents.
 * @param liveVersion The version to substitute in place of whatever is frozen.
 * @returns `fixtureText` with every `blob/v<frozen>/` segment replaced by
 * `blob/v<liveVersion>/`, or the unchanged input when there is nothing to replace.
 * @throws {Error} If the fixture pins more than one distinct frozen version —
 * a defensive check against silently normalizing a fixture that (through
 * corruption or a bad manual edit) no longer pins a single consistent value,
 * where replacing only the first occurrence found would silently leave the rest
 * wrong.
 */
function withLiveVersion(fixtureText: string, liveVersion: string): string {
  const matches = [...fixtureText.matchAll(/blob\/v([^/]+)\//g)];
  if (matches.length === 0) return fixtureText;
  const frozen = new Set(matches.map((match) => match[1]));
  if (frozen.size !== 1) {
    throw new Error(`fixture pins ${frozen.size} distinct blob versions, expected exactly one`);
  }
  return fixtureText.split(`blob/v${[...frozen][0]}/`).join(`blob/v${liveVersion}/`);
}

/**
 * Computes what a fixture's contents should equal when compared against live
 * generator output, sharing the exact comparison path between the golden test
 * and its own regression test. Only fixtures in {@link VERSION_TRACKED_FIXTURES}
 * are passed through {@link withLiveVersion}; every other fixture is expected to
 * match byte-for-byte as committed, because its actual output never depends on
 * the live version (see {@link VERSION_TRACKED_FIXTURES}'s own rationale).
 *
 * A fixture not in the set never reaches {@link withLiveVersion} at all, so its
 * frozen version is never rewritten regardless of what `liveVersion` is.
 *
 * @param fixtureName The fixture's filename (a key into `outputs` in the golden test).
 * @param fixtureText Raw fixture file contents.
 * @param liveVersion The version the current generator run actually used.
 * @returns The exact string the corresponding generated output must equal.
 */
function expectedFixtureContents(fixtureName: string, fixtureText: string, liveVersion: string): string {
  return VERSION_TRACKED_FIXTURES.has(fixtureName) ? withLiveVersion(fixtureText, liveVersion) : fixtureText;
}

beforeAll(async () => {
  if (!existsSync(specDirectory)) await syncSpec({ websiteRoot });
});

function sourcePath(locale: 'en' | 'ja' | 'zh-cn', slug: string) {
  const directory = new URL(`../src/content/docs/${locale === 'en' ? '' : `${locale}/`}`, import.meta.url);
  for (const extension of ['.md', '.mdx']) {
    const candidate = new URL(`${slug}${extension}`, directory);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Missing source for ${locale}/${slug}`);
}

function recordsFor(locale: 'en' | 'ja' | 'zh-cn') {
  return orderedPages.map((page) => {
    const parsed = parseFrontmatter(readFileSync(sourcePath(locale, page.slug), 'utf8'));
    const body = page.slug === 'introduction'
      ? inflateIntroduction(
        parsed.body,
        JSON.parse(readFileSync(new URL(`../src/data/intro/${locale}.json`, import.meta.url), 'utf8')),
      )
      : parsed.body;
    return { ...page, ...parsed, body, url: buildPageUrl(locale, page.slug) };
  });
}

describe('golden fixtures', () => {
  it('matches every llms artifact generated from the real ordered source documents', () => {
    const records = Object.fromEntries(['en', 'ja', 'zh-cn'].map((locale) => [locale, recordsFor(locale as 'en' | 'ja' | 'zh-cn')]));
    const outputs = {
      'llms.txt': renderLlmsTxt(records.en, siteDescriptions.en),
      'llms-full.txt': renderLlmsFullTxt(records.en),
      'ja-llms.txt': renderLlmsTxt(records.ja, siteDescriptions.ja),
      'ja-llms-full.txt': renderLlmsFullTxt(records.ja),
      'zh-cn-llms.txt': renderLlmsTxt(records['zh-cn'], siteDescriptions['zh-cn']),
      'zh-cn-llms-full.txt': renderLlmsFullTxt(records['zh-cn']),
      'llms-planned.txt': renderLlmsPlannedTxt(records.en),
    };

    for (const [fixture, output] of Object.entries(outputs)) {
      const fixtureText = readFileSync(join(fixturesDirectory.pathname, fixture), 'utf8');
      expect(output).toBe(expectedFixtureContents(fixture, fixtureText, pkg.version));
    }
  });

  it('tracks the live version through the shared expected-fixture comparison path', () => {
    const fixtureText = readFileSync(join(fixturesDirectory.pathname, 'llms-full.txt'), 'utf8');
    const expected = expectedFixtureContents('llms-full.txt', fixtureText, '9.9.9-regression-probe');

    const frozenLink = fixtureText.match(/blob\/v[^/]+\//)?.[0];
    expect(frozenLink).toBeDefined();

    expect(expected).not.toBe(fixtureText);
    expect(expected).toContain('blob/v9.9.9-regression-probe/');
    expect(expected).not.toContain(frozenLink!);
  });

  it('does not rewrite an untracked locale fixture', () => {
    const fixtureText = readFileSync(join(fixturesDirectory.pathname, 'ja-llms-full.txt'), 'utf8');

    expect(expectedFixtureContents('ja-llms-full.txt', fixtureText, '9.9.9-regression-probe')).toBe(fixtureText);
  });

  it('leaves text without version-pinned links unchanged', () => {
    expect(withLiveVersion('no links here', '9.9.9')).toBe('no links here');
  });

  it('throws when a fixture pins multiple distinct versions', () => {
    expect(() => withLiveVersion('blob/v1.0.0/a.ts\nblob/v2.0.0/b.ts', '9.9.9')).toThrow();
  });

  it('replaces every occurrence of a frozen version', () => {
    const result = withLiveVersion('blob/v0.3.1/a.ts\nblob/v0.3.1/b.ts\nblob/v0.3.1/c.ts', '9.9.9');

    expect(result.match(/blob\/v0\.3\.1\//g) ?? []).toHaveLength(0);
    expect(result.match(/blob\/v9\.9\.9\//g) ?? []).toHaveLength(3);
  });

  it('substitutes a pre-release live version containing regex-special characters', () => {
    const result = withLiveVersion('blob/v0.3.1/x.ts', '1.10.0-rc.1');

    expect(result).toContain('blob/v1.10.0-rc.1/x.ts');
    expect(result).not.toContain('blob/v0.3.1/');
  });
});
