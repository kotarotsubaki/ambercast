import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { compareAccessibilityFingerprint, computeAccessibilityFingerprint, resolveAccessibilityFingerprint, verifyAccessibilityFingerprint } from '#core/ir/fingerprint.js';
import { SNAPSHOT_INVALID } from '#core/ir/aria-snapshot.js';
import type { JsonValueT } from '#core/ir/schema.js';
import { FingerprintNameSlot } from '#core/ir/schema.js';
import { loadCorpus } from '../../../support/corpus.js';
import { neighborTree, observation, RELAX_REF } from '../../../support/relaxed-fingerprint.js';

const rows = loadCorpus(new URL('../../../fixtures/corpus/grounding/relaxed-match.jsonl', import.meta.url), {
  value: z.object({ test: z.enum(['1', '2', '3']), change: z.record(z.string(), z.union([z.string(), z.boolean()])), ignoredNames: z.array(FingerprintNameSlot).optional(), legacy: z.boolean().optional(), corruptFingerprint: z.boolean().optional(), matrix: z.boolean().optional() }),
  expected: z.object({ kind: z.enum(['hit', 'fingerprint-mismatch', 'element-not-found']), difference: z.enum(['structure', 'neighbor-names']).optional(), changedNames: z.array(FingerprintNameSlot).optional() }),
});

for (const id of ['1', '2', '3']) {
  describe(`TEST-RELAX-${id}`, () => {
    it.each(rows.filter(row => row.value.test === id).flatMap(row => [false, true].filter(pure => !pure || row.expected.kind !== 'element-not-found').map(pure => ({ ...row, pure }))))('line $line: $note (pure=$pure)', ({ value, expected, pure }) => {
      const baseline = observation();
      const stored = {
        fingerprint: value.corruptFingerprint ? { ...baseline.fingerprint, hash: 'f'.repeat(64) } : baseline.fingerprint,
        ...(value.legacy ? {} : { components: baseline.components }),
        ...(value.ignoredNames === undefined ? {} : { ignoredNames: value.ignoredNames }),
      };
      const tree = neighborTree(value.change);
      const actual = pure ? compareAccessibilityFingerprint(stored, observation(tree)) : verifyAccessibilityFingerprint(tree, RELAX_REF, stored);
      if (expected.kind === 'hit') expect(actual).toStrictEqual({ kind: 'hit', ...observation(tree) });
      else expect(actual).toStrictEqual(expected);
    });
  });
}

describe('TEST-RELAX-2 target identity', () => {
  it('classifies a changed target name as structural drift in the pure comparison', () => {
    const tree = neighborTree({ target: 'Continue' });
    const current = computeChangedTarget(tree);
    expect(compareAccessibilityFingerprint({ ...observation(), ignoredNames: ['parent', 'siblingBefore', 'siblingAfter'] }, current)).toEqual({ kind: 'fingerprint-mismatch', difference: 'structure' });
  });
  it('keeps verification free of generation-time secret rejection', () => {
    const secret = 'contract-secret-720';
    const tree = neighborTree({ siblingBefore: secret });
    expect(computeAccessibilityFingerprint(tree, RELAX_REF, [new Set([secret])])).toEqual({ kind: 'secret-contaminated' });
    expect(verifyAccessibilityFingerprint(tree, RELAX_REF, { ...observation(), ignoredNames: ['siblingBefore'] })).toEqual({ kind: 'hit', ...observation(tree) });
  });
  it('does not use relaxed hashes to choose among duplicate locators', () => {
    const tree = { role: 'root', name: '', children: [neighborTree(), neighborTree()] };
    expect(verifyAccessibilityFingerprint(tree, RELAX_REF, { ...observation(), ignoredNames: ['parent', 'siblingBefore', 'siblingAfter'] })).toEqual({ kind: 'ambiguous-match' });
  });
  it('retains the invalid-snapshot gate', () => {
    const clonedMarker = JSON.parse(JSON.stringify(SNAPSHOT_INVALID)) as JsonValueT;
    expect(clonedMarker).not.toBe(SNAPSHOT_INVALID);
    for (const tree of [SNAPSHOT_INVALID, clonedMarker]) {
      expect(verifyAccessibilityFingerprint(tree, RELAX_REF, { ...observation(), ignoredNames: ['parent'] })).toEqual({ kind: 'snapshot-invalid' });
    }
  });
  it('retains the existing classification for a malformed non-marker tree', () => {
    const baseline = observation();
    const existing = resolveAccessibilityFingerprint(null, RELAX_REF, baseline.fingerprint);
    expect(existing).toBe('element-not-found');
    expect(verifyAccessibilityFingerprint(null, RELAX_REF, { ...baseline, ignoredNames: ['parent'] })).toEqual({ kind: existing });
  });
  it('does not construct evidence for an unpaired surrogate', () => {
    const tree = neighborTree({ parent: '\ud800' });
    expect(verifyAccessibilityFingerprint(tree, RELAX_REF, { ...observation(), ignoredNames: ['parent'] })).toEqual({ kind: 'element-not-found' });
  });
});

function computeChangedTarget(tree: ReturnType<typeof neighborTree>) {
  const result = computeAccessibilityFingerprint(tree, { ...RELAX_REF, name: 'Continue' }, []);
  if (result.kind !== 'ok') throw new Error('Changed target must remain unique.');
  return result;
}
