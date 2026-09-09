import { describe, expect, it, vi } from 'vitest';
import { IntegrityViolationError } from '#core/errors/integrity-violation-error.js';
import { createHealAiDispatchBudget, type HealAiDispatchPhaseDeps } from '#usecases/heal-ai-dispatch-budget.js';
import { PlanNavigationResolutionError } from '#usecases/run.js';
import type { RunEvent } from '#ports/system.js';
import { createRecordingEventSink } from '../../doubles/create-recording-event-sink.js';
import { createFakeAiExecutor } from '../../doubles/fake-ai-executor.js';

const request = {} as never;

const aiCall = (callId = 'ai-test'): Extract<RunEvent, { type: 'ai-call' }> => ({
  type: 'ai-call',
  callId,
  file: '/workspace/tests/login.test.md',
  attempt: 1,
  attemptLimit: 1,
  stepId: 'repair-step',
});

async function dispatchOnce(
  deps: HealAiDispatchPhaseDeps,
  kind: 'execute' | 'executeAgentic' = 'execute',
) {
  const executor = await deps.resolveAiExecutor();
  deps.events.emit(aiCall());
  return executor[kind](request);
}

async function dispatchWithLifecycle(
  deps: HealAiDispatchPhaseDeps,
  callId: string,
  kind: 'execute' | 'executeAgentic' = 'execute',
): Promise<unknown> {
  const executor = await deps.resolveAiExecutor();
  deps.events.emit(aiCall(callId));
  let outcome: 'ok' | 'error' = 'error';
  try {
    const value = await executor[kind](request);
    outcome = 'ok';
    return value;
  } finally {
    deps.events.emit({ type: 'ai-result', callId, durationMs: 7, outcome });
  }
}

function createBudget(params: Partial<Parameters<typeof createHealAiDispatchBudget>[0]> = {}) {
  let now = 0;
  const recording = createRecordingEventSink();
  const executor = createFakeAiExecutor({
    execute: async () => ({ data: { ok: true }, raw: '{}' }),
    executeAgentic: async () => ({ outcome: 'success' }),
  });
  const resolveAiExecutor = vi.fn(async () => executor);
  const budget = createHealAiDispatchBudget({
    resolveAiExecutor,
    signal: undefined,
    clock: { monotonicMs: () => now },
    events: recording.sink,
    deadlineMs: 100,
    maxDispatches: Infinity,
    ...params,
  });

  return { budget, executor, recording, resolveAiExecutor, setNow: (value: number) => { now = value; } };
}

