/** Pure, step-order validation for confirmation references in a plan. */
import type { Step } from './schema.js';

/** Closed reasons for invalid confirmation references. */
export type ConfirmsValidationIssueCode =
  | 'confirms-unknown-step'
  | 'confirms-not-earlier'
  | 'confirms-not-action'
  | 'confirms-duplicate'
  | 'confirms-unsorted';

/** One issue whose path can be passed to PlanDocument's superRefine. */
export interface ConfirmsValidationIssue {
  readonly code: ConfirmsValidationIssueCode;
  readonly path: readonly (string | number)[];
  readonly message: string;
}

/**
 * Validates every confirmation reference against the full plan order.
 *
 * @remarks `confirms-unknown-step` reports an ID that does not resolve to any
 * plan step. `confirms-not-earlier` reports an existing step that is the same
 * step or later in plan order. `confirms-not-action` reports an earlier step
 * that is neither a click, press, fill, or fill-secret action nor a capture
 * step. `confirms-duplicate` reports an ID repeated within one step's
 * `confirms` array. `confirms-unsorted` reports IDs not in ascending plan
 * order. A referenced step may have a different target from the confirming
 * step; target mismatch is never a violation. Check each step's `confirms`
 * array independently and collect every violation across all steps, rather
 * than stopping at the first. Each issue uses the PlanDocument superRefine
 * path `['steps', stepIndex, 'confirms', entryIndex]` to identify the offending
 * reference. This pure core function does not depend on usecase attribution
 * policy.
 *
 * @param steps - The plan steps in their committed order.
 * @returns Every violation's code, PlanDocument-relative path, and explanation.
 */
export function validateConfirms(steps: readonly Step[]): ConfirmsValidationIssue[] {
  throw new Error('not implemented (step 11)');
}
