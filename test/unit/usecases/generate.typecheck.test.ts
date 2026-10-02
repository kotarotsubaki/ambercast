import { describe, expectTypeOf, it } from 'vitest';
import type { AiResponseIssueCode } from '#report/schema.js';

describe('generate producer report vocabulary typecheck', () => {
  it('rejects an unknown self-quote producer code through the reverse tripwire', () => {
    type FabricatedCode = Extract<AiResponseIssueCode, 'text-equals-self-quote'> | 'made-up-self-quote-code';
    // @ts-expect-error The reverse tripwire requires the fabricated report-unknown code.
    const check: Record<Exclude<FabricatedCode, AiResponseIssueCode>, never> = {};
    expectTypeOf<Extract<AiResponseIssueCode, 'text-equals-self-quote'>>().toEqualTypeOf<'text-equals-self-quote'>();
    void check;
  });

  it('rejects an unknown secret-naming producer code through the reverse tripwire', () => {
    type SecretCode = Extract<AiResponseIssueCode, 'secret-allowed-name-not-projected' | 'secret-conflicting-target-names'>;
    type FabricatedCode = SecretCode | 'made-up-secret-code';
    // @ts-expect-error The reverse tripwire requires the fabricated report-unknown code.
    const check: Record<Exclude<FabricatedCode, AiResponseIssueCode>, never> = {};
    expectTypeOf<SecretCode>().toEqualTypeOf<'secret-allowed-name-not-projected' | 'secret-conflicting-target-names'>();
    void check;
  });
});
