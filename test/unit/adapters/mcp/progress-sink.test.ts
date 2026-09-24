import { describe, expect, it, vi } from 'vitest';

import { createMcpProgressSink } from '#adapters/mcp/progress-sink.js';
import type { RunEvent } from '#ports/system.js';

const events = [
  { type: 'step-start', stepId: 'open-page' },
  { type: 'ai-call', callId: 'ai-1', file: '/workspace/tests/login.test.md', stepId: 'open-page', attempt: 2, attemptLimit: 3 },
  { type: 'ai-result', callId: 'ai-1', durationMs: 12, outcome: 'ok' },
  { type: 'unclassified-rejection', file: '/workspace/tests/login.test.md', name: 'Error', message: 'diagnostic only' },
  { type: 'heal-stage2-rejected', stepId: 'open-page', reason: 'no-advance' },
] as const satisfies readonly RunEvent[];

const messages = [
  'heal: step open-page started',
  'heal tests/login.test.md open-page: ai call 2/3',
  'heal: ai call done (ok)',
  'heal: step open-page repair attempt rejected (no-advance)',
];

describe('mcp/progress-sink TEST-B7', () => {
  it('projects the four wire messages in event order and observes even suppressed events', async () => {
    const send = vi.fn(async (_message: string) => {});
    const onEvent = vi.fn((_event: unknown) => {});
    const sink = createMcpProgressSink({ command: 'heal', sessionRoot: '/workspace', send, onEvent });

    for (const event of events) sink.emit(event);
    await sink.flush();

    expect(send.mock.calls.map(([message]) => message)).toEqual(messages);
    expect(onEvent.mock.calls.map(([event]) => event)).toEqual(events);
  });

  it('omits the optional step ID from an ai-call without leaving a double space', async () => {
    const send = vi.fn(async (_message: string) => {});
    const sink = createMcpProgressSink({ command: 'generate', sessionRoot: '/workspace', send });

    sink.emit({ type: 'ai-call', callId: 'ai-2', file: '/workspace/tests/new.test.md', attempt: 1, attemptLimit: 1 } satisfies RunEvent);
    await sink.flush();

    expect(send).toHaveBeenCalledExactlyOnceWith('generate tests/new.test.md: ai call 1/1');
  });

  it('does not resolve flush until notification sending has settled', async () => {
    let releaseFirst!: () => void;
    const firstSend = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const send = vi.fn(async (_message: string) => { await firstSend; });
    const sink = createMcpProgressSink({ command: 'run', sessionRoot: '/workspace', send });
    sink.emit({ type: 'step-start', stepId: 'open-page' } satisfies RunEvent);

    let flushed = false;
    const flush = sink.flush().then(() => { flushed = true; });
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(flushed).toBe(false);

    releaseFirst();
    await flush;
    expect(flushed).toBe(true);
  });

  it('discards a failed second send and continues delivering later notifications', async () => {
    const delivered: string[] = [];
    let attempts = 0;
    const send = vi.fn(async (message: string) => {
      attempts += 1;
      if (attempts === 2) throw new Error('transport write failed');
      delivered.push(message);
    });
    const sink = createMcpProgressSink({ command: 'heal', sessionRoot: '/workspace', send });
    for (const event of events) sink.emit(event);

    await expect(sink.flush()).resolves.toBeUndefined();

    expect(send).toHaveBeenCalledTimes(4);
    expect(delivered).toEqual([messages[0], messages[2], messages[3]]);
  });
});
