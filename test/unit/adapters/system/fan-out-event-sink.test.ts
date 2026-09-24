import { describe, expect, it, vi } from 'vitest';
import { createFanOutEventSink } from '../../../../src/adapters/system/fan-out-event-sink.js';
import type { EventSink, RunEvent } from '../../../../src/ports/system.js';

describe('createFanOutEventSink', () => {
  const firstEvent: RunEvent = { type: 'step-start', stepId: 'open-page' };
  const secondEvent: RunEvent = { type: 'step-result', stepId: 'open-page', via: 'grounding' };

  it('offers the same event to every sink in subscriber order', () => {
    const deliveryOrder: string[] = [];
    const first: EventSink = { emit: vi.fn(() => { deliveryOrder.push('first'); }) };
    const second: EventSink = { emit: vi.fn(() => { deliveryOrder.push('second'); }) };
    const third: EventSink = { emit: vi.fn(() => { deliveryOrder.push('third'); }) };

    createFanOutEventSink([first, second, third]).emit(firstEvent);

    expect(deliveryOrder).toEqual(['first', 'second', 'third']);
    expect(first.emit).toHaveBeenCalledExactlyOnceWith(firstEvent);
    expect(second.emit).toHaveBeenCalledExactlyOnceWith(firstEvent);
    expect(third.emit).toHaveBeenCalledExactlyOnceWith(firstEvent);
    expect(vi.mocked(first.emit).mock.calls[0]?.[0]).toBe(firstEvent);
    expect(vi.mocked(second.emit).mock.calls[0]?.[0]).toBe(firstEvent);
    expect(vi.mocked(third.emit).mock.calls[0]?.[0]).toBe(firstEvent);
  });

  it('delivers consecutive events to each sink in emission order', () => {
    const first: EventSink = { emit: vi.fn() };
    const second: EventSink = { emit: vi.fn() };
    const sink = createFanOutEventSink([first, second]);

    sink.emit(firstEvent);
    sink.emit(secondEvent);
    sink.emit(firstEvent);

    expect(vi.mocked(first.emit).mock.calls.map(([event]) => event)).toEqual([
      firstEvent, secondEvent, firstEvent,
    ]);
    expect(vi.mocked(second.emit).mock.calls.map(([event]) => event)).toEqual([
      firstEvent, secondEvent, firstEvent,
    ]);
  });

  it('continues to later sinks and does not throw when one sink throws synchronously', () => {
    const deliveryOrder: string[] = [];
    const first: EventSink = { emit: vi.fn(() => { deliveryOrder.push('first'); }) };
    const failing: EventSink = { emit: vi.fn(() => {
      deliveryOrder.push('failing');
      throw new Error('observer failed');
    }) };
    const last: EventSink = { emit: vi.fn(() => { deliveryOrder.push('last'); }) };
    const sink = createFanOutEventSink([first, failing, last]);

    expect(() => sink.emit(firstEvent)).not.toThrow();

    expect(deliveryOrder).toEqual(['first', 'failing', 'last']);
    expect(first.emit).toHaveBeenCalledExactlyOnceWith(firstEvent);
    expect(failing.emit).toHaveBeenCalledExactlyOnceWith(firstEvent);
    expect(last.emit).toHaveBeenCalledExactlyOnceWith(firstEvent);
  });

  it('calls every sink and does not throw when all sinks fail', () => {
    const first: EventSink = { emit: vi.fn(() => { throw new Error('first failed'); }) };
    const second: EventSink = { emit: vi.fn(() => { throw new Error('second failed'); }) };
    const third: EventSink = { emit: vi.fn(() => { throw new Error('third failed'); }) };
    const sink = createFanOutEventSink([first, second, third]);

    expect(() => sink.emit(firstEvent)).not.toThrow();

    expect(first.emit).toHaveBeenCalledExactlyOnceWith(firstEvent);
    expect(second.emit).toHaveBeenCalledExactlyOnceWith(firstEvent);
    expect(third.emit).toHaveBeenCalledExactlyOnceWith(firstEvent);
  });

  it('accepts an empty subscriber list', () => {
    const sink = createFanOutEventSink([]);

    expect(() => sink.emit(firstEvent)).not.toThrow();
  });

  it('delivers an event to a sole subscriber', () => {
    const only: EventSink = { emit: vi.fn() };

    createFanOutEventSink([only]).emit(firstEvent);

    expect(only.emit).toHaveBeenCalledExactlyOnceWith(firstEvent);
    expect(vi.mocked(only.emit).mock.calls[0]?.[0]).toBe(firstEvent);
  });

  it('does not expose or forward close to a subscriber', () => {
    const subscriber: EventSink & { readonly close: ReturnType<typeof vi.fn> } = {
      emit: vi.fn(),
      close: vi.fn(),
    };
    const sink = createFanOutEventSink([subscriber]);

    sink.emit(firstEvent);

    expect('close' in sink).toBe(false);
    expect(subscriber.emit).toHaveBeenCalledExactlyOnceWith(firstEvent);
    expect(subscriber.close).not.toHaveBeenCalled();
  });
});
