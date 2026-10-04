/*
 * Classifies a normally exited child agent's explicit failure outcome.
 */

import { AmbercastError } from './types.js';

/**
 * Reports an AI-directed step that the child agent declared unsuccessful.
 *
 * @remarks
 * A normal process exit with a `failure` outcome needs a classified case error
 * rather than an unclassified case abort, so reports retain safe diagnostics.
 * Callers provide case-only details with the step identifier, completed tool
 * call counters, and the last failed assertion when one exists.
 */
export class AgenticStepFailedError extends AmbercastError {
  readonly kind = 'agentic-step-failed' as const;
}