describe('createHealAiDispatchBudget', () => {
  it('denies an expired phase before work or lazy executor resolution begins', async () => {
    const fixture = createBudget({ deadlineMs: 0 });
    const work = vi.fn(async (deps: HealAiDispatchPhaseDeps) => deps.resolveAiExecutor());

    await expect(fixture.budget.runPhase('incremental', work)).resolves.toEqual({
      status: 'denied',
      deniedReason: 'deadline',
    });
    expect(work).not.toHaveBeenCalled();
    expect(fixture.resolveAiExecutor).not.toHaveBeenCalled();
  });

  it('gives deadline denial precedence when deadline and limit are both exhausted', async () => {
    const fixture = createBudget({ maxDispatches: 1 });

    await expect(fixture.budget.runPhase('incremental', async (deps) => {
      await dispatchOnce(deps);
      return 'consumed the only dispatch';
    })).resolves.toEqual({ status: 'completed', result: { ok: true, value: 'consumed the only dispatch' } });

    fixture.setNow(100);

    await expect(fixture.budget.runPhase('incremental', async () => 'unreachable')).resolves.toEqual({
      status: 'denied',
      deniedReason: 'deadline',
    });
  });

  it('does not limit-deny stage 3 phases but still deadline-denies them', async () => {
    const fixture = createBudget({ maxDispatches: 1 });

    await expect(fixture.budget.runPhase('incremental', async (deps) => {
      await dispatchOnce(deps);
      return 'consumed the only dispatch';
    })).resolves.toEqual({ status: 'completed', result: { ok: true, value: 'consumed the only dispatch' } });

    await expect(fixture.budget.runPhase('stage3', async (deps) => {
      await dispatchOnce(deps);
      return 'allowed';
    })).resolves.toEqual({ status: 'completed', result: { ok: true, value: 'allowed' } });

    fixture.setNow(100);
    await expect(fixture.budget.runPhase('stage3', async () => 'unreachable')).resolves.toEqual({
      status: 'denied',
      deniedReason: 'deadline',
    });
  });

  it('counts Stage 3 admissions without consuming the incremental-only allowance', async () => {
    const fixture = createBudget({ maxDispatches: 1 });

    expect(fixture.budget.aiCalls).toBe(0);
    await expect(fixture.budget.runPhase('stage3', async (deps) => {
      await dispatchOnce(deps);
      return 'stage 3 admitted';
    })).resolves.toEqual({ status: 'completed', result: { ok: true, value: 'stage 3 admitted' } });
    expect(fixture.budget.aiCalls).toBe(1);

    await expect(fixture.budget.runPhase('incremental', async (deps) => {
      await dispatchOnce(deps);
      return 'incremental allowance remains';
    })).resolves.toEqual({ status: 'completed', result: { ok: true, value: 'incremental allowance remains' } });
    expect(fixture.budget.aiCalls).toBe(2);

    await expect(fixture.budget.runPhase('incremental', async (deps) => {
      await dispatchOnce(deps);
      return 'denied';
    })).resolves.toEqual({ status: 'denied', deniedReason: 'attempt-limit' });
    expect(fixture.budget.aiCalls).toBe(2);
  });

  it.each(['incremental', 'stage3'] as const)('forwards exactly one caller-owned ai-result for an admitted %s dispatch', async (kind) => {
    const fixture = createBudget();

    await expect(fixture.budget.runPhase(kind, async (deps) => {
      await dispatchWithLifecycle(deps, `ai-${kind}`);
      return 'completed';
    })).resolves.toEqual({ status: 'completed', result: { ok: true, value: 'completed' } });

    const callId = `ai-${kind}`;
    expect(fixture.recording.emitted()).toEqual([
      aiCall(callId),
      { type: 'ai-result', callId, durationMs: 7, outcome: 'ok' },
    ]);
    expect(fixture.recording.emitted().filter((event) => event.type === 'ai-result' && event.callId === callId)).toHaveLength(1);
    expect(fixture.budget.aiCalls).toBe(1);
  });

  it.each([
    ['attempt-limit', (_fixture: ReturnType<typeof createBudget>): void => undefined],
    ['deadline', (fixture: ReturnType<typeof createBudget>): void => { fixture.setNow(100); }],
  ] as const)('suppresses both lifecycle events and accounting when %s denial occurs before provider admission', async (reason, arrangeDenial) => {
    const fixture = createBudget({ maxDispatches: 1 });

    if (reason === 'attempt-limit') {
      await fixture.budget.runPhase('incremental', async (deps) => {
        await dispatchWithLifecycle(deps, 'ai-admitted');
        return 'consumed';
      });
    }
    arrangeDenial(fixture);
    const eventsBeforeDeniedPhase = fixture.recording.emitted();
    const callsBeforeDeniedPhase = fixture.budget.aiCalls;

    await expect(fixture.budget.runPhase('incremental', async (deps) => {
      try {
        await dispatchWithLifecycle(deps, 'ai-denied');
      } catch {
        // The production caller's finally has already attempted ai-result.
      }
      return 'discarded';
    })).resolves.toEqual({ status: 'denied', deniedReason: reason });

    expect(fixture.recording.emitted()).toEqual(eventsBeforeDeniedPhase);
    expect(fixture.recording.emitted().some((event) => 'callId' in event && event.callId === 'ai-denied')).toBe(false);
    expect(fixture.budget.aiCalls).toBe(callsBeforeDeniedPhase);
  });

  it('discards the caller finally ai-result when the deadline expires after ai-call but before dispatch admission', async () => {
    const fixture = createBudget();
    const execute = vi.spyOn(fixture.executor, 'execute');

    await expect(fixture.budget.runPhase('incremental', async (deps) => {
      const executor = await deps.resolveAiExecutor();
      const callId = 'ai-deadline-race';
      deps.events.emit(aiCall(callId));
      fixture.setNow(100);
      try {
        await executor.execute(request);
      } catch {
        // A production caller may classify or absorb the private denial, but
        // its lifecycle finally still attempts to publish this result.
      } finally {
        deps.events.emit({ type: 'ai-result', callId, durationMs: 100, outcome: 'error' });
      }
      return 'discarded';
    })).resolves.toEqual({ status: 'denied', deniedReason: 'deadline' });

    expect(fixture.recording.emitted()).toEqual([]);
    expect(fixture.budget.aiCalls).toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([NaN, -1, 1.5])('rejects an invalid finite maxDispatches value: %s', (maxDispatches) => {
    expect(() => createBudget({ maxDispatches })).toThrow();
  });

  it.each([Infinity, 1])('accepts the documented maxDispatches value: %s', (maxDispatches) => {
    expect(() => createBudget({ maxDispatches })).not.toThrow();
  });

  it('latches a phase denied by its second dispatch and discards its returned value', async () => {
    const fixture = createBudget({ maxDispatches: 1 });

    await expect(fixture.budget.runPhase('incremental', async (deps) => {
      await dispatchOnce(deps);
      await dispatchOnce(deps);
      return 'must be discarded';
    })).resolves.toEqual({ status: 'denied', deniedReason: 'attempt-limit' });
  });

  it('forwards an admitted call result when a later call in the same phase is denied', async () => {
    const fixture = createBudget({ maxDispatches: 1 });
    let finishFirst: (() => void) | undefined;
    vi.spyOn(fixture.executor, 'execute').mockImplementationOnce(async () => new Promise((resolve) => {
      finishFirst = () => resolve({ data: { ok: true }, raw: '{}' });
    }));

    await expect(fixture.budget.runPhase('incremental', async (deps) => {
      const executor = await deps.resolveAiExecutor();
      deps.events.emit(aiCall('ai-admitted'));
      const first = executor.execute(request);
      deps.events.emit(aiCall('ai-denied'));
      try {
        await executor.execute(request);
      } catch {
        // The denied caller still publishes its finally-owned result below.
      } finally {
        deps.events.emit({ type: 'ai-result', callId: 'ai-denied', durationMs: 1, outcome: 'error' });
      }
      finishFirst?.();
      await first;
      deps.events.emit({ type: 'ai-result', callId: 'ai-admitted', durationMs: 2, outcome: 'ok' });
      return 'discarded';
    })).resolves.toEqual({ status: 'denied', deniedReason: 'attempt-limit' });

    expect(fixture.recording.emitted()).toEqual([
      aiCall('ai-admitted'),
      { type: 'ai-result', callId: 'ai-admitted', durationMs: 2, outcome: 'ok' },
    ]);
  });

  it('preserves a completed ordinary work error exactly', async () => {
    const fixture = createBudget();
    const error = new Error('ordinary failure');

    const outcome = await fixture.budget.runPhase('incremental', async () => { throw error; });

    expect(outcome).toEqual({ status: 'completed', result: { ok: false, error } });
  });

  it('discards a deferred Stage 2 rejection when completed work fails ordinarily', async () => {
    const fixture = createBudget();
    const error = new Error('ordinary failure');
    const rejection = { type: 'heal-stage2-rejected' as const, stepId: 'repair-step', reason: 'no-advance' as const };

    const outcome = await fixture.budget.runPhase('incremental', async (deps) => {
      deps.events.emit(rejection);
      throw error;
    });

    expect(outcome).toEqual({ status: 'completed', result: { ok: false, error } });
    expect(fixture.recording.emitted()).not.toContainEqual(rejection);
  });

  it('rejects a swallowed protocol violation without flushing a deferred Stage 2 rejection', async () => {
    const fixture = createBudget();
    const rejection = { type: 'heal-stage2-rejected' as const, stepId: 'repair-step', reason: 'no-advance' as const };
    let capturedError: unknown;

    let rejectionFromPhase: unknown;
    try {
      await fixture.budget.runPhase('incremental', async (deps) => {
        const executor = await deps.resolveAiExecutor();
        try {
          await executor.execute(request);
        } catch (error) {
          capturedError = error;
        }
        deps.events.emit(rejection);
        return 'swallowed';
      });
    } catch (error) {
      rejectionFromPhase = error;
    }

    expect(rejectionFromPhase).toBe(capturedError);
    expect(capturedError).toMatchObject({ reason: 'missing-pending-ai-call' });
    expect(fixture.recording.emitted()).not.toContainEqual(rejection);
  });

  it('keeps the first caught protocol violation when a later violation throws its own reason', async () => {
    const fixture = createBudget();

    await expect(fixture.budget.runPhase('incremental', async (deps) => {
      const executor = await deps.resolveAiExecutor();
      try {
        await executor.execute(request);
      } catch {
        // The first violation is deliberately swallowed to exercise the phase latch.
      }
      deps.events.emit(aiCall('ai-first-pending'));
      let secondViolation: unknown;
      try {
        deps.events.emit(aiCall('ai-second-pending'));
      } catch (error) {
        secondViolation = error;
      }
      expect(secondViolation).toMatchObject({ reason: 'duplicate-pending-ai-call' });
      await executor.execute(request);
      return 'consumed';
    })).rejects.toMatchObject({ reason: 'missing-pending-ai-call' });
  });

  it('gives a caught protocol violation precedence over integrity failure and denial', async () => {
    const fixture = createBudget({ maxDispatches: 1 });
    const violation = new IntegrityViolationError('A later replay observation escaped containment.');

    await expect(fixture.budget.runPhase('incremental', async (deps) => {
      const executor = await deps.resolveAiExecutor();
      try {
        await executor.execute(request);
      } catch {
        // run() may absorb the phase-local protocol error before returning.
      }
      await dispatchOnce(deps);
      await expect(dispatchOnce(deps)).rejects.toThrow();
      throw violation;
    })).rejects.toMatchObject({ reason: 'missing-pending-ai-call' });
  });

  it('recovers after a caught and swallowed protocol violation', async () => {
    const fixture = createBudget();

    await expect(fixture.budget.runPhase('incremental', async (deps) => {
      const executor = await deps.resolveAiExecutor();
      try {
        await executor.execute(request);
      } catch {
        // This mirrors a downstream catch that returns normally.
      }
      return 'swallowed';
    })).rejects.toMatchObject({ reason: 'missing-pending-ai-call' });

    await expect(fixture.budget.runPhase('incremental', async (deps) => {
      await dispatchOnce(deps);
      return 'recovered';
    })).resolves.toEqual({ status: 'completed', result: { ok: true, value: 'recovered' } });
  });

  it.each([
    {
      label: 'attempt-limit',
      budget: { maxDispatches: 1 },
      beforeDeniedDispatch: () => undefined,
    },
    {
      label: 'deadline',
      budget: { maxDispatches: Infinity },
      beforeDeniedDispatch: (fixture: ReturnType<typeof createBudget>) => fixture.setNow(100),
    },
  ] as const)('preserves a later integrity violation after an internally caught %s denial', async ({ budget, beforeDeniedDispatch }) => {
    const fixture = createBudget(budget);
    const violation = new IntegrityViolationError('A later replay observation escaped containment.');
    const execute = vi.spyOn(fixture.executor, 'execute');

    const outcome = await fixture.budget.runPhase('incremental', async (deps) => {
      await dispatchOnce(deps);
      beforeDeniedDispatch(fixture);
      try {
        await dispatchOnce(deps);
      } catch {
        // The work models run() swallowing the private budget sentinel.
      }
      throw violation;
    });

    expect(execute).toHaveBeenCalledOnce();
    expect(outcome).toEqual({ status: 'integrity-failure', error: violation });
  });

  it('keeps denial precedence when an ordinary error was swallowed before the denial', async () => {
    const fixture = createBudget({ maxDispatches: 1 });

    const outcome = await fixture.budget.runPhase('incremental', async (deps) => {
      try {
        throw new Error('ordinary replay failure');
      } catch {
        // A non-integrity error does not activate the narrow precedence exception.
      }
      await dispatchOnce(deps);
      try {
        await dispatchOnce(deps);
      } catch {
        // This is the later, decisive denial.
      }
      return 'discarded by denial';
    });

    expect(outcome).toEqual({ status: 'denied', deniedReason: 'attempt-limit' });
  });

  it('treats a thrown repairable-navigation exception as an integrity failure even after an internal denial', async () => {
    const fixture = createBudget({ maxDispatches: 1 });
    const repairable = new PlanNavigationResolutionError('The plan destination cannot be resolved.');

    const outcome = await fixture.budget.runPhase('incremental', async (deps) => {
      await dispatchOnce(deps);
      try {
        await dispatchOnce(deps);
      } catch {
        // The work models run() swallowing the private budget sentinel.
      }
      throw repairable;
    });

    expect(outcome).toEqual({ status: 'integrity-failure', error: repairable });
  });

  it('passes through executor identity members and does not meter isAvailable', async () => {
    const fixture = createBudget({ maxDispatches: 1 });
    const isAvailable = vi.spyOn(fixture.executor, 'isAvailable');

    const outcome = await fixture.budget.runPhase('incremental', async (deps) => {
      const executor = await deps.resolveAiExecutor();
      return {
        name: executor.name,
        available: await executor.isAvailable(),
      };
    });

    expect(outcome).toEqual({ status: 'completed', result: { ok: true, value: {
      name: fixture.executor.name,
      available: true,
    } } });
    expect(isAvailable).toHaveBeenCalledOnce();
  });

  it('rejects reentrant phases before nested work can start', async () => {
    const fixture = createBudget();
    const nestedWork = vi.fn(async () => 'nested');

    const outcome = await fixture.budget.runPhase('incremental', async () => {
      await expect(fixture.budget.runPhase('incremental', nestedWork)).rejects.toThrow(/phase/i);
      return 'outer';
    });

    expect(outcome).toEqual({ status: 'completed', result: { ok: true, value: 'outer' } });
    expect(nestedWork).not.toHaveBeenCalled();
  });

  it('charges execute and executeAgentic against one shared counter', async () => {
    const fixture = createBudget({ maxDispatches: 1 });

    await expect(fixture.budget.runPhase('incremental', async (deps) => {
      await dispatchOnce(deps);
      await dispatchOnce(deps, 'executeAgentic');
      return 'must be discarded';
    })).resolves.toEqual({ status: 'denied', deniedReason: 'attempt-limit' });
  });

  it('never limit-denies an unbounded incremental budget', async () => {
    const fixture = createBudget({ maxDispatches: Infinity });

    await expect(fixture.budget.runPhase('incremental', async (deps) => {
      await dispatchOnce(deps);
      await dispatchOnce(deps, 'executeAgentic');
      await dispatchOnce(deps);
      return 'unbounded';
    })).resolves.toEqual({ status: 'completed', result: { ok: true, value: 'unbounded' } });
  });

  it.each(['execute', 'executeAgentic'] as const)('delivers an allowed %s event before delegating to the base executor', async (kind) => {
    const fixture = createBudget();
    const sinkEmit = vi.spyOn(fixture.recording.sink, 'emit');
    const baseMethod = vi.spyOn(fixture.executor, kind);

    await expect(fixture.budget.runPhase('incremental', async (deps) => {
      await dispatchOnce(deps, kind);
      return 'completed';
    })).resolves.toEqual({ status: 'completed', result: { ok: true, value: 'completed' } });

    expect(sinkEmit).toHaveBeenCalledOnce();
    expect(sinkEmit).toHaveBeenCalledWith(aiCall());
    expect(baseMethod).toHaveBeenCalledOnce();
    expect(sinkEmit.mock.invocationCallOrder[0]!).toBeLessThan(baseMethod.mock.invocationCallOrder[0]!);
  });

  it.each(['execute', 'executeAgentic'] as const)('does not emit or delegate a denied second %s dispatch', async (kind) => {
    const fixture = createBudget({ maxDispatches: 1 });
    const sinkEmit = vi.spyOn(fixture.recording.sink, 'emit');
    const baseMethod = vi.spyOn(fixture.executor, kind);

    await expect(fixture.budget.runPhase('incremental', async (deps) => {
      await dispatchOnce(deps, kind);
      const eventsAfterFirstDispatch = fixture.recording.emitted();
      const baseCallsAfterFirstDispatch = baseMethod.mock.calls.length;

      await expect(dispatchOnce(deps, kind)).rejects.toThrow();

      expect(fixture.recording.emitted()).toEqual(eventsAfterFirstDispatch);
      expect(baseMethod).toHaveBeenCalledTimes(baseCallsAfterFirstDispatch);
      return 'discarded';
    })).resolves.toEqual({ status: 'denied', deniedReason: 'attempt-limit' });

    expect(sinkEmit).toHaveBeenCalledOnce();
    expect(baseMethod).toHaveBeenCalledOnce();
  });

  it('retains an allowed dispatch event when a later dispatch in the phase is denied', async () => {
    const fixture = createBudget({ maxDispatches: 1 });

    await expect(fixture.budget.runPhase('incremental', async (deps) => {
      await dispatchOnce(deps);
      await expect(dispatchOnce(deps)).rejects.toThrow();
      return 'discarded';
    })).resolves.toEqual({ status: 'denied', deniedReason: 'attempt-limit' });

    expect(fixture.recording.emitted()).toEqual([aiCall()]);
  });

  it('holds a Stage 2 rejection during an open phase and discards it when the phase is denied', async () => {
    const fixture = createBudget({ maxDispatches: 1 });
    const rejection = { type: 'heal-stage2-rejected' as const, stepId: 'repair-step', reason: 'no-advance' as const };
    const passthrough = { type: 'step-start' as const, stepId: 'after-rejection' };

    await expect(fixture.budget.runPhase('incremental', async (deps) => {
      await dispatchOnce(deps);
      const eventsBeforeDeferral = fixture.recording.emitted();

      deps.events.emit(rejection);
      deps.events.emit(passthrough);

      expect(fixture.recording.emitted().slice(eventsBeforeDeferral.length)).toEqual([passthrough]);

      await expect(dispatchOnce(deps)).rejects.toThrow();
      return 'discarded';
    })).resolves.toEqual({ status: 'denied', deniedReason: 'attempt-limit' });

    expect(fixture.recording.emitted()).toEqual([aiCall(), passthrough]);
    expect(fixture.recording.emitted()).not.toContainEqual(rejection);
  });

  it('flushes a completed Stage 2 rejection exactly once after the phase events that precede settlement', async () => {
    const fixture = createBudget();
    const rejection = { type: 'heal-stage2-rejected' as const, stepId: 'repair-step', reason: 'no-advance' as const };
    const passthrough = { type: 'step-start' as const, stepId: 'after-rejection' };

    await expect(fixture.budget.runPhase('incremental', async (deps) => {
      await dispatchOnce(deps);
      const eventsBeforeDeferral = fixture.recording.emitted();

      deps.events.emit(rejection);
      deps.events.emit(passthrough);

      expect(fixture.recording.emitted().slice(eventsBeforeDeferral.length)).toEqual([passthrough]);
      return 'completed';
    })).resolves.toEqual({ status: 'completed', result: { ok: true, value: 'completed' } });

    expect(fixture.recording.emitted()).toEqual([aiCall(), passthrough, rejection]);
    expect(fixture.recording.emitted().filter((event) => event.type === 'heal-stage2-rejected')).toHaveLength(1);
  });

  it('rejects a retained event proxy while a later phase is open without leaking state', async () => {
    const fixture = createBudget();
    let retainedEvents: HealAiDispatchPhaseDeps['events'] | undefined;

    await expect(fixture.budget.runPhase('incremental', async (deps) => {
      retainedEvents = deps.events;
      await dispatchOnce(deps);
      return 'first phase';
    })).resolves.toEqual({ status: 'completed', result: { ok: true, value: 'first phase' } });

    if (retainedEvents === undefined) throw new Error('The test must retain the phase event proxy.');

    let markSecondPhaseOpen!: () => void;
    const secondPhaseOpen = new Promise<void>((resolve) => { markSecondPhaseOpen = resolve; });
    let continueSecondPhase!: () => void;
    const continueSecondPhaseWork = new Promise<void>((resolve) => { continueSecondPhase = resolve; });
    const secondPhase = fixture.budget.runPhase('incremental', async (deps) => {
      markSecondPhaseOpen();
      await continueSecondPhaseWork;
      await dispatchOnce(deps);
      return 'second phase';
    });
    await secondPhaseOpen;

    let staleProxyError: unknown;
    try {
      retainedEvents.emit({ type: 'step-start', stepId: 'stale-event' });
    } catch (error) {
      staleProxyError = error;
    }
    expect(staleProxyError).toMatchObject({ reason: 'stale-events-proxy' });

    continueSecondPhase();
    await expect(secondPhase).resolves.toEqual({ status: 'completed', result: { ok: true, value: 'second phase' } });

    expect(fixture.recording.emitted()).toEqual([aiCall(), aiCall()]);
  });

  it('rejects a retained executor after settlement and recovers for a later valid phase', async () => {
    const fixture = createBudget();
    let retainedExecutor: Awaited<ReturnType<HealAiDispatchPhaseDeps['resolveAiExecutor']>> | undefined;

    await expect(fixture.budget.runPhase('incremental', async (deps) => {
      retainedExecutor = await deps.resolveAiExecutor();
      deps.events.emit(aiCall());
      await retainedExecutor.execute(request);
      return 'first phase';
    })).resolves.toEqual({ status: 'completed', result: { ok: true, value: 'first phase' } });

    if (retainedExecutor === undefined) throw new Error('The test must retain the decorated executor.');

    await expect(retainedExecutor.execute(request)).rejects.toMatchObject({
      name: 'Error',
      message: expect.stringMatching(/outside an open budget phase/i),
    });

    await expect(fixture.budget.runPhase('incremental', async (deps) => {
      await dispatchOnce(deps);
      return 'recovered';
    })).resolves.toEqual({ status: 'completed', result: { ok: true, value: 'recovered' } });
  });

  it('rejects a duplicate pending AI call and recovers for a later valid phase', async () => {
    const fixture = createBudget();

    await expect(fixture.budget.runPhase('incremental', async (deps) => {
      deps.events.emit(aiCall('ai-first-pending'));
      deps.events.emit(aiCall('ai-second-pending'));
      return 'unreachable';
    })).rejects.toMatchObject({ reason: 'duplicate-pending-ai-call' });

    await expect(fixture.budget.runPhase('incremental', async (deps) => {
      await dispatchOnce(deps);
      return 'recovered';
    })).resolves.toEqual({ status: 'completed', result: { ok: true, value: 'recovered' } });

    expect(fixture.recording.emitted()).toEqual([aiCall()]);
  });

  it('rejects a dispatch without a pending AI call and recovers for a later valid phase', async () => {
    const fixture = createBudget();

    await expect(fixture.budget.runPhase('incremental', async (deps) => {
      const executor = await deps.resolveAiExecutor();
      await executor.execute(request);
      return 'unreachable';
    })).rejects.toMatchObject({ reason: 'missing-pending-ai-call' });

    await expect(fixture.budget.runPhase('incremental', async (deps) => {
      await dispatchOnce(deps);
      return 'recovered';
    })).resolves.toEqual({ status: 'completed', result: { ok: true, value: 'recovered' } });

    expect(fixture.recording.emitted()).toEqual([aiCall()]);
  });

  it('rejects an unconsumed pending AI call and recovers for a later valid phase', async () => {
    const fixture = createBudget();

    await expect(fixture.budget.runPhase('incremental', async (deps) => {
      deps.events.emit(aiCall());
      return 'unreachable';
    })).rejects.toMatchObject({ reason: 'unconsumed-pending-ai-call' });

    await expect(fixture.budget.runPhase('incremental', async (deps) => {
      await dispatchOnce(deps);
      return 'recovered';
    })).resolves.toEqual({ status: 'completed', result: { ok: true, value: 'recovered' } });

    expect(fixture.recording.emitted()).toEqual([aiCall()]);
  });

  it('gives the first-latched protocol violation precedence over a separately unconsumed pending AI call', async () => {
    const fixture = createBudget();

    await expect(fixture.budget.runPhase('incremental', async (deps) => {
      const executor = await deps.resolveAiExecutor();
      try {
        await executor.execute(request); // throws missing-pending-ai-call; latches phase.protocolViolation
      } catch {
        // Models a generic downstream catch (H2a): the record survives even though
        // the throw itself is swallowed here.
      }
      deps.events.emit(aiCall()); // leaves phase.pendingAiCall set; never dispatched
      return 'swallowed';
    })).rejects.toMatchObject({ reason: 'missing-pending-ai-call' });
  });

  it('gives an unconsumed pending AI call precedence over a latched denial', async () => {
    const fixture = createBudget({ maxDispatches: 1 });

    await expect(fixture.budget.runPhase('incremental', async (deps) => {
      await dispatchOnce(deps);
      await expect(dispatchOnce(deps)).rejects.toThrow();
      deps.events.emit(aiCall());
      return 'unreachable';
    })).rejects.toMatchObject({ reason: 'unconsumed-pending-ai-call' });
  });

  it('gives an unconsumed pending AI call precedence over a thrown integrity violation', async () => {
    const fixture = createBudget();
    const violation = new IntegrityViolationError('A pending dispatch cannot be obscured by an integrity failure.');

    await expect(fixture.budget.runPhase('incremental', async (deps) => {
      deps.events.emit(aiCall());
      throw violation;
    })).rejects.toMatchObject({ reason: 'unconsumed-pending-ai-call' });
  });

  it('rejects an unconsumed pending AI call before flushing a deferred Stage 2 rejection', async () => {
    const fixture = createBudget();
    const rejection = { type: 'heal-stage2-rejected' as const, stepId: 'repair-step', reason: 'no-advance' as const };

    await expect(fixture.budget.runPhase('incremental', async (deps) => {
      deps.events.emit(rejection);
      deps.events.emit(aiCall());
      return 'unreachable';
    })).rejects.toMatchObject({ reason: 'unconsumed-pending-ai-call' });

    expect(fixture.recording.emitted()).not.toContainEqual(rejection);

    await expect(fixture.budget.runPhase('incremental', async (deps) => {
      await dispatchOnce(deps);
      return 'recovered';
    })).resolves.toEqual({ status: 'completed', result: { ok: true, value: 'recovered' } });

    expect(fixture.recording.emitted()).toEqual([aiCall()]);
  });
});
