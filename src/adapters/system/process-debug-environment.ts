/*
 * Reads the debug flag at the designated real system-adapter boundary.
 *
 * This adapter path is the deliberate ESLint exemption for direct
 * `process.env` access to this CLI-presentation setting.
 */

/**
 * Reports whether crash diagnostics are enabled for the current process.
 *
 * @remarks
 * `AMBERCAST_DEBUG` is inactive when it is `undefined`, `''`, `'0'`, or
 * `'false'`. Every other value, including `'FALSE'`, whitespace-only values,
 * and other nonempty strings is active.
 */
export function readDebugEnvironment(): boolean {
  const debug = process.env.AMBERCAST_DEBUG;
  return debug !== undefined && debug !== '' && debug !== '0' && debug !== 'false';
}
