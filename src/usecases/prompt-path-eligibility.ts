/*
 * Defines the selection-time eligibility boundary shared by read-selecting
 * use cases.
 */

import { PromptPathInvalidError } from '#core/errors/prompt-path-invalid-error.js';
import type { LayoutResolver } from '#core/layout/resolve.js';

/**
 * Asserts that every selected prompt path is eligible for processing.
 *
 * @param layout - The configured layout authority that classifies a path.
 * @param files - Selected absolute prompt paths in their established order.
 * @returns Nothing; the function either returns silently or throws.
 * @throws {import('#core/errors/prompt-path-invalid-error.js').PromptPathInvalidError}
 *   Throws for the first ineligible path with
 *   its original absolute path and classifier reason.
 * @remarks
 * This deliberately accepts neither configuration nor project-root state:
 * selection owns the absolute input and report finalization owns portable
 * path conversion. The loop preserves file order so one bad path
 * aborts the batch deterministically before any case observes cancellation,
 * I/O, provider, or browser work. An empty selection is a no-op.
 */
export function assertPromptPathsEligible(layout: LayoutResolver, files: readonly string[]): void {
  for (const file of files) {
    const reason = layout.promptPathIneligibility(file);
    if (reason !== undefined) {
      throw new PromptPathInvalidError('The selected prompt path is not an eligible .test.md file.', { path: file, reason });
    }
  }
}
