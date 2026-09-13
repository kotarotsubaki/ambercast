import { describe, expect, it } from 'vitest';
import { ERROR_EXIT_CODES } from '#core/errors/exit-codes.js';
import { SecretEnvVarCollisionError } from '#core/errors/secret-env-var-collision-error.js';

describe('SecretEnvVarCollisionError', () => {
  it('preserves kind, base-class exit code, message, details, and cause', () => {
    const cause = new Error('cause'); const details = { envVar: 'AMBERCAST_SECRET_A_B', refs: ['{{secrets.a.b}}', '{{secrets.a_b}}'] };
    const error = new SecretEnvVarCollisionError('Collision.', details, { cause });
    expect(error.kind).toBe('secret-env-var-collision'); expect(error.exitCode).toBe(ERROR_EXIT_CODES['secret-env-var-collision']);
    expect(error.message).toBe('Collision.'); expect(error.details).toBe(details); expect(error.cause).toBe(cause);
  });
});
