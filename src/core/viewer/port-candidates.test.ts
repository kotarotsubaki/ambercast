import { describe, expect, it } from 'vitest';
import { portCandidates } from './port-candidates.js';

describe('portCandidates', () => {
  it('offers twenty consecutive ports from the configured default', () => {
    expect(portCandidates({ configured: 4600, fallback: 4600 })).toEqual(
      Array.from({ length: 20 }, (_, index) => 4600 + index),
    );
  });

  it('caps the candidate range at the highest TCP port', () => {
    expect(portCandidates({ configured: 65530, fallback: 4600 })).toEqual([
      65530, 65531, 65532, 65533, 65534, 65535,
    ]);
  });

  it('uses only an explicitly requested port', () => {
    expect(portCandidates({ explicit: 4700, configured: 4600, fallback: 4600 })).toEqual([4700]);
  });

  it('includes port 65535 when it is the configured starting port', () => {
    expect(portCandidates({ configured: 65535, fallback: 4600 })).toEqual([65535]);
  });

  it('includes exactly twenty ports when the range ends at 65535', () => {
    expect(portCandidates({ configured: 65516, fallback: 4600 })).toEqual(
      Array.from({ length: 20 }, (_, index) => 65516 + index),
    );
  });
});
