// CLI may import only runtime, so this facade is the required crossing point for the adapter's character-escaping helpers.
export { escapeControlChars, escapeStackControlChars } from '#adapters/system/control-chars.js';
