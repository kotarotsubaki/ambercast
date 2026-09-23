import { describe, expect, it } from 'vitest';
import { normalizeBindHost } from './bind-host.js';

const isIP = (value: string): 0 | 4 | 6 => {
  if (['127.0.0.1', '0.0.0.0', '192.0.2.10'].includes(value)) return 4;
  if (['::', '::1'].includes(value)) return 6;
  return 0;
};

describe('normalizeBindHost', () => {
  it.each([
    [undefined, { host: '127.0.0.1', family: 4 }],
    ['localhost', { host: '127.0.0.1', family: 4 }],
    ['192.0.2.10', { host: '192.0.2.10', family: 4 }],
    ['::1', { host: '::1', family: 6 }],
    ['0.0.0.0', { error: 'wildcard' }],
    ['::', { error: 'wildcard' }],
    ['[::]', { error: 'wildcard' }],
    ['example.com', { error: 'invalid' }],
    ['127.0.0.1:80', { error: 'invalid' }],
  ] as const)('classifies host %s', (value, expected) => {
    expect(normalizeBindHost(value, isIP)).toEqual(expected);
  });
});
