import { describe, expectTypeOf, it } from 'vitest';
import type { AiResponseIssueCode } from '#report/schema.js';
import type { TextEqualsSelfQuoteIssueCode } from '#usecases/generate.js';
import type { SecretNamingIssueCode } from '#usecases/secret-naming.js';

describe('generate producer report vocabulary typecheck', () => {
  it('rejects an unknown self-quote producer code through the reverse tripwire', () => {
    type FabricatedCode = TextEqualsSelfQuoteIssueCode | 'made-up-self-quote-code';
    // @ts-expect-error The reverse tripwire requires the fabricated report-unknown code.
    const check: Record<Exclude<FabricatedCode, AiResponseIssueCode>, never> = {};
    expectTypeOf<TextEqualsSelfQuoteIssueCode>().toExtend<AiResponseIssueCode>();
    void check;
  });

  it('rejects an unknown secret-naming producer code through the reverse tripwire', () => {
    type FabricatedCode = SecretNamingIssueCode | 'made-up-secret-code';
    // @ts-expect-error The reverse tripwire requires the fabricated report-unknown code.
    const check: Record<Exclude<FabricatedCode, AiResponseIssueCode>, never> = {};
    expectTypeOf<SecretNamingIssueCode>().toExtend<AiResponseIssueCode>();
    void check;
  });
});
