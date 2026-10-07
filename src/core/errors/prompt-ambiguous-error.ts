/*
 * Classifies a generator response that reported unresolved prompt ambiguities.
 */

import { AmbercastError } from './types.js';

/**
 * Reports choices the generator could not resolve on its own so the caller
 * can correct the prompt instead of treating the response as an environment
 * failure. `ambiguities` is always a positive count of those choices.
 */
export class PromptAmbiguousError extends AmbercastError {
  readonly kind = 'prompt-ambiguous' as const;

  constructor(message: string, ambiguities: number) {
    super(message, { ambiguities });
  }
}
