/*
 * Provides the error type for agentic target resolution failures during MCP tool execution.
 *
 * @remarks
 * This module defines the error type and budget constant for agentic target rejection,
 * living in `core` so that both `usecases` (type-only-restricted from `ports`) and
 * `adapters` can import it as a runtime value, per `tools/architecture-policy.mjs`.
 *
 * It deliberately is not an `AmbercastError` so it never touches the public
 * exit-code/report error-code contract. This is a recoverable error that participates
 * in the MCP target-rejection budget (3 attempts), allowing the provider to retry
 * after observing the current page state.
 *
 * `AGENTIC_TARGET_REJECTION_LIMIT` is the single source of truth for this
 * budget, so MCP enforcement and any case-level explanation that needs the
 * number cannot drift by maintaining separate copies.
 */

import type { GroundingMissReason } from './grounding-miss-reason.js';
import type { BoundElementRejectionReason } from './bound-element-rejected-error.js';

export type AgenticToolName = 'ambercast_perform' | 'ambercast_evaluate_assert' | 'ambercast_snapshot';

export const AGENTIC_TARGET_REJECTION_LIMIT = 3;

export type AgenticTargetRejectionReason = GroundingMissReason | Exclude<BoundElementRejectionReason, 'provenance-invalid'>;

/**
 * Reports that an agentic tool's target could not be resolved and provides recovery information.
 *
 * @remarks
 * This error is thrown when an agentic tool (`ambercast_perform` or `ambercast_evaluate_assert`)
 * cannot resolve its target because the element is missing, ambiguous, stale, or otherwise
 * unavailable. It is a recoverable error that participates in the MCP target-rejection budget
 * (3 attempts), allowing the provider to observe the current page state via `ambercast_snapshot`
 * and retry with a new target.
 *
 * It is a plain `Error` subclass, not an `AmbercastError`, so it does not participate in
 * the public exit-code or report error-code contract. The `exhausted` flag is set by the
 * MCP server when the budget is exhausted; the controller always throws with `exhausted: false`.
 *
 * The `provenance-invalid` reason (internal invariant violation) is excluded from this
 * recoverable set and remains on the existing latch path.
 */
export class AgenticTargetRejection extends Error {
  constructor(readonly tool: Exclude<AgenticToolName, 'ambercast_snapshot'>, readonly reason: AgenticTargetRejectionReason, readonly exhausted = false) {
    super(`The agentic ${tool} target could not be resolved: ${reason}.`);
    this.name = 'AgenticTargetRejection';
  }
}
