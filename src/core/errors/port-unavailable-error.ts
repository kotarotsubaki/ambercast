/*
 * Provides the classified execution failure when the view command cannot
 * bind to a candidate port. This expected environment failure has its own
 * classification so callers need not report a busy port as an unexpected crash.
 */

import { AmbercastError } from './types.js';

/**
 * Reports that the viewer could not bind its requested host and port range.
 *
 * @remarks
 * The caller chooses the diagnostic for an exhausted range, a strict busy
 * port, or another bind error and supplies host, attempted ports, and optional
 * system error code as context. The fixed kind selects exit status 3 through
 * the shared error mapping without changing report error codes.
 */
export class PortUnavailableError extends AmbercastError {
  readonly kind = 'port-unavailable' as const;
}
