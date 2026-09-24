import { readFile } from 'node:fs/promises';

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

/**
 * Reads the capability-to-page JSON mapping, validates its root and capability values,
 * and returns the parsed mapping without modification. Read, parse, and validation
 * failures throw instead of producing a partial mapping.
 *
 * The JSON root must have both a `capabilities` key and an `unlisted` key, each holding
 * a non-null, non-array object (a plain object). A missing or invalid key throws
 * `Invalid capability-pages mapping: "<key>" is not an object`. Capability values
 * must be non-empty arrays of non-empty strings. They are checked in `Object.entries`
 * file order, stopping at the first invalid key. Unlisted entry value types are
 * deliberately outside this validation.
 *
 * @remarks
 * Centralizing this validation lets checkReference await the reader before any
 * documentation-page read, so a broken mapping fails first. This reader duplicates
 * rather than replaces checkPlannedPages's inline root shape check; that check still
 * protects direct callers that bypass readCapabilityPages.
 *
 * @param {string} path Path to the capability-pages JSON file.
 * @returns {Promise<{ capabilities: Record<string, string[]>, unlisted: Record<string, object> }>}
 * The parsed, validated mapping without modification.
 * @throws {Error} Read or parse failures, invalid root keys as above, or
 * `capability-pages.json: capabilities.<key> must be a non-empty array of non-empty strings`.
 */
export async function readCapabilityPages(path) {
  const mapping = JSON.parse(await readFile(path, 'utf8'));
  for (const key of ['capabilities', 'unlisted']) {
    if (typeof mapping?.[key] !== 'object' || mapping[key] === null || Array.isArray(mapping[key])) {
      throw new Error(`Invalid capability-pages mapping: "${key}" is not an object`);
    }
  }
  for (const [key, value] of Object.entries(mapping.capabilities)) {
    if (!Array.isArray(value) || value.length === 0 || !value.every((entry) => typeof entry === 'string' && entry.length > 0)) {
      throw new Error(`capability-pages.json: capabilities.${key} must be a non-empty array of non-empty strings`);
    }
  }
  return mapping;
}
