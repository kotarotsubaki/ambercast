/**
 * Reasons a current page cannot safely satisfy a grounding query.
 *
 * This contract lives in `core` because both use cases and adapters may
 * import it as a value or type, while `core` cannot depend on `ports`. The
 * browser port re-exports it to keep the port contract discoverable.
 *
 * This is shared by the browser port's resolution result and every caller
 * that turns a miss into user-facing control flow, so adding a new reason
 * remains a single contract change.
 */
export type GroundingMissReason =
  | 'fingerprint-mismatch'
  | 'element-not-found'
  | 'ambiguous-match'
  | 'snapshot-invalid'
  | 'secret-contaminated';
