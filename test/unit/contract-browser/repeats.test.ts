import { afterEach, describe, expect, it, vi } from 'vitest';

describe('contract repetition requests', () => {
  // Import-time validation requires an isolated environment and module cache for
  // each row, so an earlier import cannot decide a later request's result.
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each([
    // Missing and empty requests preserve the single execution used by CI.
    { raw: undefined, expected: 0 },
    { raw: '', expected: 0 },
    // Leading zeroes are valid ASCII digits, not an alternate numeric grammar.
    { raw: '0', expected: 0 },
    { raw: '00', expected: 0 },
    { raw: '10', expected: 10 },
    { raw: '007', expected: 7 },
    // The boundary and long zero prefixes constrain numeric value without an
    // unspecified textual length limit.
    { raw: '50', expected: 50 },
    { raw: '0'.repeat(1000) + '5', expected: 5 },
  ])('TEST-12 accepts $raw as $expected additional executions', async ({ raw, expected }) => {
    vi.stubEnv('AMBERCAST_CONTRACT_REPEATS', raw);
    vi.resetModules();
    const { CONTRACT_REPEATS } = await import('../../contract-browser/support/repeats.js');
    expect(CONTRACT_REPEATS).toBe(expected);
  });

  it.each([
    // Reject JavaScript's broader numeric conversion grammar.
    { raw: '51' }, { raw: '1e1' }, { raw: '-1' }, { raw: '+5' },
    { raw: '1.5' }, { raw: 'abc' },
    // Whitespace is not trimmed, including a final newline.
    { raw: ' ' }, { raw: ' 3' }, { raw: '5\n' },
    // Visually numeric Unicode input is outside the ASCII digit contract.
    { raw: '１' }, { raw: '٣' },
  ])('TEST-12 rejects $raw during module import', async ({ raw }) => {
    vi.stubEnv('AMBERCAST_CONTRACT_REPEATS', raw);
    vi.resetModules();
    await expect(import('../../contract-browser/support/repeats.js')).rejects.toThrow(RangeError);
  });
});
