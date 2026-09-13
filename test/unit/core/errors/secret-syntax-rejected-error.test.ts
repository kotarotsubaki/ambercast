import { describe, expect, it } from 'vitest';
import { ERROR_EXIT_CODES } from '#core/errors/exit-codes.js';
import { SecretSyntaxRejectedError } from '#core/errors/secret-syntax-rejected-error.js';

describe('SecretSyntaxRejectedError', () => {
  it('preserves kind, base-class exit code, message, details, and cause', () => {
    const cause = new Error('cause'); const details = { occurrences: [{ kind: 'reference' as const, line: 1, column: 1 }] };
    const error = new SecretSyntaxRejectedError('Legacy syntax.', details, { cause });
    expect(error.kind).toBe('secret-syntax-rejected'); expect(error.exitCode).toBe(ERROR_EXIT_CODES['secret-syntax-rejected']);
    expect(error.message).toBe('Legacy syntax.'); expect(error.details).toBe(details); expect(error.cause).toBe(cause);
  });
});
