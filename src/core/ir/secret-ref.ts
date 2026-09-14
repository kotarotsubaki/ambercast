import type { SecretName, SecretRef } from './schema.js';

/**
 * Extracts the logical name carried by one schema-validated secret reference.
 *
 * This shared boundary prevents generation, Stage 2 reservations, and Stage 3
 * set comparison from each slicing the same opaque reference differently
 * (SPEC-C3-2). It accepts `SecretRef`, rather than arbitrary text, because
 * validation owns the reference grammar; this helper deliberately exposes no
 * second parser or fallback interpretation.
 *
 * @param ref - A reference already accepted by the plan schema.
 * @returns The corresponding logical secret name.
 */
export function secretNameFor(ref: SecretRef): SecretName {
  return ref.slice('{{secrets.'.length, -'}}'.length) as SecretName;
}
