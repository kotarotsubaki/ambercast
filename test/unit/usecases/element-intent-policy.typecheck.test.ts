import { describe, expectTypeOf, it } from 'vitest';
import type { AiResponseIssueCode } from '#report/schema.js';
import type { ElementIntentIssueCode } from '#usecases/element-intent-policy.js';

describe('element-intent-policy report vocabulary typecheck', () => {
  it('rejects an unknown producer code through the reverse tripwire', () => {
    type FabricatedCode = ElementIntentIssueCode | 'made-up-intent-code';
    // @ts-expect-error The reverse tripwire requires the fabricated report-unknown code.
    const check: Record<Exclude<FabricatedCode, AiResponseIssueCode>, never> = {};
    expectTypeOf<ElementIntentIssueCode>().toExtend<AiResponseIssueCode>();
    void check;
  });
});
