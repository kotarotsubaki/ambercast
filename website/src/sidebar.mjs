// One static, specification-derived ordered table supplies both Starlight navigation and
// page-title labels; runtime input never determines group or item order. Slugs are canonical
// locale-free paths with no normalization, so callers must remove a locale prefix before lookup.
// CLI is deliberately nested beneath REFERENCE and displays as `REFERENCE · CLI` rather than as
// a peer top-level group. Numbering is one-based and resets within each displayed group or
// subgroup, keeping the page-title ordinal aligned with the navigation list the reader sees.
const groups = [
  ['START HERE', ['introduction', 'philosophy']],
  ['TUTORIALS', ['tutorials/quick-start', 'tutorials/review-your-first-plan', 'tutorials/repair-your-first-drift', 'tutorials/github-actions']],
  ['HOW-TO GUIDES', ['how-to/write-effective-prompts', 'how-to/manage-secrets', 'how-to/configure-targets', 'how-to/choose-ai-provider', 'how-to/select-tests', 'how-to/control-grounding-writeback', 'how-to/review-generated-diffs', 'how-to/manage-artifacts-in-git', 'how-to/run-on-other-ci', 'how-to/recover-stale-artifacts', 'how-to/upgrade', 'how-to/troubleshoot', 'how-to/contribute']],
  ['REFERENCE', [
    'reference/configuration', 'reference/prompt-format', 'reference/discovery-patterns', 'reference/reports', 'reference/error-codes', 'reference/exit-codes', 'reference/environment-variables', 'reference/file-layout', 'reference/json-schemas', 'reference/compatibility', 'reference/changelog', 'reference/security-policy', 'reference/glossary', 'reference/mcp-tools',
    ['CLI', ['reference/cli/overview', 'reference/cli/generate', 'reference/cli/run', 'reference/cli/check', 'reference/cli/heal', 'reference/cli/init', 'reference/cli/view', 'reference/cli/review', 'reference/cli/mcp', 'reference/cli/baseline-restore']],
  ]],
  ['PLAN SPECIFICATION', ['spec/overview', 'spec/plan-document', 'spec/steps', 'spec/value-types', 'spec/grounding-document', 'spec/fingerprint', 'spec/freshness', 'spec/canonical-json', 'spec/secrets', 'spec/conformance', 'spec/changelog']],
  ['EXPLANATION', ['explanation/plan-lifecycle', 'explanation/replay-and-grounding', 'explanation/healing-model', 'explanation/trust-and-security', 'explanation/determinism-in-ci', 'explanation/comparison', 'explanation/status-and-roadmap']],
  ['FOR AI AGENTS', ['agents/overview', 'agents/operating-contract', 'agents/setup-prompt', 'agents/reading-structured-output', 'agents/machine-readable-resources', 'agents/official-skill', 'agents/mcp-server']],
];

/**
 * Starlight's `sidebar:` configuration, generated from the canonical documentation table.
 *
 * @type {Array<{ label: string, items: Array<{ slug?: string, label?: string, items?: Array<{ slug: string }> }> }>}
 * Each top-level group and nested CLI subgroup retains the table's declared order and nesting,
 * so navigation and page-title ordinals describe the same reader-visible hierarchy.
 */
export const sidebar = groups.map(([label, items]) => ({
  label,
  items: items.map((item) => Array.isArray(item)
    ? { label: item[0], items: item[1].map((slug) => ({ slug })) }
    : { slug: item }),
}));

/**
 * Flat, ordered page records shared by navigation consumers and the llms build.
 *
 * Sharing the static table keeps published machine-readable indexes in the reader-visible
 * Starlight order. Subgroup labels preserve the structural boundary needed to render `### CLI`
 * without inferring meaning from slugs.
 *
 * @returns {Array<{ slug: string, groupLabel: string, subgroupLabel: string | null }>} Every
 * sidebar page in canonical display order, including its group and optional subgroup.
 */
export const orderedPages = groups.flatMap(([groupLabel, items]) =>
  items.flatMap((item) => Array.isArray(item)
    ? item[1].map((slug) => ({ slug, groupLabel, subgroupLabel: item[0] }))
    : [{ slug: item, groupLabel, subgroupLabel: null }]));

/**
 * Finds a page's visible navigation group and its one-based position within that group.
 *
 * The lookup derives from the same static ordered table as {@link sidebar}, so
 * `PageTitle.astro` does not maintain a second page-number map. Its one-based index resets for
 * each displayed group or subgroup, including the `REFERENCE · CLI` subgroup. Pages outside the
 * documented sidebar deliberately return `undefined` and retain their caller's landing fallback.
 *
 * @param {string} slug Canonical page slug without a locale prefix.
 * @returns {{ groupLabel: string, indexInGroup: number } | undefined} Location for a sidebar
 * page, or `undefined` when the slug has no navigation entry.
 */
export function getPageLocation(slug) {
  for (const [groupLabel, items] of groups) {
    let indexInGroup = 0;
    for (const item of items) {
      if (Array.isArray(item)) {
        const [subgroupLabel, subgroupItems] = item;
        const subgroupIndex = subgroupItems.indexOf(slug);
        if (subgroupIndex !== -1) {
          return { groupLabel: `${groupLabel} · ${subgroupLabel}`, indexInGroup: subgroupIndex + 1 };
        }
      } else {
        indexInGroup += 1;
        if (item === slug) return { groupLabel, indexInGroup };
      }
    }
  }
}
