import type { BrowserSession, UiExecutor } from '#ports/browser.js';
import type { ResolvedTargetConfigEntry } from '#core/config/schema.js';
import type { TargetDefinition } from '#core/ir/schema.js';

/**
 * Manages per-target browser sessions with lazy launch and collective close.
 *
 * @remarks
 * The pool holds sessions keyed by target name, launching on first acquire
 * and closing all on demand. This enables target-isolated execution while
 * avoiding unnecessary browser startup when a target is never referenced.
 * A failed launch leaves that Target not-opened because no session was
 * returned. Reporting still includes every Plan Target, including one whose
 * first step was never reached. Each acquired session is closed independently
 * in name order; close rejection changes its state, not the case outcome.
 */
export interface SessionPool {
  /**
   * Acquires a browser session for the named target, launching lazily if needed.
   *
   * @param name - The target name whose session to acquire.
   * @returns The session for that target.
   * @throws If the target is not configured or launch fails.
   */
  acquire(name: string): Promise<BrowserSession>;

  /**
   * Closes acquired sessions and returns their close results.
   *
   * @remarks
   * Sessions are closed in target-name ascending order. Each close attempt
   * is guarded by try/catch so a single failure does not prevent others.
   * Only sessions returned by launch appear here; states() combines these
   * results with 'not-opened' entries for the other Plan Targets.
   *
   * @returns Acquired target names mapped to 'closed' or 'close-failed'.
   */
  closeAll(): Promise<Record<string, 'closed' | 'close-failed'>>;

  /**
   * Returns the final session state for every Plan Target name.
   *
   * @remarks
   * A Target whose first referencing step was not reached, or whose launch
   * failed before returning a session, is 'not-opened'. Acquired sessions are
   * 'closed' after a successful close or 'close-failed' after a rejected close.
   * This is the Plan-wide state record: closeAll() supplies only the acquired
   * sessions' close results, while this record also includes unacquired Targets.
   *
   * @returns Every Plan Target name mapped to its final session state.
   */
  states(): Record<string, 'not-opened' | 'closed' | 'close-failed'>;
}

/**
 * Owns lazy browser sessions and records every acquired session's close outcome.
 *
 * @remarks
 * Each session launches from its Target's pre-resolved `UiExecutor` instance;
 * preflight resolves every instance once before this pool exists.
 */
export function createSessionPool(
  targets: Readonly<Record<string, { readonly definition: TargetDefinition; readonly config: ResolvedTargetConfigEntry }>>,
  executors: Readonly<Record<string, UiExecutor>>,
): SessionPool {
  const sessions = new Map<string, BrowserSession>();
  const closeResults: Record<string, 'closed' | 'close-failed'> = {};
  return {
    async acquire(name) {
      const existing = sessions.get(name);
      if (existing !== undefined) return existing;
      const target = targets[name];
      if (target === undefined) throw new Error(`Unknown target: ${name}`);
      const session = await executors[name]!.launch(target.definition);
      sessions.set(name, session);
      return session;
    },
    async closeAll() {
      for (const name of [...sessions.keys()].sort()) {
        try {
          await sessions.get(name)!.close();
          closeResults[name] = 'closed';
        } catch {
          closeResults[name] = 'close-failed';
        }
      }
      return { ...closeResults };
    },
    states() {
      return Object.fromEntries(Object.keys(targets).sort().map((name) => [name, closeResults[name] ?? 'not-opened']));
    },
  };
}
