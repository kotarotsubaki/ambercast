/**
 * Extra repetitions for timing-sensitive contract cases, from AMBERCAST_CONTRACT_REPEATS (0..50).
 *
 * @remarks
 * Vitest counts repeats as additional executions: zero still executes each case once.
 * CI leaves the variable unset and therefore executes each case once.
 * Parsing at import time makes an invalid repetition request a collection failure,
 * even when Chromium is unavailable, rather than silently reducing coverage.
 */
export const CONTRACT_REPEATS: number = parseRepeats(process.env.AMBERCAST_CONTRACT_REPEATS);

/**
 * Converts an optional repetition request into an extra-execution count.
 * Empty and absent requests select zero; ASCII digit strings, including leading
 * zeroes, are accepted only when their numeric value does not exceed fifty.
 * @param raw - The environment value without trimming or coercive normalization.
 * @returns The requested additional execution count.
 * @throws RangeError with `AMBERCAST_CONTRACT_REPEATS must be an integer from 0 to 50.`
 * for values outside the accepted grammar or range.
 */
function parseRepeats(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 0;

  const value = Number(raw);
  if (!/^\d+$/.test(raw) || value > 50) {
    throw new RangeError('AMBERCAST_CONTRACT_REPEATS must be an integer from 0 to 50.');
  }
  return value;
}
