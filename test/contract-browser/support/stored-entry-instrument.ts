import type { ElementRef } from '#core/ir/schema.js';
import type { GroundedResolution, GroundingQuery, UiExecutor } from '#ports/browser.js';

/** One stored-entry (`mode: 'verify'`) verification as the session saw it. */
export interface VerifyLogEntry {
  /** Accessible name of the locator, which identifies the step in these scenarios. */
  readonly name: string;
  /** `hit`, a miss reason, `throw` when the port rejected, or `replayed:<reason>` for a remembered miss. */
  readonly outcome: string;
}

/** Selects which mutation or observation the wrapped executor applies. */
export interface InstrumentOptions {
  /** Replace `awaitElementPresence` with an immediate no-op (the #381 wait). */
  readonly dropPresenceWait?: boolean;
  /**
   * Remember the first miss a stored-entry verification returns for a locator and
   * return it for every later verification of that locator without looking at the
   * browser. This removes the product's ability to obtain a fresh verification
   * result; it does not reimplement the product's repetition.
   */
  readonly stickyFirstMiss?: boolean;
  /**
   * Replace only the first stored-entry verification of each locator with
   * `snapshot-invalid`; later verifications go to the browser. A real Chromium
   * cannot be made to emit an invalid observation at a chosen moment.
   */
  readonly invalidFirstVerify?: boolean;
  /** Receives every stored-entry verification, in call order. */
  readonly log?: VerifyLogEntry[];
}

function nameOf(ref: ElementRef): string {
  return 'name' in ref && typeof ref.name === 'string' ? ref.name : JSON.stringify(ref);
}

/**
 * Wraps an executor's sessions in a Proxy that applies the selected mutations.
 * @remarks Other members are bound to the original session so private fields keep
 * working. Only verify-mode calls are intercepted; compute-mode calls pass through.
 */
export function instrumentExecutor(executor: UiExecutor, options: InstrumentOptions = {}): UiExecutor {
  return {
    kind: executor.kind, surface: executor.surface, capabilities: executor.capabilities,
    async launch(target) {
      const session = await executor.launch(target);
      const stuck = new Map<string, GroundedResolution>();
      const seen = new Set<string>();
      return new Proxy(session, {
        get(original, property) {
          if (property === 'awaitElementPresence' && options.dropPresenceWait === true) return async () => undefined;
          if (property === 'resolveGrounded') {
            return async (ref: ElementRef, query: GroundingQuery): Promise<GroundedResolution> => {
              if (query.mode !== 'verify') return original.resolveGrounded(ref, query);
              const key = JSON.stringify(ref);
              const name = nameOf(ref);
              const remembered = stuck.get(key);
              if (options.stickyFirstMiss === true && remembered !== undefined) {
                options.log?.push({ name, outcome: `replayed:${remembered.kind === 'miss' ? remembered.reason : remembered.kind}` });
                return remembered;
              }
              if (options.invalidFirstVerify === true && !seen.has(key)) {
                seen.add(key);
                options.log?.push({ name, outcome: 'snapshot-invalid' });
                return { kind: 'miss', reason: 'snapshot-invalid' };
              }
              let result: GroundedResolution;
              try {
                result = await original.resolveGrounded(ref, query);              } catch (error) {
                options.log?.push({ name, outcome: 'throw' });
                throw error;
              }
              options.log?.push({ name, outcome: result.kind === 'hit' ? 'hit' : result.reason });
              if (options.stickyFirstMiss === true && result.kind === 'miss') stuck.set(key, result);
              return result;
            };
          }
          const value = Reflect.get(original, property, original);
          return typeof value === 'function' ? value.bind(original) : value;
        },
      });
    },
  };
}
