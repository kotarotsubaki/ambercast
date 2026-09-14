import { describe, expect, it } from 'vitest';
import { FinalOutcome, parseFinalOutcome } from '#adapters/ai/agentic/final-outcome.js';

describe('parseFinalOutcome', () => {
  it.each(['success', 'failure'] as const)('accepts the valid %s outcome', (outcome) => {
    expect(parseFinalOutcome(JSON.stringify({ outcome }))).toStrictEqual({ outcome });
  });

  it('rejects a missing outcome field', () => {
    expect(() => parseFinalOutcome('{}')).toThrow();
  });

  it('rejects an unknown field under the strict final-outcome schema', () => {
    expect(() => parseFinalOutcome('{"outcome":"success","metadata":"ignored"}')).toThrow();
    expect(FinalOutcome.safeParse({ outcome: 'success', metadata: 'ignored' }).success).toBe(false);
  });

  it('rejects malformed JSON', () => {
    expect(() => parseFinalOutcome('{ not valid JSON')).toThrow();
  });
});
