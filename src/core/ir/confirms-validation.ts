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
 * Removes navigation references from confirmation lists before plan validation.
 *
 * @remarks A confirmation is held by an assert or ai step, referencing an
 * earlier click, press, fill, fill-secret action, or capture step whose outcome
 * it depends on and that a later repair can ground again. Navigation has no locator
 * to rebind, so a provider's navigation reference cannot serve that role.
 * Rejecting it as `confirms-not-action` would conflate this structural mismatch
 * with an incorrectly chosen confirmable action, though the rejection path has
 * no distinct recovery for navigation. The reference is therefore inert.
 * The minimal structural bound accepts both committed plan steps and Stage 2
 * provider steps without coupling their otherwise different schemas.
 * Every caller's `T` must declare `confirms` as a genuinely optional
 * `readonly string[] | undefined` field, never a required field or tuple.
 * The explicit `undefined` also matches Zod output under
 * `exactOptionalPropertyTypes`.
 * Removing an emptied `confirms` property requires an internal `as T` cast
 * because the structural bound cannot exclude stricter callers. Every real
 * caller declares `confirms` as genuinely optional, so the cast is sound for
 * both current call sites; future callers must preserve that contract.
 *
 * @param steps - Steps to project without changing their other fields.
 * @param navigateIds - IDs of navigation actions in the caller's plan context.
 * @returns Steps with those IDs removed from `confirms`; an emptied list has
 * no `confirms` property, and a step lacking `confirms` stays untouched.
 */
export function dropNavigateConfirms<T extends { id: string; confirms?: readonly string[] | undefined }>(
  steps: readonly T[],
  navigateIds: ReadonlySet<string>,
): T[] {
  return steps.map((step) => {
    if (step.confirms === undefined) return step;
    const confirms = step.confirms.filter((id) => !navigateIds.has(id));
    if (confirms.length === step.confirms.length) return step;
    if (confirms.length > 0) return { ...step, confirms };
    const { confirms: _removed, ...withoutConfirms } = step;
    return withoutConfirms as T; // ponytail: as T trusts every caller's confirms to stay optional; upgrade to a branded/exact-shape type if a stricter-confirms caller appears.
  });
}

// Type guard to check if a step has the confirms property
function hasConfirms(step: Step): step is Step & { confirms: readonly string[] } {
  const confirms = (step as { confirms?: unknown }).confirms;
  return Array.isArray(confirms) && confirms.length > 0;
}

// Type guard to check if a step is an action step with a known action
function isActionStep(step: Step): step is Step & { kind: 'action'; action: 'click' | 'press' | 'fill' | 'fill-secret' } {
  return step.kind === 'action' &&
    (step.action === 'click' || step.action === 'press' || step.action === 'fill' || step.action === 'fill-secret');
}

// Type guard to check if a step is a capture step
function isCaptureStep(step: Step): step is Step & { kind: 'capture' } {
  return step.kind === 'capture';
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
  const issues: ConfirmsValidationIssue[] = [];

  // Build a map from step id to its index for quick lookup
  const stepIndexMap = new Map<string, number>();
  for (let i = 0; i < steps.length; i++) {
    const currentStep = steps[i];
    if (currentStep) {
      stepIndexMap.set(currentStep.id, i);
    }
  }

  for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
    const step = steps[stepIndex];
    if (!step) {
      continue;
    }

    // Skip steps without confirms array
    if (!hasConfirms(step)) {
      continue;
    }

    const seenIds = new Map<string, number>(); // id -> first occurrence index
    let lastReferencedPlanIndex = -1;

    for (let entryIndex = 0; entryIndex < step.confirms.length; entryIndex++) {
      const entryId = step.confirms[entryIndex]!;
      const path = ['steps', stepIndex, 'confirms', entryIndex] as const;

      if (seenIds.has(entryId)) {
        issues.push({
          code: 'confirms-duplicate',
          path,
          message: `step id "${entryId}" is repeated in the confirms array`,
        });
        continue;
      }
      seenIds.set(entryId, entryIndex);

      // Check 1: Unknown step ID
      const referencedIndex = stepIndexMap.get(entryId);
      if (referencedIndex === undefined) {
        issues.push({
          code: 'confirms-unknown-step',
          path,
          message: `step id "${entryId}" in confirms array does not match any step in the plan`,
        });
        // Skip other checks for this entry
        continue;
      }

      // Check 2: Must reference an earlier step (strictly less index)
      if (referencedIndex >= stepIndex) {
        issues.push({
          code: 'confirms-not-earlier',
          path,
          message: `step id "${entryId}" refers to a step that is not earlier in plan order`,
        });
        // Skip the next check for this entry (confirms-not-action)
        // But we still need to track for unsorted check
        lastReferencedPlanIndex = referencedIndex;
        continue;
      }

      // Check 3: Must be an action step (click, press, fill, fill-secret) or capture step
      const referencedStep = steps[referencedIndex];
      if (!referencedStep) {
        continue;
      }

      const isValidAction = isActionStep(referencedStep) || isCaptureStep(referencedStep);
      if (!isValidAction) {
        issues.push({
          code: 'confirms-not-action',
          path,
          message: `step id "${entryId}" refers to a step that is not a valid action or capture step`,
        });
      }

      // Check 4 (separate): Must be in ascending plan order
      // Only compare if this entry passed the earlier checks (known, earlier, valid-kind)
      // Report unsorted only if this is NOT a duplicate (i.e., new ID with wrong order)
      if (lastReferencedPlanIndex >= 0 && referencedIndex <= lastReferencedPlanIndex) {
        issues.push({
          code: 'confirms-unsorted',
          path,
          message: `step id "${entryId}" is not in strictly ascending plan order relative to previous confirms entries`,
        });
      }

      // Update lastReferencedPlanIndex for the next entry comparison
      // (only if this entry passed the earlier checks)
      if (referencedIndex < stepIndex) {
        lastReferencedPlanIndex = referencedIndex;
      }
    }
  }

  return issues;
}
