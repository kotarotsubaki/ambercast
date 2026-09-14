/** Validates the intentionally narrow terminal outcome shared by agentic providers. */

import { z } from 'zod';

import type { AiAgenticResult } from '#ports/ai.js';

/**
 * The only provider result that can finalize an agentic interaction.
 *
 * Strictness prevents provider-specific metadata from silently becoming part
 * of the cross-provider completion contract; usage accounting stays outside
 * this final response because neither CLI offers one compatible shape here.
 */
export const FinalOutcome = z.strictObject({
  outcome: z.enum(['success', 'failure']),
});

/**
 * Parses a provider's final output against {@link FinalOutcome}.
 *
 * Malformed JSON, missing fields, and additional fields must remain execution
 * errors instead of being reinterpreted as a completed browser outcome.
 */
export function parseFinalOutcome(raw: string): AiAgenticResult {
  return FinalOutcome.parse(JSON.parse(raw));
}
