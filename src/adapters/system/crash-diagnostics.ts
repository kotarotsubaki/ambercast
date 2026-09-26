import { escapeControlChars, escapeStackControlChars } from './control-chars.js';
import { readDebugEnvironment } from './process-debug-environment.js';

/**
 * Shares the CLI's crash cause output with MCP job and heal-apply crashes.
 * When readDebugEnvironment() is false, this writes nothing. Message and
 * stack reads must fail independently without replacing the original crash;
 * escapeControlChars and escapeStackControlChars keep diagnostic text from
 * injecting terminal controls while preserving stack line breaks.
 */
export function writeDebugCause(stderr: NodeJS.WritableStream, cause: unknown): void {
  if (!readDebugEnvironment()) {
    return;
  }
  try {
    const message = cause !== null && typeof cause === 'object' ? (cause as { message?: unknown }).message : undefined;
    if (typeof message === 'string') {
      stderr.write(`cause message: ${escapeControlChars(message)}\n`);
    }
  } catch {
    /* Reading message failed; skip it. */
  }
  try {
    const stack = cause !== null && typeof cause === 'object' ? (cause as { stack?: unknown }).stack : undefined;
    if (typeof stack === 'string') {
      stderr.write(`cause stack:\n${escapeStackControlChars(stack)}\n`);
    }
  } catch {
    /* Reading stack failed; skip it. */
  }
}
