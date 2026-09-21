import { describe, expect, it } from 'vitest';
import { buildUnclassifiedRejectionEvent } from '#usecases/run.js';

const secretRef = '{{secrets.password}}';
const secretValue = 'UNCLASSIFIED_EVENT_SECRET_VALUE';
const secrets = new Map([[secretRef, new Set([secretValue])]]);

describe('buildUnclassifiedRejectionEvent', () => {
  it('writes the current step identity and redacts message and stack values', () => {
    const error = new Error(`browser failed with ${secretValue}`);
    error.stack = `Error: browser failed with ${secretValue}\n    at test`;

    expect(buildUnclassifiedRejectionEvent(
      'login.test.md', { id: 'submit-login' } as never, error, secrets, new Map(),
    )).toStrictEqual({
      type: 'unclassified-rejection', file: 'login.test.md', stepId: 'submit-login', name: 'Error',
      message: `browser failed with ${secretRef}`,
      stack: `Error: browser failed with ${secretRef}\n    at test`,
    });
  });

  it('omits stepId before the execution loop and safely handles hostile diagnostics', () => {
    const hostile = Object.create(null, {
      message: { get() { throw new Error('hostile getter'); } },
      stack: { value: `stack ${secretValue}` },
    });

    const event = buildUnclassifiedRejectionEvent('login.test.md', undefined, hostile, secrets, new Map());

    expect(event).toMatchObject({
      type: 'unclassified-rejection', file: 'login.test.md', name: 'Error', message: 'unavailable', stack: `stack ${secretRef}`,
    });
    expect(event).not.toHaveProperty('stepId');
  });
});
