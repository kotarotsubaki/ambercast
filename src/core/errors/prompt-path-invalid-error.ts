/*
 * Provides the classified failure for a selected prompt path that cannot
 * participate in Ambercast's test-file layout.
 */

import { AmbercastError } from './types.js';

/**
 * Reports a selected prompt path outside the eligible `.test.md` domain.
 *
 * @remarks
 * The classification stays separate from configuration errors because a
 * valid configuration can still receive an invalid literal selection or a
 * discovery result that cannot safely enter per-file processing. Structured
 * path and reason evidence remains in the base error's details bag so the
 * reporting boundary can publish only its stable public projection.
 */
export class PromptPathInvalidError extends AmbercastError {
  readonly kind = 'prompt-path-invalid' as const;
}
