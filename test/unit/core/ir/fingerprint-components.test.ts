/** Independent component oracles prevent a shared hashing mistake from blessing changed identity rules. */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildFingerprintComponents, computeAccessibilityFingerprint, resolveAccessibilityFingerprint } from '#core/ir/fingerprint.js';
import { toCanonicalDigestBytes } from '#core/ir/canonical-json.js';
import type { JsonValueT } from '#core/ir/schema.js';
import { loadCorpus } from '../../../support/corpus.js';

const identity = z.object({ role: z.string(), name: z.string() });
const descriptorSchema = identity.extend({ parent: identity, siblingBefore: identity.nullable(), siblingAfter: identity.nullable() });
const descriptor = { role: 'button', name: 'Submit', parent: { role: 'group', name: 'Form' }, siblingBefore: { role: 'text', name: 'Before' }, siblingAfter: { role: 'link', name: 'After' } };
const ref = { strategy: 'accessibility', role: 'button', name: 'Submit' } as const;
function tree(d = descriptor): JsonValueT {
  return { role: 'root', name: '', children: [{ ...d.parent, children: [
    ...(d.siblingBefore === null ? [] : [{ ...d.siblingBefore, children: [] }]),
    { role: d.role, name: d.name, children: [] },
    ...(d.siblingAfter === null ? [] : [{ ...d.siblingAfter, children: [] }]),
  ] }] };
}
// Only the public canonical byte contract is shared; preimages and SHA-256 are
// assembled here rather than obtained from either production fingerprint helper.
const hash = (value: JsonValueT) => createHash('sha256').update(toCanonicalDigestBytes(value)).digest('hex');
const oracle = (d: z.infer<typeof descriptorSchema>) => ({
  algorithm: 'a11y-components-v1',
  structure: hash({ role: d.role, name: d.name, parentRole: d.parent.role, siblingBeforeRole: d.siblingBefore?.role ?? null, siblingAfterRole: d.siblingAfter?.role ?? null }),
  parentName: hash({ slot: 'parent', name: d.parent.name }),
  siblingBeforeName: d.siblingBefore === null ? null : hash({ slot: 'siblingBefore', name: d.siblingBefore.name }),
  siblingAfterName: d.siblingAfter === null ? null : hash({ slot: 'siblingAfter', name: d.siblingAfter.name }),
});

describe('TEST-COMP-1 component identity', () => {
  it('repeats all four values for identical evidence', () => {
    expect(buildFingerprintComponents(descriptor)).toEqual(buildFingerprintComponents(descriptor));
  });
  it('matches independently hashed preimages for every component', () => {
    expect(buildFingerprintComponents(descriptor)).toEqual(oracle(descriptor));
  });
  const schemas = { value: descriptorSchema, expected: z.array(z.string()) };
  it.each(loadCorpus(new URL('../../../fixtures/corpus/fingerprint/components-sensitivity.jsonl', import.meta.url), schemas))('line $line: $note', ({ value, expected }) => {
    const baseline = buildFingerprintComponents(descriptor)!;
    const changed = buildFingerprintComponents(value)!;
    expect(changed).toEqual(oracle(value));
    expect(Object.keys(baseline).filter(key => baseline[key as keyof typeof baseline] !== changed[key as keyof typeof changed])).toEqual(expected);
  });
});

describe('TEST-COMP-2 boundary neighborhoods', () => {
  it.each(['first', 'last', 'only'] as const)('hashes missing sibling roles as null for the %s child', position => {
    const d = { ...descriptor, siblingBefore: position === 'last' ? descriptor.siblingBefore : null, siblingAfter: position === 'first' ? descriptor.siblingAfter : null };
    expect(buildFingerprintComponents(d)).toEqual(oracle(d));
  });
  it('retains a stable parent hash for the synthetic root', () => {
    const d = { ...descriptor, parent: { role: 'root', name: '' }, siblingBefore: null, siblingAfter: null };
    expect(buildFingerprintComponents(d)).toEqual(oracle(d));
    expect(buildFingerprintComponents(d)?.parentName).toBe(buildFingerprintComponents(d)?.parentName);
  });
});

describe('TEST-COMP-3 unhashable names', () => {
  it.each(['target', 'parent', 'siblingBefore', 'siblingAfter'] as const)('keeps ordinary no-match classifications for %s surrogates', slot => {
    const d = structuredClone(descriptor);
    if (slot === 'target') d.name = '\ud800'; else d[slot].name = '\ud800';
    const locator = { ...ref, name: d.name };
    expect(buildFingerprintComponents(d)).toBeUndefined();
    expect(computeAccessibilityFingerprint(tree(d), locator, [])).toEqual({ kind: 'no-match' });
    expect(resolveAccessibilityFingerprint(tree(d), locator, { algorithm: 'a11y-neighborhood-v2', hash: 'a'.repeat(64) })).toBe('element-not-found');
  });
});

describe('TEST-COMP-4 generation and verification trust boundaries', () => {
  it('adds components without changing the frozen full-fingerprint preimage', () => {
    expect(computeAccessibilityFingerprint(tree(), ref, [])).toEqual({ kind: 'ok', fingerprint: { algorithm: 'a11y-neighborhood-v2', hash: hash(descriptor) }, components: oracle(descriptor) });
  });
  it.each(['target', 'parent', 'siblingBefore', 'siblingAfter'] as const)('rejects secret role and name fields at %s before producing hashes', slot => {
    for (const field of ['role', 'name'] as const) {
      const d = structuredClone(descriptor);
      (slot === 'target' ? d : d[slot])[field] = 'private-value';
      expect(computeAccessibilityFingerprint(tree(d), { ...ref, role: d.role, name: d.name }, [new Set(['private-value'])])).toEqual({ kind: 'secret-contaminated' });
    }
  });
  it('keeps secret rejection ahead of unpaired-surrogate classification', () => {
    const d = { ...descriptor, parent: { role: 'group', name: 'private-value' }, siblingBefore: { role: 'text', name: '\ud800' } };
    expect(computeAccessibilityFingerprint(tree(d), ref, [new Set(['private-value'])])).toEqual({ kind: 'secret-contaminated' });
  });
  it('verifies changed secret-bearing live neighbors as ordinary fingerprint drift', () => {
    const d = { ...descriptor, siblingBefore: { role: 'text', name: 'private-value' } };
    expect(resolveAccessibilityFingerprint(tree(d), ref, { algorithm: 'a11y-neighborhood-v2', hash: hash(descriptor) })).toBe('fingerprint-mismatch');
  });
});
