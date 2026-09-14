/**
 * Declares the exclusive configuration write-back boundary for consented
 * secret names.
 */

import type { SecretName } from '#core/ir/schema.js';
import type { StorageAdapter } from '#ports/storage.js';

/**
 * Identifies the configuration state from which consent was requested.
 *
 * The load-time existence bit lets the eventual exclusive update reject a
 * disappearing configured file while still safely creating the conventional
 * default that did not exist when the command started. The writer must resolve
 * neither field itself, keeping project-layout policy at the runtime boundary
 * (SPEC-C2-9).
 */
export interface SecretsAllowlistSource {
  /** Absolute effective config path fixed before the consent exchange. */
  readonly path: string;
  /** Whether that exact path existed when configuration was loaded. */
  readonly existedAtLoad: boolean;
}

/**
 * Commits newly consented secret names through the storage-exclusive updater.
 *
 * @param storage - Storage that owns the exclusive update boundary.
 * @param source - Effective configuration location and load-time existence.
 * @param names - Names approved for the configured allowlist.
 * @param signal - Optional cancellation signal.
 * @returns Resolves after the merged allowlist is durable, or after a
 *   semantically unchanged update leaves the configuration untouched.
 * @throws A configuration or filesystem error when the current document
 *   cannot be safely validated and merged.
 *
 * @remarks
 * The eventual implementation does every read, validation, order-preserving
 * merge, and write inside `updateTextExclusive`. A prior parsed config is not
 * safe to patch after the user responds: concurrent content must be validated
 * rather than overwritten, while unrelated key order remains reviewable
 * (SPEC-C2-9, SPEC-C2-10).
 */
export async function commitAllowlist(
  _storage: StorageAdapter,
  _source: SecretsAllowlistSource,
  _names: readonly SecretName[],
  _signal?: AbortSignal,
): Promise<void> {
  throw new Error('not implemented');
}
