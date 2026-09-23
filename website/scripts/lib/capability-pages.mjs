/**
 * Derives planned page slugs from the mapping rather than maintaining another list in
 * documentation tests. The union includes every capability value and every
 * explicitly unlisted key, deduplicates shared pages, and sorts the result ascending;
 * callers must not infer an llms publication order from this set.
 *
 * @param {{ capabilities: Record<string, string[]>, unlisted: Record<string, object> }} mapping
 * Capability-to-page mapping and explicitly unlisted planned pages.
 * @returns {string[]} Planned page slugs in ascending order.
 */
export function plannedPageSlugs(mapping) {
  return [...new Set([...Object.values(mapping.capabilities).flat(), ...Object.keys(mapping.unlisted)])].sort();
}
