import type { SecretRef } from '#core/ir/schema.js';
import { SecretEnvVarCollisionError } from '#core/errors/secret-env-var-collision-error.js';

/**
 * Derives the process-environment key for one logical secret reference.
 *
 * This is intentionally the single extraction of the environment provider's
 * legacy slice, replacement, uppercase, and prefix convention. Naming policy
 * may reason in secret references, while provider lookup and collision checks
 * must use exactly the externally observable environment spelling: strip the
 * `{{secrets.` prefix and `}}` suffix, replace every `.` with `_`, uppercase
 * the result, then prepend `AMBERCAST_SECRET_`.
 */
export function envVarNameFor(ref: SecretRef): string {
  return `AMBERCAST_SECRET_${ref.slice('{{secrets.'.length, -'}}'.length).replaceAll('.', '_').toUpperCase()}`;
}

/**
 * Rejects distinct logical references that collapse to one environment key.
 *
 * The implementation groups by {@link envVarNameFor}, ignores
 * repeated copies of the same reference, and reports the smallest colliding
 * environment key when several groups exist. Its error details retain the
 * colliding references in UTF-16 sort order so a deterministic plan cannot
 * acquire host-order-dependent diagnostics. This preflight protects the
 * provider boundary from silently reading one secret for another.
 */
export function assertNoEnvVarCollision(refs: readonly SecretRef[]): void {
  const byEnvVar = new Map<string, Set<SecretRef>>();
  for (const ref of refs) {
    const envVar = envVarNameFor(ref);
    const group = byEnvVar.get(envVar) ?? new Set<SecretRef>();
    group.add(ref);
    byEnvVar.set(envVar, group);
  }
  const collision = [...byEnvVar]
    .filter(([, group]) => group.size > 1)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))[0];
  if (collision !== undefined) {
    const [envVar, group] = collision;
    throw new SecretEnvVarCollisionError('Multiple secret references map to one environment variable.', {
      envVar,
      refs: [...group].sort(),
    });
  }
}
