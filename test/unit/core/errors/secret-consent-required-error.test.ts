import { describe, expect, it } from 'vitest';
import { ERROR_EXIT_CODES } from '#core/errors/exit-codes.js';
import { SecretConsentRequiredError } from '#core/errors/secret-consent-required-error.js';

describe('SecretConsentRequiredError', () => {
  it('preserves kind, base-class exit code, message, details, and cause', () => {
    const cause = new Error('cause'); const details = { reason: 'consent-required' as const, secrets: [] };
    const error = new SecretConsentRequiredError('Consent required.', details, { cause });
    expect(error.kind).toBe('secret-consent-required'); expect(error.exitCode).toBe(ERROR_EXIT_CODES['secret-consent-required']);
    expect(error.message).toBe('Consent required.'); expect(error.details).toBe(details); expect(error.cause).toBe(cause);
  });
});
