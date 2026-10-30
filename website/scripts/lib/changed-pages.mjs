// Path selection and baseline comparison are pure so repository state and stale
// generated files cannot influence their contracts; orchestration owns all I/O.

const GROUPS = ['start-here', 'tutorials', 'how-to', 'explanation', 'reference', 'spec', 'agents'];

/**
 * Maps a repository-relative source path to its documentation page variant.
 *
 * @remarks The mapping is:
 *
 * | Source | Slug | Locale |
 * | --- | --- | --- |
 * | website/src/content/docs/<slug>.md or .mdx | <slug> | en |
 * | website/src/content/docs/ja/<slug>.md or .mdx | <slug> | ja |
 * | website/src/content/docs/zh-cn/<slug>.md or .mdx | <slug> | zh-cn |
 * | docs/spec/<name>.md | spec/<name> | en |
 *
 * Root-locale website spec paths are ignored because docs/spec is their only
 * source. Slugs must match /^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/ and the checker's known
 * groups: tutorials, how-to, explanation, reference, spec, agents, or start-here
 * via introduction, philosophy, and how-it-works. Assets, non-Markdown files,
 * preview-blocks.mdx, invalid stems, and unknown groups return null.
 * This mapping makes no claim about presence; only a materialized tree can
 * distinguish a removed page from a missing translation.
 * @param {string} path Repository-relative source path.
 * @returns {{ slug: string, locale: 'en'|'ja'|'zh-cn' }|null} Mapped variant or null.
 */
export function variantForPath(path) {
  if (!path || typeof path !== 'string') {
    return null;
  }
  if (path.startsWith('website/src/content/docs/spec/')) {
    return null;
  }

  const websitePattern = /^website\/src\/content\/docs\/(ja\/|zh-cn\/)?([a-z0-9-]+(?:\/[a-z0-9-]+)*)\.(md|mdx)$/;
  const websiteMatch = path.match(websitePattern);
  if (websiteMatch) {
    const localePrefix = websiteMatch[1];
    const slug = websiteMatch[2];
    let locale = 'en';
    if (localePrefix === 'ja/') {
      locale = 'ja';
    } else if (localePrefix === 'zh-cn/') {
      locale = 'zh-cn';
    }
    return mapSlugToVariant(slug, locale);
  }

  const specPattern = /^docs\/spec\/(?:.*\/)?([^/]+)\.(md|mdx)$/;
  const specMatch = path.match(specPattern);
  if (specMatch) {
    const slug = `spec/${specMatch[1]}`;
    return mapSlugToVariant(slug, 'en');
  }

  return null;
}

/**
 * Maps a slug to a variant, validating against known groups.
 * @param {string} slug The page slug.
 * @param {string} locale The locale.
 * @returns {{ slug: string, locale: 'en'|'ja'|'zh-cn' }|null} Mapped variant or null.
 */
function mapSlugToVariant(slug, locale) {
  const slugPattern = /^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/;
  if (!slugPattern.test(slug)) {
    return null;
  }

  const segments = slug.split('/');
  const first = segments[0];
  if (first === 'introduction' || first === 'philosophy' || first === 'how-it-works') {
  } else if (!GROUPS.includes(first)) {
    return null;
  }

  return { slug, locale };
}

/**
 * Selects candidate slugs and each head variant's comparison predecessor.
 *
 * @remarks Input records use git name-status A, M, D, T, R<score>, or C<score>;
 * untracked paths arrive as A. Candidates contain every A/M/D/T slug, both
 * rename endpoints, and only the destination of a copy, de-duplicated and sorted.
 * Keeping the rename source checks surviving translations for a newly missing
 * locale. A doc-to-non-doc rename is a deletion; the reverse is an addition.
 * Copies retain the destination's own baseline rather than borrowing the source.
 *
 * The returned map holds only rename overrides; a variant without an entry is
 * compared with the same slug and locale, so callers apply that default on a
 * lookup miss rather than receiving an entry per candidate. A doc-to-doc rename overrides
 * only its destination variant with the source variant. Keys are slug + '\0' +
 * locale, so unchanged translations retain their own baseline and two locales of
 * one head page may come from different base pages. Several rename records can
 * target one variant, for example both <slug>.md and <slug>.mdx. selectChanges
 * sorts rename records by (destination path, source path) before assigning
 * predecessors, and the first record per destination variant wins. Default
 * assignments must not overwrite rename overrides, so the result never depends
 * on input order. Head inspection still reports page-ambiguous for the two files.
 * The caller decides presence and removal from materialized trees; this helper
 * neither probes paths nor invokes git.
 * @param {Array<{ status: string, path: string, from?: string }>} changes Parsed changes, with path as destination and from as rename/copy source.
 * @returns {{ candidates: string[], predecessor: Map<string, { slug: string, locale: 'en'|'ja'|'zh-cn' }> }} Candidate slugs and per-variant predecessors.
 */
