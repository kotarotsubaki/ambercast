/**
 * Marks parsed-response fields whose descendants can contain dynamic,
 * provider- or configuration-authored keys.
 *
 * This AI and IR concern lives in core because both the AI adapter and
 * usecases may import core as values, the AI adapter may not import report,
 * and no report module depends on it.
 */

export const DYNAMIC_SUBTREE_ROOTS = new Set<string>([
  'generatorMeta',
  'ambiguities',
  'assertion',
  'targets',
  'secretSinkOrigins',
] as const);

/** The stable replacement for a dynamic object key in a report issue path. */
export const REDACTED_ISSUE_PATH_SEGMENT = '[redacted-key]' as const;

/**
 * Redacts dynamic object-key segments from a validation issue path.
 *
 * @param rootValue - The parsed value before schema validation, used to tell
 * arrays from objects at every segment.
 * @param path - The provider or schema issue path to project into a report.
 * @returns A path that preserves literal fields and true array indices while
 * replacing keys below a dynamic subtree with {@link REDACTED_ISSUE_PATH_SEGMENT}.
 *
 * @remarks
 * Traversal walks the parsed value and path together rather than walking the
 * generated schema: `$ref`, `oneOf`, and `anyOf` prevent schema shape from
 * proving every dynamic location. At each segment, `Array.isArray(node)`
 * identifies a true array index, which remains a number; an object segment is
 * a key. This is what distinguishes a `generatorMeta` key literally named
 * `"123"` from an array index, a distinction schema shape alone cannot make.
 *
 * Matching any segment in {@link DYNAMIC_SUBTREE_ROOTS} starts redaction.
 * From that point through the rest of the path, every string-key segment is
 * replaced with {@link REDACTED_ISSUE_PATH_SEGMENT}; array indices remain
 * numeric. The redacting state never turns off after entering a dynamic
 * subtree, so all five roots follow one flat rule with no root-specific
 * un-redaction or special cases.
 */
export function redactDynamicPathSegments(
  rootValue: unknown,
  path: readonly PropertyKey[],
): (string | number)[] {
  const redactedPath: (string | number)[] = [];
  let node: unknown = rootValue;
  let redacting = false;

  for (const segment of path) {
    if (typeof segment === 'symbol') {
      redactedPath.push(REDACTED_ISSUE_PATH_SEGMENT);
    } else if (Array.isArray(node)) {
      redactedPath.push(typeof segment === 'number' ? segment : Number(segment));
    } else if (redacting) {
      redactedPath.push(REDACTED_ISSUE_PATH_SEGMENT);
    } else {
      redactedPath.push(segment);
      if (DYNAMIC_SUBTREE_ROOTS.has(String(segment))) {
        redacting = true;
      }
    }

    node = node !== null && typeof node === 'object' && typeof segment !== 'symbol'
      ? (node as Record<string | number, unknown>)[segment]
      : undefined;
  }

  return redactedPath;
}
