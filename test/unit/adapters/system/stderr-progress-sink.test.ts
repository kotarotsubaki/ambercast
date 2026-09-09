import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStderrProgressSink } from '../../../../src/adapters/system/stderr-progress-sink.js';
import { createCallIdAllocator } from '../../../../src/core/ai/call-id-allocator.js';
import { createLayoutResolver } from '../../../../src/core/layout/resolve.js';
import type { Clock, RunEvent } from '../../../../src/ports/system.js';
import { generate } from '../../../../src/usecases/generate.js';
import { createInMemoryStorage } from '../../../doubles/create-in-memory-storage.js';
import { createFakeAiExecutor } from '../../../doubles/fake-ai-executor.js';

type AiCallEvent = Extract<RunEvent, { readonly type: 'ai-call' }>;

function createMutableClock(initialMs = 0): {
  readonly clock: Clock;
  readonly monotonicMs: ReturnType<typeof vi.fn<() => number>>;
  set(value: number): void;
} {
  let value = initialMs;
  const monotonicMs = vi.fn(() => value);
  return {
    clock: {
      now: () => new Date('2026-09-09T00:00:00.000Z'),
      monotonicMs,
    },
    monotonicMs,
    set(next): void {
      value = next;
    },
  };
}

function createRecordingStderr(): {
  readonly stderr: NodeJS.WritableStream;
  readonly output: string[];
  readonly write: ReturnType<typeof vi.fn>;
} {
  const output: string[] = [];
  const write = vi.fn((chunk: string | Uint8Array) => {
    output.push(String(chunk));
    return true;
  });
  return {
    stderr: { write } as unknown as NodeJS.WritableStream,
    output,
    write,
  };
}

function createThrowingStderr(error: Error): {
  readonly stderr: NodeJS.WritableStream;
  readonly write: ReturnType<typeof vi.fn>;
} {
  const write = vi.fn(() => {
    throw error;
  });
  return {
    stderr: { write } as unknown as NodeJS.WritableStream,
    write,
  };
}

function aiCall(overrides: Partial<AiCallEvent> = {}): AiCallEvent {
  return {
    type: 'ai-call',
    callId: 'ai-1',
    file: '/workspace/tests/login.test.md',
    attempt: 1,
    attemptLimit: 1,
    ...overrides,
  };
}

