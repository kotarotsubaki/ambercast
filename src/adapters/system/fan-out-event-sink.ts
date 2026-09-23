import type { EventSink, RunEvent } from '#ports/system.js';

export function createFanOutEventSink(sinks: readonly EventSink[]): EventSink {
  throw new Error('not implemented');
}
