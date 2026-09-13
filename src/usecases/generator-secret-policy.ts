/**
 * Defines the secret-policy boundary shared by generation and live execution
 * (SPEC-C1-6).
 *
 * This module keeps reviewable artifacts free of literal secrets and gives
 * every committed secret use one canonical enumeration order that consent
 * checking, error reporting, and env-var collision detection all reuse rather
 * than each re-deriving their own plan walk. Authorization is defined by the
 * `secrets.allow` configuration allowlist and checked live against the
 * committed plan by {@link assertSecretUsesAllowed}.
 */
import type { PlanDocument, SecretName, SecretRef, StepId } from '#core/ir/schema.js';
import { SecretRef as SecretRefSchema } from '#core/ir/schema.js';
import { SecretLiteralRejectedError } from '#core/errors/secret-literal-rejected-error.js';
import { SecretConsentRequiredError } from '#core/errors/secret-consent-required-error.js';
import { envVarNameFor } from '#core/secrets/env-var-name.js';

/** Names credential-shaped literal detectors returned by the shared classifier; deliberately excludes walk-only structural detection. */
export type CredentialShapeDetector =
  | 'credential-prefix-sk'
  | 'credential-prefix-ghp'
  | 'credential-prefix-aws-access-key'
  | 'high-entropy-token';

/** Names every detector the JSON walk can report, including an embedded secret reference that the shared classifier deliberately does not return. */
export type WalkSecretDetector = CredentialShapeDetector | 'embedded-secret-reference';

/**
 * Signals instruction-coverage feedback that belongs to one generated AI step.
 *
 * Catchers can use `stepId` to scope corrective response feedback to the
 * provider-authored step that needs correction.
 *
 * @remarks
 * Keeping this context on the attribution error avoids widening the shared
 * instruction-policy result's general contract for callers that do not have a
 * truthful generated-step identity. Instruction-coverage attribution is
 * independent of secret naming, so this error and its callers retain their
 * contract through the naming/allowlist rework.
 */
export class InstructionCoverageAttributionError extends Error {
  /**
   * Creates step-scoped instruction-coverage feedback.
   *
   * @param issues - Deterministic instruction-policy violations for the step.
   * @param stepId - Identifier of the generated AI step that produced them.
   */
  constructor(
    readonly issues: readonly import('./instruction-coverage-policy.js').InstructionCoverageIssue[],
    readonly stepId: string,
  ) {
    super('Generated instruction coverage could not be attributed.');
  }
}

/**
 * Enumerates committed secret uses in the canonical cross-feature order.
 *
 * The walk follows plan-step order, yielding a fill-secret action
 * once and each AI `secrets` entry in its stored array order. `useIndex` is
 * omitted for fills because there is no repeated-use dimension, but retained
 * for AI diagnostics and report joins that need to distinguish original
 * entries. Consent errors and report rows rely on this one ordering rather
 * than reimplementing their own traversal.
 */
export function enumerateSecretUses(plan: PlanDocument): readonly { ref: SecretRef; stepId: StepId; useIndex?: number }[] {
  return plan.steps.flatMap((step) => {
    if (step.kind === 'action' && step.action === 'fill-secret') return [{ ref: step.secretRef, stepId: step.id }];
    if (step.kind === 'ai') return (step.secrets ?? []).map(({ ref }, useIndex) => ({ ref, stepId: step.id, useIndex }));
    return [];
  });
}

/**
 * Enforces the current execution consent set for every committed secret use.
 *
 * `'*'` authorizes every name immediately; an explicit allowlist is compared
 * against the plain name inside each reference. The implementation
 * accumulates every unauthorized use in {@link enumerateSecretUses} order and
 * throws one `SecretConsentRequiredError` with fixed `reason:
 * 'consent-required'` and `details.secrets` rows of `{ name, stepId, envVar,
 * reason }`. Its hint uses deduplicated first-occurrence-order names in the
 * fixed form “`<path>` の `secrets.allow` に <names> を追加するか `"*"` を設定。値は
 * `AMBERCAST_SECRET_<NAME>` に置く”, where `<path>` is `configPath` or
 * `<cwd>/ambercast.config.json` when it is null. `location.configPath` and
 * `location.cwd` make that hint point to the effective policy source without
 * coupling this pure policy to configuration loading. It does not infer
 * provider intent or rename uses: consent is a live operation preflight,
 * intentionally independent of the projected-name selection used during
 * generation.
 */
