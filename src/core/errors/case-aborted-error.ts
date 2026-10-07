/*
 * Classifies a case aborted mid-step for a caller-correctable-or-environmental
 * reason captured by CaseAbortReason.
 */

import { AmbercastError } from './types.js';

/**
 * Closes the reasons a mid-step abort can report instead of leaving the case
 * as an unclassified crash. They cover run values and references, incomplete
 * secret filling, agentic terminal evidence, coverage and proof gaps, and
 * grounding secret contamination or snapshot gaps.
 */
export type CaseAbortReason =
  | 'run-reference-invalid'
  | 'run-value-missing'
  | 'secret-fill-incomplete'
  | 'agentic-no-terminal-evidence'
  | 'agentic-coverage-inexact'
  | 'agentic-proof-invalid'
  | 'grounding-secret-contaminated'
  | 'grounding-snapshot-invalid';

/**
 * Preserves a caller-diagnosable reason and step for a case aborted mid-step.
 * Its details always contain both `reason` and `stepId` because construction
 * requires both values.
 */
export class CaseAbortedError extends AmbercastError {
  readonly kind = 'case-aborted' as const;

  constructor(message: string, reason: CaseAbortReason, stepId: string) {
    super(message, { reason, stepId });
  }
}
