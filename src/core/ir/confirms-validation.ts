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
 * order. The future
 * PlanDocument superRefine adds each returned issue at its precise path;
 * this pure core function does not depend on usecase attribution policy.
 *
 * @param steps - The plan steps in their committed order.
 * @returns Every step-relative code, path, and explanation to report.
 */
export function validateConfirms(steps: readonly Step[]): ConfirmsValidationIssue[] {
  throw new Error('not implemented (step 11)');
}
