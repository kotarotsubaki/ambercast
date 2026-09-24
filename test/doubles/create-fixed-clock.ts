import type { Clock } from '../../src/ports/system.js';

/**
 * Creates a stable clock for scenarios that must not observe host time.
 *
 * The supplied instant is stored as milliseconds and copied on every read so
 * a test cannot mutate one returned `Date` and change later observations.
 *
 * @param now - Wall-clock instant supplied by the scenario.
 * @param monotonicMs - Stable elapsed-time reading supplied by the scenario.
 * @returns A clock with independently repeatable values.
 */
export function createFixedClock(now: Date, monotonicMs: number): Clock & { readonly sleepCalls: number[] } {
  const timestamp = now.getTime();
  const sleepCalls: number[] = [];
  let elapsed = monotonicMs;

  return {
    sleepCalls,
    now(): Date {
      return new Date(timestamp);
    },
    monotonicMs(): number {
      return elapsed;
    },
    async sleep(ms: number, signal?: AbortSignal): Promise<void> {
      sleepCalls.push(ms);
      if (signal?.aborted) throw signal.reason;
      elapsed += ms;
      await Promise.resolve();
      if (signal?.aborted) throw signal.reason;
    },
  };
}
