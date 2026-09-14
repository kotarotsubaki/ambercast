import { AmbercastError } from './types.js';

/**
 * Signals that two distinct secret references would read the same host
 * environment variable.
 *
 * This is a usage failure rather than a missing-secret failure: allowing the
 * lookup to continue would make a deterministic plan silently bind the wrong
 * logical secret, even if an environment value is present.
 */
export class SecretEnvVarCollisionError extends AmbercastError {
  readonly kind = 'secret-env-var-collision' as const;
}
