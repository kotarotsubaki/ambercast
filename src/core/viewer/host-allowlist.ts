/*
 * Applies the viewer's Host allowlist before routing every HTTP request.
 * This limits DNS rebinding exposure but does not authenticate callers.
 */

/**
 * Checks whether a request Host names an allowed address at the bound port.
 *
 * @param headerValue - The incoming Host header, if present.
 * @param bound - The literal bind host and the actual port returned by listen.
 * @returns Whether the header may proceed to method and route handling.
 * @remarks
 * Parsing as a URL keeps IPv6 authority syntax and optional ports together.
 * Missing or malformed headers fail closed; hostname comparison permits the
 * local aliases and the bound literal after case and trailing-dot normalization.
 * IPv6 literal brackets are stripped for comparison (e.g., [::1] becomes ::1).
 * An explicit port must match the actual listen port, including when the
 * server was assigned a port dynamically.
 */
export function isAllowedHost(
  headerValue: string | undefined,
  bound: { readonly bindHost: string; readonly port: number },
): boolean {
  try {
    if (!headerValue || headerValue.trim() === '') {
      return false;
    }
    const url = new URL('http://' + headerValue);
    const hostname = url.hostname.toLowerCase();
    // URL constructor returns brackets for IPv6 literals, strip them
    const hostnameNoBrackets = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;
    const normalizedHostname = hostnameNoBrackets.endsWith('.') ? hostnameNoBrackets.slice(0, -1) : hostnameNoBrackets;

    // Allowed hostnames: localhost, 127.0.0.1, ::1 (IPv6), or bound host
    // bound.bindHost may have brackets for IPv6, strip them for comparison; then
    // canonicalize through the URL parser so a non-canonical IPv6 literal (e.g.
    // 2001:DB8::1) still matches the lowercased, zero-compressed form the WHATWG
    // URL parser produces from the incoming Host header.
    const rawBoundHost = bound.bindHost.startsWith('[') ? bound.bindHost.slice(1, -1) : bound.bindHost;
    const boundHostNormalized = rawBoundHost.includes(':')
      ? new URL(`http://[${rawBoundHost}]`).hostname.slice(1, -1)
      : rawBoundHost;
    if (
      normalizedHostname !== 'localhost' &&
      normalizedHostname !== '127.0.0.1' &&
      normalizedHostname !== '::1' &&
      normalizedHostname !== boundHostNormalized
    ) {
      return false;
    }

    // If port is explicitly specified, it must match bound.port
    if (url.port !== '' && Number(url.port) !== bound.port) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}
