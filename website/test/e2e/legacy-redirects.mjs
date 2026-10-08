#!/usr/bin/env node
/**
 * TEST-309-01/02: verify the approved legacy-documentation redirects.
 *
 * This script owns its own 27-row ground-truth table rather than importing
 * `astro.config.mjs`'s generated `redirects` map (per issue #309's
 * approved mapping) -- the point of a
 * dedicated test is an oracle independent of the code it is checking.
 *
 * TEST-309-02 runs first: every `from` in this file's own table is checked
 * for pairwise uniqueness and for `from !== to`, so a copy-paste duplicate
 * or an accidental self-redirect in the ground truth itself is caught
 * before it is ever used to check anything else. Convergent destinations
 * (two different `from` values reaching the same `to`) are explicitly
 * allowed, since the approved mapping has exactly that shape
 * (`guides/commands` and `reference/cli` both resolve to
 * `reference/cli/overview`).
 *
 * TEST-309-01 then builds the site (via the caller's own `npm run build`,
 * not from here) and, for each of the 27 entries, reads the static HTML
 * Astro generates at the old URL and confirms its meta-refresh target is
 * exactly the expected new URL, and that the new URL's own page exists in
 * the built output. Astro's static redirect pages carry no HTTP status (no
 * server is involved in a static build), so the oracle is the meta-refresh
 * tag's `content` attribute, not an HTTP response code.
 *
 * Run manually after `cd website && npm run build`, per the existing
 * `test/e2e/*.mjs` convention this repository already uses for
 * `visual-and-behavior.mjs` -- this file is intentionally not picked up by
 * vitest (whose `include` glob only matches `*.test.ts`).
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const BASE = '/ambercast';
const DIST = fileURLToPath(new URL('../../dist', import.meta.url));

// The approved nine root-locale mappings (issue #309's approved mapping),
// expanded to root/ja/zh-cn below. This table is intentionally independent
// of astro.config.mjs's own copy -- see this file's header comment.
const LEGACY_MAPPINGS = [
  ['guides/introduction', 'introduction'],
  ['guides/getting-started', 'tutorials/quick-start'],
  ['guides/writing-prompts', 'how-to/write-effective-prompts'],
  ['guides/commands', 'reference/cli/overview'],
  ['guides/exit-codes', 'reference/exit-codes'],
  ['guides/artifacts', 'reference/file-layout'],
  ['guides/secrets', 'how-to/manage-secrets'],
  ['guides/ci', 'tutorials/github-actions'],
  ['reference/cli', 'reference/cli/overview'],
];

const LOCALES = [
  { localePrefix: '', localeSegment: '' },
  { localePrefix: '/ja', localeSegment: 'ja/' },
  { localePrefix: '/zh-cn', localeSegment: 'zh-cn/' },
];

const REDIRECTS = LEGACY_MAPPINGS.flatMap(([from, to]) =>
  LOCALES.map(({ localePrefix, localeSegment }) => ({
    from: `${localePrefix}/${from}`,
    to: `${BASE}/${localeSegment}${to}/`,
  })),
);

function checkStructural() {
  assert.equal(REDIRECTS.length, 27, `expected 27 redirects, got ${REDIRECTS.length}`);
  const seen = new Set();
  for (const { from, to } of REDIRECTS) {
    assert.ok(!seen.has(from), `duplicate source key: ${from}`);
    seen.add(from);
    assert.notEqual(`${BASE}${from}/`, to, `self-redirect: ${from} -> ${to}`);
  }
  // reference/configuration keeps its slug across the #500 docs rewrite (it is generated,
  // not hand-authored, so it has no legacy URL to migrate from) -- it must never appear as a
  // source key, in any locale, alongside the 27 approved entries.
  for (const { localePrefix } of LOCALES) {
    assert.ok(!seen.has(`${localePrefix}/reference/configuration`), 'reference/configuration must never be a redirect source');
  }
}

// Astro's static output nests dist/ files by route path alone; `base` is
// embedded in the generated HTML's own URLs (meta-refresh/canonical) but
// never in the dist/ directory layout itself (confirmed by inspecting a
// real `npm run build` output: `dist/guides/introduction/index.html`
// contains `url=/ambercast/introduction/`, not
// `dist/ambercast/guides/introduction/index.html`).
function sourceDistPath(from) {
  return join(DIST, from, 'index.html');
}

function destDistPath(to) {
  const withoutBase = to.startsWith(BASE) ? to.slice(BASE.length) : to;
  return join(DIST, withoutBase, 'index.html');
}

function checkReachability() {
  for (const { from, to } of REDIRECTS) {
    const sourcePath = sourceDistPath(from);
    assert.ok(existsSync(sourcePath), `missing built redirect page for ${from}: ${sourcePath}`);
    const html = readFileSync(sourcePath, 'utf8');
    const match = /<meta http-equiv="refresh" content="[^;]*;url=([^"]*)">/.exec(html);
    assert.ok(match, `no meta-refresh tag found in ${sourcePath}`);
    const target = match[1].replace(/&amp;/g, '&');
    assert.equal(target, to, `redirect ${from} -> expected ${to}, got ${target}`);
    const destinationPath = destDistPath(to);
    assert.ok(existsSync(destinationPath), `destination page missing for ${from} -> ${to}: ${destinationPath}`);
  }
}

function checkConfigurationNotRedirected() {
  for (const { localePrefix } of LOCALES) {
    const path = join(DIST, localePrefix, 'reference/configuration', 'index.html');
    if (!existsSync(path)) continue;
    const html = readFileSync(path, 'utf8');
    assert.ok(!/<meta http-equiv="refresh"/.test(html), `reference/configuration must not be a redirect stub: ${path}`);
  }
}

function main() {
  checkStructural();
  checkReachability();
  checkConfigurationNotRedirected();
  console.log(`legacy-redirects: ${REDIRECTS.length} redirects verified (structural + dist reachability)`);
}

main();
