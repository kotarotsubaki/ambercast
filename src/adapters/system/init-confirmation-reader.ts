/**
 * Provides the init-specific terminal confirmation exchange.
 *
 * It is separate from the healing reader because init has different prompt
 * wording, displays no candidate list, buffers only through the first line,
 * and writes one newline only after EOF or abort. Those observable details
 * form a distinct adapter contract rather than a variation of healing.
 */
export type InitConfirmationAnswer = 'authorized' | 'declined' | 'interrupted';

/** Reads one init confirmation answer from an injected terminal stream. */
export type InitConfirmationReader = (signal?: AbortSignal) => Promise<InitConfirmationAnswer>;

/** Supplies the streams used only by the init confirmation exchange. */
export interface InitConfirmationStreams {
  readonly stdin: Pick<NodeJS.ReadableStream, 'once' | 'removeListener' | 'pause' | 'resume'>;
  readonly stderr: Pick<NodeJS.WritableStream, 'write'>;
}

/**
 * Creates the confirmation reader used before init writes its artifacts.
 *
 * @param streams - Optional terminal streams, injected for deterministic
 * runtime tests.
 * @returns A reader that resolves the user's authorization decision.
 * @remarks
 * The reader writes `Write these files? [y/N] `, authorizes `y` and `yes`
 * case-insensitively after trimming surrounding whitespace, and declines all
 * other answers or EOF. It examines only the first input line, reports abort
 * as interrupted, and writes one newline after EOF or abort but not after a
 * normal terminal-entered line. A stdin stream error rejects the reader rather
 * than becoming a decline; runtime converts that rejection into a failed
 * command outcome.
 */
export function createInitConfirmationReader(
  streams: InitConfirmationStreams = { stdin: process.stdin, stderr: process.stderr },
): InitConfirmationReader {
  return async (signal): Promise<InitConfirmationAnswer> => {
    streams.stderr.write('Write these files? [y/N] ');
    if (signal?.aborted) {
      streams.stderr.write('\n');
      return 'interrupted';
    }

    return new Promise<InitConfirmationAnswer>((resolve, reject) => {
      let settled = false;
      let buffered = '';
      const answerFor = (value: string): InitConfirmationAnswer => {
        const answer = value.trim().toLowerCase();
        return answer === 'y' || answer === 'yes' ? 'authorized' : 'declined';
      };
      const cleanup = (): void => {
        streams.stdin.removeListener('data', onData);
        streams.stdin.removeListener('end', onEnd);
        streams.stdin.removeListener('error', onError);
        signal?.removeEventListener('abort', onAbort);
        streams.stdin.pause();
      };
      const finish = (answer: InitConfirmationAnswer, addNewline: boolean): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        if (addNewline) {
          streams.stderr.write('\n');
        }
        resolve(answer);
      };
      const onData = (chunk: Buffer | string): void => {
        buffered += chunk.toString();
        const newline = buffered.indexOf('\n');
        if (newline === -1) {
          streams.stdin.once('data', onData);
          return;
        }
        finish(answerFor(buffered.slice(0, newline)), false);
      };
      const onEnd = (): void => finish(answerFor(buffered), true);
      const onError = (error: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(error);
      };
      const onAbort = (): void => finish('interrupted', true);

      streams.stdin.once('data', onData);
      streams.stdin.once('end', onEnd);
      streams.stdin.once('error', onError);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      streams.stdin.resume();
    });
  };
}
