import { describe, expect, it } from 'vitest';
import { isAllowedHost } from './host-allowlist.js';

describe('isAllowedHost', () => {
  const bound = { bindHost: '192.0.2.10', port: 4600 } as const;

  it.each([
    undefined,
    '',
    'evil.example',
    '127.0.0.1:9',
    'localhost.evil',
    'localhost/evil',
    'localhost?x',
    'localhost#f',
    'localhost:4600@evil.example',
    'local host',
    'localhost:',
    '127.0.0.1:80',
    'localhost:80',
    '203.0.113.5:4600',
  ])('rejects Host %s', (host) => {
    expect(isAllowedHost(host, bound)).toBe(false);
  });

  it.each([
    'localhost',
    'LOCALHOST.',
    'LOCALHOST.:4600',
    '127.0.0.1',
    '127.0.0.1:4600',
    '[::1]:4600',
    '192.0.2.10',
  ])('accepts Host %s', (host) => {
    expect(isAllowedHost(host, bound)).toBe(true);
  });

  it('matches an IPv6 bound host as a bracketed authority', () => {
    expect(isAllowedHost('[2001:db8::1]:4600', { bindHost: '2001:db8::1', port: 4600 })).toBe(true);
  });

  it('rejects an explicit mismatched port for an IPv6 bound host', () => {
    expect(isAllowedHost('[::1]:80', { bindHost: '::1', port: 4600 })).toBe(false);
  });
});
