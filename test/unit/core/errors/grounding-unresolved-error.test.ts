import { describe, expect, expectTypeOf, it } from 'vitest';
import { ERROR_EXIT_CODES } from '#core/errors/exit-codes.js';
import {
  GroundingUnresolvedError,
  type GroundingUnresolvedReason,
} from '#core/errors/grounding-unresolved-error.js';

describe('GroundingUnresolvedError', () => {
  it('has the fixed classification and fail-closed exit status', () => {
    const error = new GroundingUnresolvedError('Grounding is unavailable.', { stepId: 'sign-in', reason: 'missing' });

    expect(error).toBeInstanceOf(Error);
    expect(error.kind).toBe('grounding-unresolved');
    expect(error.exitCode).toBe(ERROR_EXIT_CODES['grounding-unresolved']);
    expect(error.exitCode).toBe(4);
  });

  it('retains both required typed details and an optional cause', () => {
    const cause = new Error('cache miss');
    const error = new GroundingUnresolvedError('Grounding is unavailable.', {
      stepId: 'sign-in', reason: 'recoverable-miss',
    }, { cause });

    expect(error.details).toEqual({ stepId: 'sign-in', reason: 'recoverable-miss' });
    expect(error.cause).toBe(cause);
  });

  it('exposes only the two specified reason literals', () => {
    expectTypeOf<GroundingUnresolvedReason>().toEqualTypeOf<'missing' | 'recoverable-miss'>();
  });
});
