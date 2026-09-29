import { describe, expect, it } from 'vitest';
import { computeObligationFingerprint, obligationFingerprintMatches } from '#core/ir/obligation-fingerprint.js';
import { Step } from '#core/ir/schema.js';

const COVERAGE_SPAN = { startLine: 2, startColumn: 1, endLine: 2, endColumn: 24 };
const NEXT_COVERAGE_SPAN = { startLine: 3, startColumn: 1, endLine: 3, endColumn: 24 };
const INTENT = { description: 'Continue', roleHint: 'button', sourceSpan: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 9 } };
const QUOTED_INTENT = { ...INTENT, quote: { text: 'Continue', sourceSpan: INTENT.sourceSpan } };

function ai(overrides: Record<string, unknown> = {}) {
  return Step.parse({
    id: 'agent-step', kind: 'ai', target: 'app', instruction: 'Open {{run.order.id}} then {{run.order.id}}',
    secrets: [{ ref: '{{secrets.auth.token}}' }],
    instructionCoverage: [{ id: 'criterion-a', kind: 'action', sourceSpan: COVERAGE_SPAN }, { id: 'criterion-b', kind: 'success', sourceSpan: NEXT_COVERAGE_SPAN }],
    ...overrides,
  });
}

describe('obligation fingerprints', () => {
  it('matches an unchanged obligation even when ordinary executable detail changes', () => {
    const before = Step.parse({ id: 'navigate', kind: 'action', action: 'navigate', target: 'app', url: 'https://example.test/{{run.order.id}}' });
    const after = Step.parse({ id: 'navigate', kind: 'action', action: 'navigate', target: 'app', url: 'https://other.example.test/{{run.order.id}}' });

    expect(obligationFingerprintMatches(before, after)).toBe(true);
  });

  it.each([
    ['an action opcode', Step.parse({ id: 'step', kind: 'action', action: 'click', target: 'app', intent: INTENT }), Step.parse({ id: 'step', kind: 'action', action: 'press', target: 'app', intent: INTENT, key: 'Enter' })],
    ['an assert opcode', Step.parse({ id: 'assertion', kind: 'assert', check: 'text-visible', target: 'app', text: 'Continue' }), Step.parse({ id: 'assertion', kind: 'assert', check: 'text-equals', target: 'app', intent: QUOTED_INTENT, text: 'Continue' })],
    // SPEC-C1 C1-12
    ['an AI secret reference', ai(), ai({ secrets: [{ ref: '{{secrets.auth.other}}' }] })],
    ['a fill-secret reference', Step.parse({ id: 'secret', kind: 'action', action: 'fill-secret', target: 'app', intent: INTENT, secretRef: '{{secrets.auth.token}}' }), Step.parse({ id: 'secret', kind: 'action', action: 'fill-secret', target: 'app', intent: INTENT, secretRef: '{{secrets.auth.other}}' })],
    ['an instruction coverage id', ai(), ai({ instructionCoverage: [{ id: 'criterion-z', kind: 'action', sourceSpan: COVERAGE_SPAN }, { id: 'criterion-b', kind: 'success', sourceSpan: NEXT_COVERAGE_SPAN }] })],
    ['an instruction coverage kind', ai(), ai({ instructionCoverage: [{ id: 'criterion-a', kind: 'success', sourceSpan: COVERAGE_SPAN }, { id: 'criterion-b', kind: 'success', sourceSpan: NEXT_COVERAGE_SPAN }] })],
    ['an instruction coverage span', ai(), ai({ instructionCoverage: [{ id: 'criterion-a', kind: 'action', sourceSpan: NEXT_COVERAGE_SPAN }, { id: 'criterion-b', kind: 'success', sourceSpan: NEXT_COVERAGE_SPAN }] })],
    ['instruction coverage ordering', ai(), ai({ instructionCoverage: [{ id: 'criterion-b', kind: 'success', sourceSpan: NEXT_COVERAGE_SPAN }, { id: 'criterion-a', kind: 'action', sourceSpan: COVERAGE_SPAN }] })],
    ['a capture variable', Step.parse({ id: 'capture', kind: 'capture', target: 'app', intent: INTENT, variable: 'orderId' }), Step.parse({ id: 'capture', kind: 'capture', target: 'app', intent: INTENT, variable: 'otherId' })],
    ['a removed run reference', ai(), ai({ instruction: 'Open {{run.order.id}}' })],
    ['an added run reference', ai({ instruction: 'Open {{run.order.id}}' }), ai()],
    ['run reference ordering', ai({ instruction: 'Open {{run.order.id}} then {{run.user.id}}' }), ai({ instruction: 'Open {{run.user.id}} then {{run.order.id}}' })],
    ['a malformed run-reference spelling', ai({ instruction: 'Open {{run.order-id}}' }), ai({ instruction: 'Open {{run.order_id}}' })],
  ])('does not match when %s changes', (_dimension, before, after) => {
    expect(obligationFingerprintMatches(before, after)).toBe(false);
  });

  it('rejects replacement identity changes before comparing fingerprints', () => {
    const step = Step.parse({ id: 'capture', kind: 'capture', target: 'app', intent: INTENT, variable: 'orderId' });
    const renamed = Step.parse({ id: 'renamed', kind: 'capture', target: 'app', intent: INTENT, variable: 'orderId' });
    const retyped = Step.parse({ id: 'capture', kind: 'action', action: 'click', target: 'app', intent: INTENT });

    expect(obligationFingerprintMatches(step, renamed)).toBe(false);
    expect(obligationFingerprintMatches(step, retyped)).toBe(false);
  });

  it('uses a stable non-empty SHA-256 fingerprint for a valid step', () => {
    expect(computeObligationFingerprint(ai())).toMatch(/^[a-f0-9]{64}$/);
  });

  it('treats an omitted AI secrets field and an explicit empty secrets array as the same fixed-shape obligation', () => {
    const omitted = Step.parse({
      id: 'agent-step', kind: 'ai', target: 'app', instruction: 'Open {{run.order.id}} then {{run.order.id}}',
      instructionCoverage: [{ id: 'criterion-a', kind: 'action', sourceSpan: COVERAGE_SPAN }],
    });
    const explicitEmpty = Step.parse({
      id: 'agent-step', kind: 'ai', target: 'app', instruction: 'Open {{run.order.id}} then {{run.order.id}}',
      secrets: [], instructionCoverage: [{ id: 'criterion-a', kind: 'action', sourceSpan: COVERAGE_SPAN }],
    });

    expect(computeObligationFingerprint(omitted)).toBe(computeObligationFingerprint(explicitEmpty));
    expect(obligationFingerprintMatches(omitted, explicitEmpty)).toBe(true);
  });
});