export function assertSecretUsesAllowed(
  plan: PlanDocument,
  allow: readonly SecretName[] | '*',
  location: { configPath: string | null; cwd: string },
): void {
  if (allow === '*') return;
  const allowed = new Set(allow);
  const rejected = enumerateSecretUses(plan).flatMap(({ ref, stepId }) => {
    const name = ref.slice('{{secrets.'.length, -'}}'.length) as SecretName;
    return allowed.has(name) ? [] : [{ name, stepId, envVar: envVarNameFor(ref), reason: 'not included in secrets.allow' }];
  });
  if (rejected.length === 0) return;
  const names = [...new Set(rejected.map(({ name }) => name))];
  const path = location.configPath ?? `${location.cwd}/ambercast.config.json`;
  throw new SecretConsentRequiredError('Secret consent is required.', {
    reason: 'consent-required',
    secrets: rejected,
    hint: `${path} の secrets.allow に ${names.join(', ')} を追加するか "*" を設定。値は AMBERCAST_SECRET_<NAME> に置く`,
  });
}

const REDACTED_KEY_PATH_SEGMENT = '[redacted-key]';

/**
 * Provides the token-shape gate that {@link hasHighEntropy} requires before
 * it evaluates entropy.
 *
 * Requiring the length threshold and a restricted token charset prevents
 * natural-language sentences and URLs from becoming false positives through
 * character variety alone, as reported in issue #301. Symbols such as
 * `!@#$%^&` are deliberately outside that token shape rather than a known
 * limitation.
 */
function isTokenShaped(value: string): boolean {
  return value.length >= 32 && /^[A-Za-z0-9+/=_.-]+$/.test(value);
}

function hasHighEntropy(value: string): boolean {
  if (!isTokenShaped(value)) return false;
  const counts = new Map<string, number>();
  for (const character of value) counts.set(character, (counts.get(character) ?? 0) + 1);
  return [...counts.values()].reduce((total, count) => {
    const probability = count / value.length;
    return total - probability * Math.log2(probability);
  }, 0) >= 4;
}

/**
 * Classifies a string using the shared credential-literal heuristic.
 *
 * Both `assertNoLiteralSecrets` and a run-time trust boundary consume this
 * primitive, while the result intentionally identifies only the matched
 * detector. It carries neither the caller's identity nor its reason for
 * classifying the value, so each boundary retains ownership of its own
 * exemptions and enforcement policy.
 *
 * @param value - Text to classify without retaining it in the result.
 * @returns The matched detector identifier, or `undefined` when no detector
 * matches.
 */
export function detectSecretLiteral(value: string): CredentialShapeDetector | undefined {
  if (value.startsWith('sk-')) return 'credential-prefix-sk';
  if (value.startsWith('ghp_')) return 'credential-prefix-ghp';
  if (value.startsWith('AKIA')) return 'credential-prefix-aws-access-key';
  return hasHighEntropy(value) ? 'high-entropy-token' : undefined;
}

