import type { Clock, EventSink } from '#ports/system.js';
import { relativeWithinOrOriginal } from '#core/paths.js';
import { escapeControlChars, escapeStackControlChars } from '#adapters/system/control-chars.js';
import { readDebugEnvironment } from '#adapters/system/process-debug-environment.js';

const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Writes human-readable provider progress to the command's injected stderr.
 *
 * @param params - Command identity, output stream, path basis, CI policy, and
 * monotonic clock selected by runtime composition.
 * @returns An event sink whose close method releases all outstanding timers.
 *
 * @remarks
 * The adapter keeps timer ownership private and never lets stream, clock, or
 * timer failures interrupt a use case. It emits a start line for each AI call,
 * adds non-CI heartbeats per call ID, and removes that timer on the
 * matching result or on close. `check` deliberately does not construct this
 * adapter because freshness inspection has no AI or event dependency.
 */
export function createStderrProgressSink(params: {
  readonly command: 'generate' | 'run' | 'heal';
  readonly stderr: NodeJS.WritableStream;
  readonly projectRoot: string;
  readonly isCI: boolean;
  readonly clock: Clock;
}): EventSink & { readonly close: () => void } {
  const timers = new Map<string, ReturnType<typeof setInterval>>();

  const clearCall = (callId: string): void => {
    const timer = timers.get(callId);
    if (timer !== undefined) clearInterval(timer);
    timers.delete(callId);
  };

  const close = (): void => {
    for (const timer of timers.values()) clearInterval(timer);
    timers.clear();
  };

  return {
    emit(event): void {
      try {
        if (event.type === 'unclassified-rejection') {
          emitUnclassifiedRejection(params.stderr, event);
          return;
        }
        if (event.type === 'ai-result') {
          clearCall(event.callId);
          return;
        }
        if (event.type !== 'ai-call') return;

        const path = escapeControlChars(relativeWithinOrOriginal(params.projectRoot, event.file));
        const step = params.command === 'generate' || event.stepId === undefined ? '' : ` [${event.stepId}]`;
        const prefix = `${params.command} ${path}${step}: ai call ${event.attempt}/${event.attemptLimit}`;
        params.stderr.write(`${prefix}\n`);

        clearCall(event.callId);
        if (params.isCI) return;
        const startedMs = params.clock.monotonicMs();
        const timer = setInterval(() => {
          try {
            const elapsedSeconds = Math.floor((params.clock.monotonicMs() - startedMs) / 1_000);
            params.stderr.write(`${prefix}: still waiting (${elapsedSeconds}s)\n`);
          } catch {
            // Progress failures must never interrupt the provider dispatch.
          }
        }, HEARTBEAT_INTERVAL_MS);
        timers.set(event.callId, timer);
      } catch {
        // Progress failures must never interrupt the use case emitting them.
      }
    },
    close,
  };
}

/**
 * Renders an unclassified case failure only when debug diagnostics are enabled.
 *
 * Reading the debug environment at emission time keeps the progress sink a
 * passive event consumer and never changes report or JSON output. The renderer
 * escapes message and stack control characters before writing because
 * diagnostics can originate in hostile browser or provider values.
 */
function emitUnclassifiedRejection(
  stderr: NodeJS.WritableStream,
  event: Extract<Parameters<EventSink['emit']>[0], { readonly type: 'unclassified-rejection' }>,
): void {
  if (!readDebugEnvironment()) return;
  const step = event.stepId === undefined ? '' : ` ${event.stepId}`;
  const stack = event.stack === undefined ? '' : `${escapeStackControlChars(event.stack)}\n`;
  stderr.write(`unclassified rejection in ${escapeControlChars(event.file)}${step}: ${event.name}: ${escapeControlChars(event.message)}\n${stack}`);
}
