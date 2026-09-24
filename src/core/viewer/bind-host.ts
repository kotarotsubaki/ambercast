/*
 * Normalizes the address before binding so URL display, warning policy, and
 * Host checks can share the address that the server actually uses.
 */

/**
 * Validates a requested bind address without performing DNS resolution.
 *
 * @param value - The optional CLI host; omission selects the loopback default.
 * @param isIP - The injected system IP classifier.
 * @returns A concrete IPv4 or IPv6 bind address and family, or a classified
 *   wildcard or invalid-input result for the command boundary to report.
 * @remarks
 * Validation accepts IP literals and localhost only, maps localhost to IPv4 loopback before listen, and rejects wildcard addresses because this unauthenticated viewer must use a specific bind address.
 */
export function normalizeBindHost(
  value: string | undefined,
  isIP: (value: string) => 0 | 4 | 6,
): { readonly host: string; readonly family: 4 | 6 } | { readonly error: 'wildcard' | 'invalid' } {
  if (value === undefined) {
    return { host: '127.0.0.1', family: 4 };
  }

  if (value === '0.0.0.0' || value === '::' || value === '[::]') {
    return { error: 'wildcard' };
  }

  if (value === 'localhost') {
    return { host: '127.0.0.1', family: 4 };
  }

  const family = isIP(value);
  if (family === 4 || family === 6) {
    return { host: value, family };
  }

  return { error: 'invalid' };
}
