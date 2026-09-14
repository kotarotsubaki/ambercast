import type { SecretName, SecretRef } from './schema.js';

/** Extracts the logical secret name from one validated secret reference. */
export function secretNameFor(ref: SecretRef): SecretName {
  return ref.slice('{{secrets.'.length, -'}}'.length) as SecretName;
}
