/** Defines the classified failure emitted when fail-closed replay lacks grounding. */

import { AmbercastError } from './types.js';

/** Distinguishes an absent grounding entry from a trace that cannot be replayed safely. */
export type GroundingUnresolvedReason = 'missing' | 'recoverable-miss';

/**
 * Reports an AI-step grounding miss when the caller has not opted into resolution.
 *
 * The typed details preserve the case-local diagnostic required by reports and
 * prevent call sites from collapsing an absent entry and a recoverable trace
 * miss into an unstructured message.
 */
export class GroundingUnresolvedError extends AmbercastError {
  readonly kind = 'grounding-unresolved' as const;

  constructor(
    message: string,
    details: { readonly stepId: string; readonly reason: GroundingUnresolvedReason },
    options?: { cause?: unknown },
  ) {
    super(message, details, options);
  }
}