describe('createStderrProgressSink()', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it.each([
    {
      command: 'generate' as const,
      event: aiCall({ attempt: 2, attemptLimit: 3, stepId: 'ignored-for-generate' }),
      expected: 'generate tests/login.test.md: ai call 2/3\n',
    },
    {
      command: 'run' as const,
      event: aiCall({ stepId: 'submit-form' }),
      expected: 'run tests/login.test.md [submit-form]: ai call 1/1\n',
    },
    {
      command: 'run' as const,
      event: aiCall(),
      expected: 'run tests/login.test.md: ai call 1/1\n',
    },
    {
      command: 'heal' as const,
      event: aiCall({ stepId: 'submit-form' }),
      expected: 'heal tests/login.test.md [submit-form]: ai call 1/1\n',
    },
    {
      command: 'heal' as const,
      event: aiCall(),
      expected: 'heal tests/login.test.md: ai call 1/1\n',
    },
  ])('writes the $command start-line format and optional step identity', ({ command, event, expected }) => {
    const stderr = createRecordingStderr();
    const clock = createMutableClock();
    const sink = createStderrProgressSink({
      command,
      stderr: stderr.stderr,
      projectRoot: '/workspace',
      isCI: false,
      clock: clock.clock,
    });

    sink.emit(event);

    expect(stderr.output).toEqual([expected]);
    sink.close();
  });

  it('keeps paths outside projectRoot absolute', () => {
    const stderr = createRecordingStderr();
    const clock = createMutableClock();
    const sink = createStderrProgressSink({
      command: 'run',
      stderr: stderr.stderr,
      projectRoot: '/workspace',
      isCI: false,
      clock: clock.clock,
    });

    sink.emit(aiCall({ file: '/external/login.test.md' }));

    expect(stderr.output).toEqual(['run /external/login.test.md: ai call 1/1\n']);
    sink.close();
  });

  it('escapes C0, DEL, and C1 path controls while preserving ordinary Unicode and backslashes', () => {
    const stderr = createRecordingStderr();
    const clock = createMutableClock();
    const sink = createStderrProgressSink({
      command: 'generate',
      stderr: stderr.stderr,
      projectRoot: '/workspace',
      isCI: false,
      clock: clock.clock,
    });
    const controls = String.fromCharCode(0x00, 0x08, 0x09, 0x0a, 0x0c, 0x0d, 0x1b, 0x7f, 0x80, 0x9f);

    sink.emit(aiCall({ file: `/outside/日本語\\literal-${controls}.test.md` }));

    expect(stderr.output).toEqual([
      'generate /outside/日本語\\literal-\\u0000\\b\\t\\n\\f\\r\\u001b\\u007f\\u0080\\u009f.test.md: ai call 1/1\n',
    ]);
    sink.close();
  });

  it('emits no heartbeat before 30 seconds and repeats every 30 seconds using monotonic elapsed time', () => {
    const stderr = createRecordingStderr();
    const clock = createMutableClock(1_000);
    const sink = createStderrProgressSink({
      command: 'generate',
      stderr: stderr.stderr,
      projectRoot: '/workspace',
      isCI: false,
      clock: clock.clock,
    });
    sink.emit(aiCall({ attempt: 2, attemptLimit: 2 }));

    clock.set(30_999);
    vi.advanceTimersByTime(29_999);
    expect(stderr.output).toEqual(['generate tests/login.test.md: ai call 2/2\n']);

    clock.set(31_001);
    vi.advanceTimersByTime(1);
    expect(stderr.output).toEqual([
      'generate tests/login.test.md: ai call 2/2\n',
      'generate tests/login.test.md: ai call 2/2: still waiting (30s)\n',
    ]);

    clock.set(61_999);
    vi.advanceTimersByTime(30_000);
    expect(stderr.output).toEqual([
      'generate tests/login.test.md: ai call 2/2\n',
      'generate tests/login.test.md: ai call 2/2: still waiting (30s)\n',
      'generate tests/login.test.md: ai call 2/2: still waiting (60s)\n',
    ]);
    sink.close();
  });

  it('floors fractional elapsed seconds in heartbeat text', () => {
    const stderr = createRecordingStderr();
    const clock = createMutableClock(100.5);
    const sink = createStderrProgressSink({
      command: 'run',
      stderr: stderr.stderr,
      projectRoot: '/workspace',
      isCI: false,
      clock: clock.clock,
    });
    sink.emit(aiCall());

    clock.set(30_999.9);
    vi.advanceTimersByTime(30_000);

    expect(stderr.output.at(-1)).toBe('run tests/login.test.md: ai call 1/1: still waiting (30s)\n');
    sink.close();
  });

  it('suppresses heartbeat timers entirely in CI without consulting the monotonic clock', () => {
    const stderr = createRecordingStderr();
    const clockFailure = new Error('clock unavailable');
    const clock: Clock = {
      now: () => new Date('2026-09-09T00:00:00.000Z'),
      monotonicMs: vi.fn(() => {
        throw clockFailure;
      }),
    };
    const sink = createStderrProgressSink({
      command: 'heal',
      stderr: stderr.stderr,
      projectRoot: '/workspace',
      isCI: true,
      clock,
    });

    expect(() => sink.emit(aiCall({ stepId: 'repair-step' }))).not.toThrow();
    vi.advanceTimersByTime(120_000);

    expect(stderr.output).toEqual(['heal tests/login.test.md [repair-step]: ai call 1/1\n']);
    expect(clock.monotonicMs).not.toHaveBeenCalled();
    sink.close();
  });

  it.each(['ok', 'error'] as const)('stops a call heartbeat on an %s ai-result', (outcome) => {
    const stderr = createRecordingStderr();
    const clock = createMutableClock(0);
    const sink = createStderrProgressSink({
      command: 'run',
      stderr: stderr.stderr,
      projectRoot: '/workspace',
      isCI: false,
      clock: clock.clock,
    });
    sink.emit(aiCall());
    sink.emit({ type: 'ai-result', callId: 'ai-1', durationMs: 123, outcome });

    clock.set(90_000);
    vi.advanceTimersByTime(90_000);

    expect(stderr.output).toEqual(['run tests/login.test.md: ai call 1/1\n']);
    sink.close();
  });

  it('lets other in-flight calls continue after one matching ai-result', () => {
    const stderr = createRecordingStderr();
    const clock = createMutableClock(0);
    const sink = createStderrProgressSink({
      command: 'heal',
      stderr: stderr.stderr,
      projectRoot: '/workspace',
      isCI: false,
      clock: clock.clock,
    });
    sink.emit(aiCall({ callId: 'ai-1', stepId: 'first' }));
    sink.emit(aiCall({ callId: 'ai-2', stepId: 'second' }));
    sink.emit({ type: 'ai-result', callId: 'ai-1', durationMs: 10, outcome: 'ok' });

    clock.set(30_000);
    vi.advanceTimersByTime(30_000);

    expect(stderr.output).toEqual([
      'heal tests/login.test.md [first]: ai call 1/1\n',
      'heal tests/login.test.md [second]: ai call 1/1\n',
      'heal tests/login.test.md [second]: ai call 1/1: still waiting (30s)\n',
    ]);
    sink.close();
  });

  it('ignores an ai-result for an unknown callId without disturbing an in-flight call', () => {
    const stderr = createRecordingStderr();
    const clock = createMutableClock(0);
    const sink = createStderrProgressSink({
      command: 'run',
      stderr: stderr.stderr,
      projectRoot: '/workspace',
      isCI: false,
      clock: clock.clock,
    });
    sink.emit(aiCall());
    sink.emit({ type: 'ai-result', callId: 'ai-99', durationMs: 0, outcome: 'error' });

    clock.set(30_000);
    vi.advanceTimersByTime(30_000);

    expect(stderr.output.at(-1)).toBe('run tests/login.test.md: ai call 1/1: still waiting (30s)\n');
    sink.close();
  });

  it('stops heartbeats after a real timed-out dispatch reaches the sink with its terminal error result', async () => {
    const observed: string[] = [];
    const stderr = {
      write: vi.fn((chunk: string | Uint8Array) => {
        observed.push(String(chunk).trimEnd());
        return true;
      }),
    } as unknown as NodeJS.WritableStream;
    const clock: Clock = {
      now: () => new Date(Date.now()),
      monotonicMs: () => Date.now(),
    };
    const sink = createStderrProgressSink({
      command: 'generate',
      stderr,
      projectRoot: '/workspace',
      isCI: false,
      clock,
    });
    const forwardEvent = sink.emit.bind(sink);
    const emit = vi.spyOn(sink, 'emit').mockImplementation((event) => {
      forwardEvent(event);
      if (event.type === 'ai-result') {
        observed.push(`ai-result ${event.callId} ${event.outcome}`);
      }
    });
    const storage = createInMemoryStorage();
    await storage.writeText('/workspace/tests/login.test.md', '# Timeout\n');
    let markDispatchStarted!: () => void;
    const dispatchStarted = new Promise<void>((resolve) => { markDispatchStarted = resolve; });
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((timeoutMs) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException('The operation timed out.', 'TimeoutError')), timeoutMs);
      return controller.signal;
    });
    const running = generate({
      storage,
      layout: createLayoutResolver({ testDir: '/workspace/tests', runsDir: '/workspace/tests/.runs' }),
      resolveAiExecutor: async () => createFakeAiExecutor({
        execute: (request) => {
          markDispatchStarted();
          return new Promise<never>((_resolve, reject) => {
            if (request.signal?.aborted) {
              reject(request.signal.reason);
              return;
            }
            request.signal?.addEventListener('abort', () => reject(request.signal?.reason), { once: true });
          });
        },
      }),
      events: sink,
      clock,
      allocateCallId: createCallIdAllocator(),
      discoverTestFiles: async () => ['login.test.md'],
      config: {
        testDir: '/workspace/tests',
        testMatch: ['**/*.test.md'],
        testIgnore: ['**/.runs/**'],
        targets: { web: { baseUrl: 'https://example.test', browser: 'chromium', healReplayIsolation: 'stateful' } },
        defaultTarget: 'web',
        ai: { provider: 'codex', timeoutMs: 60_001, maxGenerateAttempts: 1 },
      },
    }, {
      files: [],
      strict: false,
      force: false,
      maxAttempts: 1,
      dryRun: false,
      allowEmpty: false,
      list: false,
    });

    try {
      await dispatchStarted;
      await vi.advanceTimersByTimeAsync(60_001);
      await expect(running).resolves.toMatchObject({
        results: [{
          status: 'failed',
          error: {
            kind: 'ai-executor-unavailable',
            message: 'The AI provider did not respond within the configured timeout.',
          },
        }],
      });

      expect(observed).toEqual([
        'generate tests/login.test.md: ai call 1/1',
        'generate tests/login.test.md: ai call 1/1: still waiting (30s)',
        'generate tests/login.test.md: ai call 1/1: still waiting (60s)',
        'ai-result ai-1 error',
      ]);
      expect(emit.mock.calls.map(([event]) => event).filter((event) => event.type === 'ai-result')).toEqual([
        { type: 'ai-result', callId: 'ai-1', durationMs: 60_001, outcome: 'error' },
      ]);

      await vi.advanceTimersByTimeAsync(90_000);
      expect(observed).toHaveLength(4);
    } finally {
      sink.close();
      emit.mockRestore();
      timeout.mockRestore();
    }
  });

  it('tracks concurrent calls from their own monotonic start readings', () => {
    const stderr = createRecordingStderr();
    const clock = createMutableClock(0);
    const sink = createStderrProgressSink({
      command: 'run',
      stderr: stderr.stderr,
      projectRoot: '/workspace',
      isCI: false,
      clock: clock.clock,
    });
    sink.emit(aiCall({ callId: 'ai-1', stepId: 'first' }));
    vi.advanceTimersByTime(10_000);
    clock.set(10_000);
    sink.emit(aiCall({ callId: 'ai-2', stepId: 'second' }));

    clock.set(30_000);
    vi.advanceTimersByTime(20_000);
    clock.set(40_000);
    vi.advanceTimersByTime(10_000);

    expect(stderr.output).toEqual([
      'run tests/login.test.md [first]: ai call 1/1\n',
      'run tests/login.test.md [second]: ai call 1/1\n',
      'run tests/login.test.md [first]: ai call 1/1: still waiting (30s)\n',
      'run tests/login.test.md [second]: ai call 1/1: still waiting (30s)\n',
    ]);
    sink.close();
  });

  it('close clears every outstanding timer including calls with no terminal result and is idempotent', () => {
    const stderr = createRecordingStderr();
    const clock = createMutableClock(0);
    const sink = createStderrProgressSink({
      command: 'heal',
      stderr: stderr.stderr,
      projectRoot: '/workspace',
      isCI: false,
      clock: clock.clock,
    });
    sink.emit(aiCall({ callId: 'ai-1', stepId: 'first' }));
    sink.emit(aiCall({ callId: 'ai-2', stepId: 'second' }));

    expect(() => {
      sink.close();
      sink.close();
    }).not.toThrow();
    clock.set(120_000);
    vi.advanceTimersByTime(120_000);

    expect(stderr.output).toEqual([
      'heal tests/login.test.md [first]: ai call 1/1\n',
      'heal tests/login.test.md [second]: ai call 1/1\n',
    ]);
  });

  it('swallows a synchronous stderr failure while writing a start line', () => {
    const streamFailure = new Error('stream failed');
    const stderr = createThrowingStderr(streamFailure);
    const clock = createMutableClock();
    const sink = createStderrProgressSink({
      command: 'generate',
      stderr: stderr.stderr,
      projectRoot: '/workspace',
      isCI: false,
      clock: clock.clock,
    });

    expect(() => sink.emit(aiCall())).not.toThrow();
    expect(stderr.write).toHaveBeenCalledOnce();
    expect(clock.monotonicMs).not.toHaveBeenCalled();
    sink.close();
  });

  it('swallows a synchronous clock failure while arming a heartbeat', () => {
    const stderr = createRecordingStderr();
    const clockFailure = new Error('clock failed');
    const clock: Clock = {
      now: () => new Date('2026-09-09T00:00:00.000Z'),
      monotonicMs: vi.fn(() => {
        throw clockFailure;
      }),
    };
    const sink = createStderrProgressSink({
      command: 'run',
      stderr: stderr.stderr,
      projectRoot: '/workspace',
      isCI: false,
      clock,
    });

    expect(() => sink.emit(aiCall())).not.toThrow();
    vi.advanceTimersByTime(60_000);
    expect(stderr.output).toEqual(['run tests/login.test.md: ai call 1/1\n']);
    sink.close();
  });

  it('swallows clock failures inside heartbeat callbacks', () => {
    const stderr = createRecordingStderr();
    const clockFailure = new Error('clock failed during heartbeat');
    const monotonicMs = vi.fn<() => number>()
      .mockReturnValueOnce(0)
      .mockImplementation(() => {
        throw clockFailure;
      });
    const sink = createStderrProgressSink({
      command: 'heal',
      stderr: stderr.stderr,
      projectRoot: '/workspace',
      isCI: false,
      clock: { now: () => new Date('2026-09-09T00:00:00.000Z'), monotonicMs },
    });
    sink.emit(aiCall());

    expect(() => vi.advanceTimersByTime(60_000)).not.toThrow();
    expect(monotonicMs).toHaveBeenCalledTimes(3);
    expect(stderr.output).toEqual(['heal tests/login.test.md: ai call 1/1\n']);
    sink.close();
  });

  it('swallows stderr failures inside heartbeat callbacks and keeps later ticks isolated', () => {
    const heartbeatFailure = new Error('heartbeat write failed');
    const write = vi.fn()
      .mockReturnValueOnce(true)
      .mockImplementation(() => {
        throw heartbeatFailure;
      });
    const clock = createMutableClock(0);
    const sink = createStderrProgressSink({
      command: 'generate',
      stderr: { write } as unknown as NodeJS.WritableStream,
      projectRoot: '/workspace',
      isCI: false,
      clock: clock.clock,
    });
    sink.emit(aiCall());

    clock.set(60_000);
    expect(() => vi.advanceTimersByTime(60_000)).not.toThrow();
    expect(write).toHaveBeenCalledTimes(3);
    sink.close();
  });

  it.each([
    { type: 'step-start', stepId: 'open-page' } as RunEvent,
    { type: 'step-result', stepId: 'open-page', via: 'grounding' } as RunEvent,
    { type: 'heal-stage2-rejected', stepId: 'open-page', reason: 'no-advance' } as RunEvent,
    { type: 'future-event' } as unknown as RunEvent,
  ])('treats unrelated or unexpected event type $type as a no-op', (event) => {
    const streamFailure = new Error('must not write');
    const stderr = createThrowingStderr(streamFailure);
    const clock = createMutableClock();
    const sink = createStderrProgressSink({
      command: 'run',
      stderr: stderr.stderr,
      projectRoot: '/workspace',
      isCI: false,
      clock: clock.clock,
    });

    expect(() => sink.emit(event)).not.toThrow();
    expect(stderr.write).not.toHaveBeenCalled();
    expect(clock.monotonicMs).not.toHaveBeenCalled();
    sink.close();
  });
});
