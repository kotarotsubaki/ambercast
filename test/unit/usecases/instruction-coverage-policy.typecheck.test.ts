import { describe, expectTypeOf, it } from 'vitest';
import type { AiResponseIssueCode } from '#report/schema.js';
import type { InstructionCoverageIssueCode } from '#usecases/instruction-coverage-policy.js';

describe('instruction-coverage-policy report vocabulary typecheck', () => {
  it('rejects an unknown producer code through the reverse tripwire', () => {
    type FabricatedCode = InstructionCoverageIssueCode | 'made-up-coverage-code';
    // @ts-expect-error The reverse tripwire requires the fabricated report-unknown code.
    const check: Record<Exclude<FabricatedCode, AiResponseIssueCode>, never> = {};
    expectTypeOf<InstructionCoverageIssueCode>().toExtend<AiResponseIssueCode>();
    void check;
  });
});
