/**
 * Projects runtime events into MCP progress notifications.
 *
 * @param params - Tool identity, session root, notification sender, and optional event observer.
 * @returns An event sink whose flush waits for queued notifications to settle.
 * @remarks
 * Emission can enqueue asynchronous sends, so callers must await flush before
 * returning a tool response. The optional observer will let a job owner update
 * progress counters; synchronous calls do not require that extra consumer.
 */
export function createMcpProgressSink(params: {
  readonly command: 'generate' | 'run' | 'heal';
  readonly sessionRoot: string;
  readonly send: (message: string) => Promise<void>;
  readonly onEvent?: (event: unknown) => void;
}): { emit: (event: unknown) => void; flush: () => Promise<void> } {
  throw new Error('not implemented');
}
