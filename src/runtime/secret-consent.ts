import type { ConsentCapability } from '#usecases/generate.js';

/**
 * Creates the interactive half of the secret-consent capability.
 *
 * @param deps - Injected terminal streams, interactivity decision, and
 *   cancellation boundary.
 * @returns A request function that returns one terminal consent decision.
 *
 * @remarks
 * The eventual reader owns only interactive selection and renaming. It uses
 * injected streams to keep terminal behavior testable and writes exclusively
 * to stderr so stdout stays available to machine-readable reports. A
 * non-interactive terminal resolves without output; command composition owns
 * the equivalent JSON and text diagnostic so both modes have one rendering
 * policy (SPEC-C2-4, SPEC-C2-5).
 */
export function createInteractiveSecretConsent(_deps: {
  /** Source of terminal responses, injected instead of reading process stdin directly. */
  readonly input: NodeJS.ReadableStream;
  /** Diagnostic-only destination; production composition provides stderr. */
  readonly output: NodeJS.WritableStream;
  /** Runtime-owned TTY/CI decision that prevents prompting where input is unavailable. */
  readonly isInteractive: () => boolean;
  /** Optional batch interruption boundary shared with generation. */
  readonly signal?: AbortSignal;
}): ConsentCapability['request'] {
  return async () => {
    /*
     * The eventual request consumes all prepared unmet uses in their preserved
     * occurrence order and returns exactly one of the declared decisions.
     * It deliberately does not commit names: the use case must first validate
     * simultaneous rename substitutions and persist the accepted allowlist
     * before any candidate artifact can settle (SPEC-C2-3, SPEC-C2-4).
     */
    throw new Error('not implemented');
  };
}
