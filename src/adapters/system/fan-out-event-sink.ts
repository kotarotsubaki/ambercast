import type { EventSink, RunEvent } from '#ports/system.js';

/**
 * Combines ordered event subscribers into one usecase-facing sink.
 *
 * @param sinks - Subscribers in delivery order, typically stderr progress
 * first and an optional caller-provided observer second.
 * @returns A sink that offers each event to every subscriber in that order.
 * @remarks
 * A single port keeps usecase composition independent of whether the caller
 * requested another observer. Each subscriber's synchronous failure is
 * isolated: delivery continues to later subscribers, and observer failures
 * cannot abort the use case. Progress is ancillary to the measured operation,
 * so losing one notification must not suppress the others or its result.
 *
 * The fan-out has no timer or other resource of its own and does not forward
 * `close` to its subscribers. Runtime closes its stderr progress sink
 * directly; the caller retains ownership of any injected sink and decides
 * when to close it. This avoids transferring an adapter's lifecycle to a
 * runtime command invocation.
 */
export function createFanOutEventSink(sinks: readonly EventSink[]): EventSink {
  throw new Error('not implemented');
}
