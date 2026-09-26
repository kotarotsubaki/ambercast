const KIND_RANK = { config: 0, plan: 1, grounding: 2, report: 3 };
const VERSIONED = /^(plan|grounding|report)\.v([1-9][0-9]{0,14})\.schema\.json$/;

/**
 * Orders published schema filenames from `website/public/schemas/`, populated by
 * `sync-generated.mjs`, to match the machine-readable-resources page's table.
 * Config comes first, followed by plan, grounding, and report; versions within
 * each kind ascend numerically, so v10 follows v9. Only `config.schema.json` and
 * `<plan|grounding|report>.v<N>.schema.json` are recognized, where N starts
 * with 1–9 and has at most 14 more decimal digits. Every accepted version
 * is exactly representable and comparable as a Number; names with longer
 * versions are unrecognized. The caller guarantees string entries, so this
 * function checks filename content without validating the input's shape.
 *
 * @remarks
 * This lets the e2e resource-link assertion derive expected hrefs from published
 * files instead of a literal list that becomes stale when schema versions change.
 *
 * @param {readonly string[]} names Raw directory-entry names.
 * @returns {string[]} A new array in page-table order; the input is not mutated.
 * @throws {Error} Checks run in order: empty input throws `no published schema files`;
 * then the first unrecognized name in iteration order throws
 * `unrecognized published schema file: <name>`; then a repeated name throws
 * `duplicate published schema file: <name>`. An unrecognized name is reported
 * even if a recognized name was repeated earlier in the array.
 */
export function orderSchemaFilenames(names) {
  if (names.length === 0) throw new Error('no published schema files');
  const parsed = names.map((name) => {
    if (name === 'config.schema.json') return { name, rank: 0, version: 0 };
    const match = VERSIONED.exec(name);
    if (!match) throw new Error(`unrecognized published schema file: ${name}`);
    return { name, rank: KIND_RANK[match[1]], version: Number(match[2]) };
  });
  const seen = new Set();
  for (const { name } of parsed) {
    if (seen.has(name)) throw new Error(`duplicate published schema file: ${name}`);
    seen.add(name);
  }
  return [...parsed].sort((a, b) => a.rank - b.rank || a.version - b.version).map(({ name }) => name);
}
