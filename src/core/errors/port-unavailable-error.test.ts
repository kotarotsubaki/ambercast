import { describe, expect, it } from 'vitest';
import { PortUnavailableError } from './port-unavailable-error.js';

describe('PortUnavailableError', () => {
  it('uses the port-unavailable classification and exit code', () => {
    const error = new PortUnavailableError('msg', { host: '127.0.0.1', attempted: [4600, 4601] });

    expect(error.kind).toBe('port-unavailable');
    expect(error.exitCode).toBe(3);
  });

  it('retains the supplied context', () => {
    const details = { host: '127.0.0.1', attempted: [4600, 4601] };
    const error = new PortUnavailableError('msg', details);

    expect(error.details).toEqual(details);
  });
});
