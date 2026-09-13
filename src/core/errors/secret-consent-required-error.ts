import type { SecretName, StepId } from '#core/ir/schema.js';
import { AmbercastError } from './types.js';

/**
 * Stable, safe evidence for secret uses that lack execution consent.
 *
 * The top-level reason defines the three user-decision outcomes so one error
 * contract serves every consent decision. Each row repeats name, step, and
 * environment spelling
 * because remediation must identify both the plan use and the host setting
 * without exposing a secret value. The free-text row reason remains extensible
 * guidance rather than a second closed policy vocabulary.
 */
export interface SecretConsentRequiredDetails {
  readonly reason: 'consent-required' | 'declined' | 'not-interactive';
  readonly secrets: readonly {
    readonly name: SecretName;
    readonly stepId: StepId;
    readonly envVar: string;
    readonly reason: string;
  }[];
  readonly hint: string;
}

/**
 * Signals that a structurally valid plan requests a secret outside the
 * applicable consent set.
 *
 * This remains distinct from unresolved-provider lookup: consent is checked
 * deterministically before browser or provider work, so callers can correct
 * policy without treating the failure as an execution-environment problem.
 */
export class SecretConsentRequiredError extends AmbercastError {
  readonly kind = 'secret-consent-required' as const;
}
