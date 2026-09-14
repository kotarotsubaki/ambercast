/**
 * Declares the exclusive configuration write-back boundary for consented
 * secret names.
 */

import type { SecretName } from '#core/ir/schema.js';
import { CONFIG_SCHEMA_ID } from '#core/config/json-schema.js';
import { FsIoError } from '#core/errors/fs-io-error.js';
import type { StorageAdapter } from '#ports/storage.js';
import { parseAndValidateRawConfig } from './load.js';

/**
 * Identifies the configuration state from which consent was requested.
 *
 * The load-time existence bit lets the exclusive update reject a
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
 * Every read, validation, and merge occurs inside `updateTextExclusive`. A
 * prior parsed config is not safe to patch after the user responds: concurrent
 * content must be validated rather than overwritten, while unrelated key
 * order remains reviewable (SPEC-C2-9, SPEC-C2-10).
 */
export async function commitAllowlist(
  storage: StorageAdapter,
  source: SecretsAllowlistSource,
  names: readonly SecretName[],
  signal?: AbortSignal,
): Promise<void> {
  await storage.updateTextExclusive(source.path, (current) => {
    if (current === null) {
      if (source.existedAtLoad) {
        throw new FsIoError(
          'The configuration file disappeared before its allowlist could be updated.',
          { configPath: source.path },
        );
      }

      return serialize({
        $schema: CONFIG_SCHEMA_ID,
        secrets: { allow: mergeNames([], names) },
      });
    }

    parseAndValidateRawConfig(current, source.path);
    const rawObject = JSON.parse(current) as Record<string, unknown>;
    const currentSecrets = rawObject.secrets as { readonly allow: readonly SecretName[] | '*' } | undefined;

    if (currentSecrets?.allow === '*') {
      return null;
    }

    const currentNames = currentSecrets?.allow ?? [];
    const mergedNames = mergeNames(currentNames, names);
    if (currentSecrets !== undefined && arraysEqual(currentNames, mergedNames)) {
      return null;
    }

    rawObject.secrets = { allow: mergedNames };
    return serialize(rawObject);
  }, signal);
}

function mergeNames(current: readonly SecretName[], incoming: readonly SecretName[]): SecretName[] {
  const deduplicatedCurrent = [...new Set(current)];
  const currentSet = new Set(deduplicatedCurrent);
  const additions = [...new Set(incoming)]
    .filter((name) => !currentSet.has(name))
    .sort();

  return [...deduplicatedCurrent, ...additions];
}

function arraysEqual(left: readonly SecretName[], right: readonly SecretName[]): boolean {
  return left.length === right.length && left.every((name, index) => name === right[index]);
}

function serialize(document: Record<string, unknown>): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}
