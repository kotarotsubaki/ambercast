/** Defines the classified failure emitted when fail-closed replay lacks grounding. */

import { AmbercastError } from './types.js';
import type { GroundingMissReason } from './grounding-miss-reason.js';
import type { FingerprintNameSlot } from '../ir/schema.js';

/** Distinguishes an absent grounding entry from a trace that cannot be replayed safely. */
export type GroundingUnresolvedReason = 'missing' | 'recoverable-miss' | 'no-candidate' | 'ambiguous' | 'proposal-rejected' | 'candidate-changed';

/**
 * Reports an AI or element step grounding miss when resolution is not permitted.
 *
 * The typed details preserve the case-local diagnostic required by reports and
 * prevent call sites from collapsing an absent entry and a recoverable trace
 * miss into an unstructured message.
 *
 * A no-candidate or ambiguous proposal carries only its proposal outcome.
 * A proposal that cannot be matched uniquely carries the found outcome, role,
 * name, and rejection; an array of matches also carries its nonnegative integer
 * count, including zero, while an invalid snapshot carries no count.
 * Fingerprint or role rejection carries its rejection, and a candidate changed
 * during re-observation carries the verification miss reason. Those latter
 * failures include the found outcome, role, and name only for AI proposals,
 * never for candidates selected by quoted text. Other grounding misses retain
 * only the step identifier and reason. Recoverable stored misses retain
 * verification and, for known fingerprint differences, the difference kind;
 * only neighbor-name differences carry changedNames. Inapplicable keys are
 * omitted, and candidate-changed retains its existing evidence. Run
 * owns these combinations; report validation stays outside the core error.
 * The added evidence contains slot identifiers rather than screen text or secrets.
 *
 * Proposal role and name retain the AI response values, including an empty
 * name, until report redaction masks resolved secrets and run-variable values.
 * Closed diagnostic vocabularies and the match count survive redaction unchanged.
 */
export class GroundingUnresolvedError extends AmbercastError {
  readonly kind = 'grounding-unresolved' as const;

  constructor(
    message: string,
    details: {
      readonly stepId: string;
      readonly reason: GroundingUnresolvedReason;
      readonly proposalOutcome?: 'none' | 'ambiguous' | 'found';
      readonly proposalRole?: string;
      readonly proposalName?: string;
      readonly proposalMatchCount?: number;
      readonly rejection?: 'not-unique' | 'snapshot-invalid' | 'fingerprint-unavailable' | 'role-mismatch';
      readonly verification?: GroundingMissReason;
      readonly difference?: 'neighbor-names' | 'structure';
      readonly changedNames?: readonly [FingerprintNameSlot, ...FingerprintNameSlot[]];
    },
    options?: { cause?: unknown },
  ) {
    super(message, details, options);
  }
}
