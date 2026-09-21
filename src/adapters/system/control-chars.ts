/**
 * Escapes C0 controls (0x00-0x1F), DEL (0x7F), and C1 controls (0x80-0x9F)
 * into display-safe visible forms. Backspace, tab, newline, form feed, and
 * carriage return use JSON's short escapes; every other affected value uses
 * a backslash, the letter u, and four lowercase hexadecimal digits.
 *
 * A literal backslash remains unescaped to favor readability over round-trip
 * safety. This display-time transform prevents untrusted filesystem-derived
 * strings from injecting terminal control sequences and never applies to
 * `--json` output.
 *
 * Only these three ranges change; everything else passes through byte-for-byte.
 */
export function escapeControlChars(value: string): string {
  let escaped = '';

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    switch (code) {
      case 0x08:
        escaped += '\\b';
        break;
      case 0x09:
        escaped += '\\t';
        break;
      case 0x0a:
        escaped += '\\n';
        break;
      case 0x0c:
        escaped += '\\f';
        break;
      case 0x0d:
        escaped += '\\r';
        break;
      default:
        if (code <= 0x1f || code === 0x7f || (code >= 0x80 && code <= 0x9f)) {
          escaped += '\\u' + code.toString(16).padStart(4, '0');
        } else {
          escaped += value[index]!;
        }
    }
  }

  return escaped;
}

/**
 * Escapes control characters in stack traces while preserving line breaks.
 *
 * Line terminators (\r\n, \r, \n) are preserved as-is; all other control
 * characters are escaped by {@link escapeControlChars}.
 */
export function escapeStackControlChars(value: string): string {
  return value.split(/(\r\n|\r|\n)/u)
    .map((part) => part === '\r\n' || part === '\r' || part === '\n' ? part : escapeControlChars(part))
    .join('');
}