export function selectChanges(changes) {
  const records = [];
  for (const change of changes) {
    const { status, path, from } = change;

    if (!/^[AMDT]$/.test(status) && !/^[RC]\d+$/.test(status)) {
      throw new Error(`Invalid status: ${status}`);
    }

    if ((status.startsWith('R') || status.startsWith('C')) && !from) {
      throw new Error(`Missing source for ${status} record`);
    }

    records.push({ status, path, from });
  }

  const renameRecords = records.filter((r) => r.status.startsWith('R')).sort((a, b) => {
    const pathCmp = a.path.localeCompare(b.path);
    if (pathCmp !== 0) return pathCmp;
    return (a.from || '').localeCompare(b.from || '');
  });

  const renameOverrides = new Map();

  for (const record of renameRecords) {
    const destVariant = variantForPath(record.path);
    const srcVariant = variantForPath(record.from);

    if (destVariant && srcVariant) {
      // The presence guard preserves the first record in deterministic sort order.
      const key = `${destVariant.slug}\0${destVariant.locale}`;
      if (!renameOverrides.has(key)) {
        renameOverrides.set(key, srcVariant);
      }
    }
  }

  const candidateSet = new Set();

  for (const record of records) {
    const destVariant = variantForPath(record.path);
    const srcVariant = variantForPath(record.from);

    if (destVariant) {
      if (record.status.startsWith('R')) {
        candidateSet.add(destVariant.slug);
      } else if (record.status.startsWith('C')) {
        candidateSet.add(destVariant.slug);
      } else {
        candidateSet.add(destVariant.slug);
      }
    }

    if (srcVariant && record.status.startsWith('R')) {
      candidateSet.add(srcVariant.slug);
    }
  }

  return {
    candidates: [...candidateSet].sort(),
    predecessor: renameOverrides,
  };
}

/**
 * Returns head findings that cannot be matched by the predecessor's findings.
 *
 * @remarks The caller supplies one head variant and its predecessor base variant.
 * Equality uses (locale, rule, severity, expected, actual), with multiplicity:
 * the k-th base occurrence of a key cancels the k-th head occurrence of that key
 * in head order, so surplus head occurrences are the later ones. Page names are
 * outside the key because renamed pages compare against their predecessors.
 * Line numbers are excluded because moving unchanged prose must not create a
 * new finding. Results retain head order and head line numbers. Empty base input
 * leaves every head finding new; warnings and errors participate separately.
 * No I/O is needed because orchestration already supplies both complete sets.
 * @param {Array<import('./prose-text.mjs').Violation>} head Head variant findings.
 * @param {Array<import('./prose-text.mjs').Violation>} base Predecessor variant findings.
 * @returns {Array<import('./prose-text.mjs').Violation>} Unmatched head findings.
 */
export function newViolations(head, base) {
  const baseCounts = new Map();
  for (const finding of base) {
    const key = JSON.stringify({
      locale: finding.locale,
      rule: finding.rule,
      severity: finding.severity,
      expected: finding.expected,
      actual: finding.actual,
    });
    baseCounts.set(key, (baseCounts.get(key) || 0) + 1);
  }

  const result = [];
  for (const finding of head) {
    const key = JSON.stringify({
      locale: finding.locale,
      rule: finding.rule,
      severity: finding.severity,
      expected: finding.expected,
      actual: finding.actual,
    });

    const count = baseCounts.get(key) || 0;
    if (count > 0) {
      baseCounts.set(key, count - 1);
    } else {
      result.push(finding);
    }
  }

  return result;
}
