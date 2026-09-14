/**
 * Declares the exclusive configuration write-back boundary for consented
 * secret names.
 */

import type { SecretName } from '#core/ir/schema.js';
import type { StorageAdapter } from '#ports/storage.js';

/** Source identity retained from the configuration snapshot used for consent. */
export interface SecretsAllowlistSource {
  readonly path: string;
  readonly existedAtLoad: boolean;
}

/**
 * Commits newly consented secret names through the storage-exclusive updater.
 *
 * @param storage - Storage that owns the exclusive update boundary.
 * @param source - Effective configuration location and load-time existence.
 * @param names - Names approved for the configured allowlist.
 * @param signal - Optional cancellation signal.
 */
export async function commitAllowlist(
  _storage: StorageAdapter,
  _source: SecretsAllowlistSource,
  _names: readonly SecretName[],
  _signal?: AbortSignal,
): Promise<void> {
  throw new Error('not implemented');
}
