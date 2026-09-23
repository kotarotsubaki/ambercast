/**
 * Projects runtime events into MCP progress notifications.
 *
 * @param params - Tool identity, session root, notification sender, and optional event observer.
 * @returns An event sink whose flush waits for queued notifications to settle.
 * @remarks
 * Emission can enqueue asynchronous sends, so callers must await flush before
 * returning a tool response. The optional observer will let a job owner update
 * progress counters; synchronous calls do not require that extra consumer.
 * emit projects each RunEvent into a fixed message and queues it, except that
 * unclassified-rejection is never sent. flush passes unsent notifications to
 * send in order and resolves after attempting all of them. A failed send is
 * discarded without propagating its exception, and later sends are still
 * attempted; send success does not determine whether flush resolves. onEvent
 * runs on every emit regardless of notification delivery and can update job
 * progress counters independently of sending.
 */
export function createMcpProgressSink(params: {
  readonly command: 'generate' | 'run' | 'heal';
  readonly sessionRoot: string;
  readonly send: (message: string) => Promise<void>;
  readonly onEvent?: (event: unknown) => void;
}): { emit: (event: unknown) => void; flush: () => Promise<void> } {
  throw new Error('not implemented');
}
