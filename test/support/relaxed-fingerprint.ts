import { computeAccessibilityFingerprint } from '#core/ir/fingerprint.js';
import type { JsonValueT } from '#core/ir/schema.js';

export const RELAX_REF = { strategy: 'accessibility', role: 'button', name: 'Submit' } as const;

export function neighborTree(change: Record<string, string | boolean> = {}): JsonValueT {
  return { role: 'root', name: '', children: [{
    role: change.parentRole ?? 'group', name: change.parent ?? 'Container', children: [
      ...(change.beforePresent === false ? [] : [{ role: change.beforeRole ?? 'button', name: change.siblingBefore ?? 'Alpha', children: [] }]),
      { role: 'button', name: change.target ?? 'Submit', children: [] },
      ...(change.afterPresent === false ? [] : [{ role: change.afterRole ?? 'button', name: change.siblingAfter ?? 'Omega', children: [] }]),
    ],
  }] };
}

export function observation(tree: JsonValueT = neighborTree()) {
  const result = computeAccessibilityFingerprint(tree, RELAX_REF, []);
  if (result.kind !== 'ok') throw new Error(`Fixture needs unique hashable evidence: ${result.kind}`);
  return { fingerprint: result.fingerprint, components: result.components };
}