/**
 * Rejects generated JSON data that contains a detected literal secret.
 *
 * @param value - Any provider-derived JSON value to inspect before persistence
 * or report serialization.
 * @throws {import('#core/errors/secret-literal-rejected-error.js').SecretLiteralRejectedError}
 * When a non-exempt string matches the literal-secret heuristics.
 * @remarks
 * The policy visits every string and object key in the provider-derived JSON
 * graph, including unconstrained `generatorMeta` and reportable ambiguities,
 * using lexical object-key order and array-index order. The walk rejects the
 * first match identified by the shared classifier's four detector set:
 * `credential-prefix-sk` for strings beginning `sk-`,
 * `credential-prefix-ghp` for strings beginning `ghp_`,
 * `credential-prefix-aws-access-key` for strings beginning `AKIA`, and
 * `high-entropy-token` for an otherwise-unconstrained token that has at least
 * 32 UTF-16 code units, contains no whitespace and only
 * `[A-Za-z0-9+/=_.-]`, and whose Shannon entropy is at least 4.0 bits per
 * character.
 *
 * A valid whole-value `{{secrets.*}}` reference is exempt whether the string
 * under examination is a value or an object key. Every other qualifying string
 * value or object key containing `{{secrets.` is rejected as
 * `embedded-secret-reference` before `detectSecretLiteral` is called. Its
 * trigger condition is unconditional, and its reported label is part of the
 * rejection diagnostic contract, so this ordering is not cosmetic.
 *
 * `source.inputsDigest` is exempt by this exact field path because the locally
 * computed SHA-256 digest otherwise resembles high-entropy data. Rejection
 * details contain only the named detector and a dot/bracket JSON-path-like
 * location such as `generatorMeta.apiKeys[0]`; a detected object key uses the
 * fixed `[redacted-key]` segment instead of its value. Diagnostics never retain
 * the rejected literal itself.
 *
 * The walk exempts only `high-entropy-token` at
 * `steps[<index>].url`, `steps[<index>].pattern`, and
 * `targets[<any single key>].baseUrl`; prefix and embedded detectors continue
 * to apply there. Only a value walk whose raw segment array is
 * exactly `['steps', <number>, 'url']`, `['steps', <number>, 'pattern']`, or
 * `['targets', <string>, 'baseUrl']` is exempt, and only when the matched
 * detector is `high-entropy-token`; every other segment sequence, including
 * any key walk and any array-root walk, is not exempt. A URL-shaped value can
 * coincidentally satisfy the token charset without being a credential. The
 * exemption compares a parallel array of raw path segments rather than the
 * rendered dot/bracket path so a `targets` key containing a literal `.` or `[`
 * cannot be confused with a deeper or shallower path by string matching.
 */
export function assertNoLiteralSecrets(value: unknown): void {
  const visit = (nextValue: unknown, path: string, segments: readonly (string | number)[]): void => {
    if (typeof nextValue === 'string') {
      if (path === 'source.inputsDigest' || SecretRefSchema.safeParse(nextValue).success) return;
      const detector: WalkSecretDetector | undefined = nextValue.includes('{{secrets.')
        ? 'embedded-secret-reference'
        : detectSecretLiteral(nextValue);
      if (detector !== undefined && !(detector === 'high-entropy-token' && isHighEntropyTokenExempt(segments))) {
        throw new SecretLiteralRejectedError('The generated plan contains a literal secret.', { detector, path });
      }
      return;
    }
    if (Array.isArray(nextValue)) {
      nextValue.forEach((item, index) => visit(item, `${path}[${index}]`, [...segments, index]));
      return;
    }
    if (nextValue !== null && typeof nextValue === 'object') {
      const record = nextValue as Record<string, unknown>;
      for (const key of Object.keys(record).sort()) {
        const detector: WalkSecretDetector | undefined = SecretRefSchema.safeParse(key).success
          ? undefined
          : key.includes('{{secrets.') ? 'embedded-secret-reference' : detectSecretLiteral(key);
        const childPath = detector === undefined ? (path === '' ? key : `${path}.${key}`) : `${path}${REDACTED_KEY_PATH_SEGMENT}`;
        if (detector !== undefined) {
          throw new SecretLiteralRejectedError('The generated plan contains a literal secret.', { detector, path: childPath });
        }
        visit(record[key], childPath, [...segments, key]);
      }
    }
  };
  visit(value, '', []);
}

function isHighEntropyTokenExempt(segments: readonly (string | number)[]): boolean {
  if (segments.length !== 3) return false;
  const [root, middle, leaf] = segments;
  if (root === 'steps' && typeof middle === 'number') return leaf === 'url' || leaf === 'pattern';
  return root === 'targets' && typeof middle === 'string' && leaf === 'baseUrl';
}
