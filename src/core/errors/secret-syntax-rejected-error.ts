import { AmbercastError } from './types.js';

/**
 * Signals that source Markdown still contains a legacy secret directive or
 * reference spelling.
 *
 * Keeping source-syntax rejection separate from Plan IR validation lets run
 * and heal fail at the normalized prompt boundary, before an unrelated target
 * or committed-artifact problem can obscure the required migration.
 */
export class SecretSyntaxRejectedError extends AmbercastError {
  readonly kind = 'secret-syntax-rejected' as const;
}
