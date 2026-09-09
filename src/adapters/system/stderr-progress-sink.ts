import type { Clock, EventSink } from '#ports/system.js';
import { relativeWithinOrOriginal } from '#core/paths.js';

const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Escapes terminal control characters without changing ordinary path bytes.
 *
 * The progress sink mirrors the CLI renderer's display-only policy locally
 * because adapters cannot depend on the CLI layer. Backslashes remain
 * readable, while C0, DEL, and C1 controls cannot inject terminal behavior.
 */
function escapeControlChars(value: string): string {
  let escaped = '';
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    switch (code) {
      case 0x08: escaped += '\\b'; break;
      case 0x09: escaped += '\\t'; break;
      case 0x0a: escaped += '\\n'; break;
      case 0x0c: escaped += '\\f'; break;
      case 0x0d: escaped += '\\r'; break;
      default:
        escaped += code <= 0x1f || code === 0x7f || (code >= 0x80 && code <= 0x9f)
          ? `\\u${code.toString(16).padStart(4, '0')}`
          : value[index]!;
    }
  }
  return escaped;
}

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
