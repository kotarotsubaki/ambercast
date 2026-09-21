/*
 * Provides the error type for bound element rejection during agentic execution.
 *
 * @remarks
 * This is a port-contract value type living in `core` specifically so that both
 * `usecases` (which are type-only-restricted from importing `ports`) and
 * `adapters` can import it as a runtime value, per `tools/architecture-policy.mjs`.
 *
 * It deliberately is not an `AmbercastError` so it never touches the public
 * exit-code/report error-code contract. Only `provenance-invalid` (an internal
 * invariant violation, not a UI change) remains on the existing latch path.
 * The recoverable rejection reasons (`navigation-stale`, `fingerprint-verification-failed`,
 * `element-detached`) are mapped to `AgenticTargetRejection` for MCP budgeting.
 */

export type BoundElementRejectionReason = 'navigation-stale' | 'fingerprint-verification-failed' | 'provenance-invalid' | 'element-detached';

/**
 * Reports a bound element that could not be used for an agentic browser action.
 *
 * @remarks
 * This error is thrown when a previously bound element is no longer usable due to
 * navigation, fingerprint verification failure, or detachment from the DOM.
 * It is a plain `Error` subclass, not an `AmbercastError`, so it does not
 * participate in the public exit-code or report error-code contract.
 *
 * The `provenance-invalid` reason represents an internal invariant violation
 * (passing a BoundElement from a different session) and is not recoverable
 * via MCP retries; it remains on the existing `scrubBrowserRejection` → latch path.
 * The other reasons (`navigation-stale`, `fingerprint-verification-failed`,
 * `element-detached`) are mapped to `AgenticTargetRejection` for MCP budgeting.
 */
export class BoundElementRejectedError extends Error {
  constructor(readonly reason: BoundElementRejectionReason, message: string) {
    super(message);
    this.name = 'BoundElementRejectedError';
  }
}
