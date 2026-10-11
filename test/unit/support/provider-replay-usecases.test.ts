import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HealCaseOutcome, HealOutcome } from '#usecases/heal.js';
import { z } from 'zod';
import { typedJsonSchema } from '#core/ai/typed-json-schema.js';
import { settleDryRunOutcome, replayThroughUseCase, replayExecute, repeatFixture, SETTLE_SLACK_MS, HANG_GUARD_MS } from '../../support/provider-replay.js';
import { ProviderFixtureValue, type ProviderFixture } from '../../support/provider-fixture.js';
import { truncatedJson, emptyStdoutExitZero, emptyOutputFile, nonZeroExit, hangUntilTimeout, validResponse } from '../../support/provider-fault-builders.js';
import { assertDiagnosable, assertNoSecretDisclosure } from '../../support/report-assertions.js';
import * as generateScenario from '../../support/generate-scenario.js';
import * as generateUseCase from '#usecases/generate.js';
import * as healUseCase from '#usecases/heal.js';
import * as runUseCase from '#usecases/run.js';
import * as fakeRunner from '../../doubles/create-fake-command-runner.js';
import type { InstructionCoveredAiExecutor } from '#ports/ai.js';

const providers = ['claude-code-cli', 'codex-cli'] as const;
const timeoutMessage = 'The AI provider did not respond within the configured timeout.';
const issues = [{ code: 'invalid-json', path: [] }];

/** Marker placement proves transport evidence exists before testing disclosure. */
function faults(provider: ProviderFixture['provider']) {
  return [
    { name: 'truncatedJson', fixture: truncatedJson(provider, { m: 'REPLAY-MARKER-STDOUT', tail: 'unfinished' }, { keep: 30 }), code: 'AI_RESPONSE_INVALID', message: 'The AI provider returned malformed JSON.', marker: 'REPLAY-MARKER-STDOUT', field: 'raw' },
    { name: 'empty', fixture: provider === 'claude-code-cli' ? emptyStdoutExitZero() : emptyOutputFile(), code: 'AI_RESPONSE_INVALID', message: provider === 'claude-code-cli' ? 'The Claude Code CLI returned malformed JSON.' : 'The AI provider returned malformed JSON.' },
    { name: 'nonZeroExit', fixture: nonZeroExit(provider, { stderr: 'REPLAY-MARKER-STDERR' }), code: 'AI_EXECUTOR_UNAVAILABLE', message: provider === 'claude-code-cli' ? 'The Claude Code CLI did not complete the request.' : 'The Codex CLI did not complete the request.', marker: 'REPLAY-MARKER-STDERR', field: 'stderrExcerpt' },
    { name: 'hangUntilTimeout', fixture: hangUntilTimeout(provider), code: 'AI_EXECUTOR_UNAVAILABLE', message: timeoutMessage },
    ...(provider === 'codex-cli' ? [{ name: 'missingFile', fixture: ProviderFixtureValue.parse({ ...emptyOutputFile(), outputFile: undefined }), code: 'AI_EXECUTOR_UNAVAILABLE', message: 'The Codex CLI did not produce a response file.' }] : []),
  ];
}

/** An independent adapter replay prevents empty-input disclosure checks. */
async function transportOracle(fault: ReturnType<typeof faults>[number]): Promise<void> {
  if (!fault.marker) return;
  const error = await replayExecute(fault.fixture, { prompt: 'Return JSON.', responseSchema: typedJsonSchema(z.unknown()) }).catch(error => error);
  expect(error.details[fault.field!]).toContain(fault.marker);
}

/** Observations are emitted only after production execution, for the SPEC-8 log. */
function observe(row: string, result: Awaited<ReturnType<typeof replayThroughUseCase>>): void {
  console.log('SPEC-8 oracle', row, JSON.stringify({ calls: result.calls.length, exitCode: result.exitCode, errors: result.report.errors, results: result.report.results }));
}

/** Errors without optional diagnostics must remain distinguishable from attempts. */
function details(error: Awaited<ReturnType<typeof replayThroughUseCase>>['report']['errors'][number]): unknown {
  return 'details' in error ? error.details : undefined;
}

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('replayThroughUseCase', () => {
  it.each(providers)('Issue #596 TEST-12 binds an unnamed textbox through %s', async provider => {
    const result = await replayThroughUseCase({ useCase: 'run', runScreen: 'unnamed-textbox', fixtures: [validResponse(provider, { proposal: { outcome: 'found', role: 'textbox', name: '' } })] });
    expect(result.calls).toHaveLength(1);
    expect(result.exitCode).toBe(0);
    expect(result.report.results[0]).toMatchObject({ status: 'passed', aiCalls: 1, steps: [expect.objectContaining({ binding: expect.objectContaining({ provenance: 'ai-proposed' }) }), expect.objectContaining({ status: 'passed' })] });
    assertDiagnosable(result.report);
  });
  it.each(providers)('Issue #596 TEST-12 rejects omitted proposal name through %s', async provider => {
    const result = await replayThroughUseCase({ useCase: 'run', runScreen: 'unnamed-textbox', fixtures: [validResponse(provider, { proposal: { outcome: 'found', role: 'textbox' } })] });
    expect(result.calls).toHaveLength(1);
    expect(result.exitCode).toBe(3);
    expect(result.report.errors[0]).toMatchObject({ code: 'AI_RESPONSE_INVALID' });
    assertDiagnosable(result.report);
  });
  it('TEST-23 hang guard scales with aiTimeoutMs in use-case drivers', async () => {
    vi.useFakeTimers();
    const aiTimeoutMs = 11000;
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
      expect(ms).toBe(aiTimeoutMs);
      return deadline.signal;
    });
    let settled = false;
    const outcome = replayThroughUseCase({ useCase: 'generate', fixtures: [hangUntilTimeout('claude-code-cli')], aiTimeoutMs })
      .then(result => { settled = true; return result; });
    await vi.advanceTimersByTimeAsync(HANG_GUARD_MS);
    expect(settled).toBe(false);
    deadline.abort();
    await vi.advanceTimersByTimeAsync(0);
    const result = await outcome;
    expect(settled).toBe(true);
    expect(result.calls).toHaveLength(1);
    expect(result.exitCode).toBe(3);
    expect(result.report.errors[0]!.message).toBe(timeoutMessage);
  });
  it('requires exactly two heal calls even when cleanup exempts unconsumed hang fixtures', async () => {
    const runnerSpy = vi.spyOn(fakeRunner, 'createFakeCommandRunner');
    const originalHeal = healUseCase.heal;
    vi.spyOn(healUseCase, 'heal').mockImplementation(async (...args) => {
      const batch = await originalHeal(...args);
      const calls: fakeRunner.FakeCommandRunner['calls'] = runnerSpy.mock.results[0]!.value.calls;
      expect(calls).toHaveLength(2);
      expect(calls.every(call => call.options?.signal?.aborted)).toBe(true);
      // Simulate a dropped Stage 3 record after both real timeout paths settle.
      // Cleanup allows the remaining hangs; the driver must enforce SPEC-7.
      calls.pop();
      return batch;
    });
    await expect(replayThroughUseCase({
      useCase: 'heal', fixtures: repeatFixture(hangUntilTimeout('claude-code-cli'), 3), aiTimeoutMs: 50,
    })).rejects.toThrow('replay: heal fixtures must produce exactly 2 calls (Stage 2 + Stage 3), observed 1');
    expect(runnerSpy.mock.results[0]!.value.calls).toHaveLength(1);
  });
  it.each((['generate', 'heal', 'run'] as const).flatMap(useCase => [false, true].map(cleanupFails => ({ useCase, cleanupFails }))))('TEST-17 $useCase preserves rejection only after delayed cleanup; cleanupFails=$cleanupFails', async ({ useCase, cleanupFails }) => {
    vi.useFakeTimers();
    const runnerSpy = vi.spyOn(fakeRunner, 'createFakeCommandRunner');
    const originalError = new Error(`${useCase} control-flow failure`);
    let signalStarted!: () => void;
    const started = new Promise<void>(resolve => { signalStarted = resolve; });
    let command!: Promise<unknown>;
    const rejectUseCase = async (): Promise<never> => {
      command = runnerSpy.mock.results[0]!.value.run('claude', ['-p']);
      await Promise.resolve();
      signalStarted();
      throw originalError;
    };
    switch (useCase) {
      case 'generate': vi.spyOn(generateUseCase, 'generate').mockImplementation(rejectUseCase); break;
      case 'heal': vi.spyOn(healUseCase, 'heal').mockImplementation(rejectUseCase); break;
      case 'run': vi.spyOn(runUseCase, 'run').mockImplementation(rejectUseCase); break;
    }
    const fixture = { ...emptyStdoutExitZero(), delayMs: 20 };
    let settled = false;
    const outcome = replayThroughUseCase({ useCase, fixtures: repeatFixture(fixture, cleanupFails ? 2 : 1) })
      .then(() => { throw new Error('expected use-case rejection'); }, error => { settled = true; return error; });
    await started;
    await vi.advanceTimersByTimeAsync(19);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await command;
    const error = await outcome;
    if (cleanupFails) {
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBe(originalError);
      expect(error.message).toBe('replay: 1 problem(s)\n- calls 1 but fixtures 2');
    } else expect(error).toBe(originalError);
    expect(runnerSpy.mock.results[0]!.value.calls).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('TEST-21 rejects agentic execution before side effects and reports the violation during cleanup', async () => {
    const runnerSpy = vi.spyOn(fakeRunner, 'createFakeCommandRunner');
    const original = generateScenario.createScenario;
    let agenticError: unknown;
    let requestReads = 0;
    vi.spyOn(generateScenario, 'createScenario').mockImplementation(overrides => original({
      ...overrides,
      resolveAiExecutor: async () => {
        const executor = await overrides!.resolveAiExecutor!();
        const calls = runnerSpy.mock.results[0]!.value.calls;
        const before = [...calls];
        // Accessing any request field would enter the real agentic path.
        const request = new Proxy({}, { get() { requestReads += 1; throw new Error('agentic request was accessed'); } });
        agenticError = await executor.executeAgentic(request as Parameters<InstructionCoveredAiExecutor['executeAgentic']>[0]).catch(error => error);
        expect(calls).toStrictEqual(before);
        return executor;
      },
    }));
    await expect(replayThroughUseCase({ useCase: 'generate', fixtures: [emptyStdoutExitZero()], maxAttempts: 1 }))
      .rejects.toThrow('replay: agentic execution is out of scope');
    expect(agenticError).toEqual(new Error('replay: agentic execution is out of scope'));
    expect(requestReads).toBe(0);
    expect(runnerSpy.mock.results[0]!.value.calls).toHaveLength(1);
  });
  it.each(providers.flatMap(provider => [
    ...faults(provider).filter(fault => ['truncatedJson', 'nonZeroExit', 'hangUntilTimeout'].includes(fault.name)).map(fault => ({ provider, fault, responseShape: false })),
    { provider, fault: faults(provider)[0]!, responseShape: true },
  ]))('TEST-16 heal $provider $fault.name responseShape=$responseShape consumes Stage 2 and Stage 3', async ({ provider, fault, responseShape }) => {
      await transportOracle(fault);
      const fixtures = responseShape ? [validResponse(provider, { steps: [], ambiguities: [] }), fault.fixture] : repeatFixture(fault.fixture, 2);
      const result = await replayThroughUseCase({ useCase: 'heal', fixtures, ...(fault.name === 'hangUntilTimeout' ? { aiTimeoutMs: 50 } : {}) });
      observe(`heal ${provider} ${fault.name} responseShape=${responseShape}`, result);
      expect(result.calls).toHaveLength(2);
      expect(result.exitCode).toBe(3);
      expect(result.report.command).toBe('heal');
      if (result.report.command !== 'heal') throw new Error('Expected heal report.');
      expect(result.report.results[0]).toMatchObject({ repairOutcome: 'unresolved' });
      const row = result.report.results[0]!;
      if (!('repairTrace' in row)) throw new Error('Expected execution-backed heal evidence.');
      expect(row.repairTrace).toEqual([
        { stage: 'stage1', stepId: 'repair-me', outcome: 'not-eligible', reason: 'mode-none' },
        { stage: 'stage2', stepId: 'repair-me', outcome: 'rejected', reason: responseShape ? 'response-shape' : 'provider-error' },
        { stage: 'stage3', outcome: 'failed', code: fault.code },
      ]);
      expect(result.report.errors[0]).toMatchObject({ scope: 'case', caseId: result.report.results[0]!.id, code: fault.code });
      expect(details(result.report.errors[0]!)).toStrictEqual({ ...(fault.code === 'AI_RESPONSE_INVALID' ? { issues } : {}), attempts: [{ attempt: 1, code: fault.code }] });
      expect(result.report.errors[0]!.message).toBe(fault.message);
      assertDiagnosable(result.report);
      if (fault.marker) assertNoSecretDisclosure({ secrets: { marker: fault.marker }, report: result.report });
  });
  it.each(providers.flatMap(provider => faults(provider).map(fault => ({ provider, fault }))))('TEST-15 run $provider $fault.name', async ({ provider, fault }) => {
    await transportOracle(fault);
    const result = await replayThroughUseCase({ useCase: 'run', fixtures: [fault.fixture], ...(fault.name === 'hangUntilTimeout' ? { aiTimeoutMs: 50 } : {}) });
    observe(`run ${provider} ${fault.name}`, result);
    expect(result.calls).toHaveLength(1);
    expect(result.exitCode).toBe(3);
    const error = result.report.errors[0]!;
    expect(error).toMatchObject({ scope: 'case', caseId: result.report.results[0]!.id, code: fault.code });
    expect(details(error)).toStrictEqual(fault.code === 'AI_RESPONSE_INVALID' ? { issues } : undefined);
    expect(result.report.results[0]).toMatchObject({ steps: [expect.objectContaining({ status: 'error' }), expect.anything()] });
    expect(error.message).toBe(fault.message);
    assertDiagnosable(result.report);
    if (fault.marker) assertNoSecretDisclosure({ secrets: { marker: fault.marker }, report: result.report });
  });

  it.each(providers)('TEST-15 run confirms a found binding for %s', async provider => {
    const result = await replayThroughUseCase({ useCase: 'run', fixtures: [validResponse(provider, { proposal: { outcome: 'found', role: 'button', name: 'Submit' } })] });
    observe(`run ${provider} found`, result);
    expect(result.calls).toHaveLength(1);
    expect(result.exitCode).toBe(0);
    expect(result.report.results[0]).toMatchObject({ status: 'passed', aiCalls: 1, steps: [expect.objectContaining({ binding: expect.objectContaining({ provenance: 'ai-proposed' }) }), expect.objectContaining({ status: 'passed' })] });
    assertDiagnosable(result.report);
  });
  it.each(providers.flatMap(provider => faults(provider).flatMap(fault => [1, 2].map(maxAttempts => ({ provider, fault, maxAttempts })))))('TEST-12/13 generate $provider $fault.name maxAttempts=$maxAttempts', async ({ provider, fault, maxAttempts }) => {
    await transportOracle(fault);
    const count = fault.code === 'AI_RESPONSE_INVALID' ? maxAttempts : 1;
    const started = performance.now();
    const aiTimeoutMs = fault.name === 'hangUntilTimeout' ? 50 : 5000;
    const result = await replayThroughUseCase({ useCase: 'generate', fixtures: repeatFixture(fault.fixture, count), maxAttempts, aiTimeoutMs });
    expect(performance.now() - started).toBeLessThan(count * aiTimeoutMs + SETTLE_SLACK_MS);
    observe(`generate ${provider} ${fault.name} attempts=${maxAttempts}`, result);
    expect(result.calls).toHaveLength(count);
    expect(result.exitCode).toBe(3);
    const error = result.report.errors[0]!;
    expect(error).toMatchObject({ scope: 'case', caseId: result.report.results[0]!.id, code: fault.code });
    expect(details(error)).toStrictEqual({
      ...(fault.code === 'AI_RESPONSE_INVALID' ? { issues } : {}),
      attempts: Array.from({ length: count }, (_, index) => ({ attempt: index + 1, code: fault.code })),
    });
    expect(error.message).toBe(fault.message);
    assertDiagnosable(result.report);
    if (fault.marker) assertNoSecretDisclosure({ secrets: { marker: fault.marker }, report: result.report });
  });

  it.each(providers.flatMap(provider => [1, 2].map(maxAttempts => ({ provider, maxAttempts }))))('TEST-14 generate rejects unknown target $provider attempts=$maxAttempts', async ({ provider, maxAttempts }) => {
    const fixture = validResponse(provider, { steps: [{ id: 'navigate-unknown', kind: 'action', target: 'unknown', action: 'navigate', url: 'https://example.test' }], ambiguities: [] });
    const result = await replayThroughUseCase({ useCase: 'generate', fixtures: repeatFixture(fixture, maxAttempts), maxAttempts });
    observe(`generate ${provider} unknownTarget attempts=${maxAttempts}`, result);
    expect(result.calls).toHaveLength(maxAttempts);
    expect(result.exitCode).toBe(3);
    expect(details(result.report.errors[0]!)).toStrictEqual({ issues: [{ code: 'schema-mismatch', path: ['steps'] }], attempts: Array.from({ length: maxAttempts }, (_, index) => ({ attempt: index + 1, code: 'AI_RESPONSE_INVALID' })) });
    expect(result.report.errors[0]).toMatchObject({ scope: 'case', caseId: result.report.results[0]!.id, code: 'AI_RESPONSE_INVALID' });
    expect(result.report.errors[0]!.message).toBe('The AI provider response references a target outside the generation context.');
    assertDiagnosable(result.report);
  });

  it.each([
    { fixtures: [], message: 'replay: fixtures is empty' },
    { fixtures: [emptyStdoutExitZero(), emptyOutputFile()], message: 'replay: fixtures mix providers' },
    ...[0, 600001, 1.5].map(aiTimeoutMs => ({ aiTimeoutMs, message: 'replay: aiTimeoutMs must be an integer in 1..600000' })),
    ...[0, 11, 1.5].map(maxAttempts => ({ maxAttempts, message: 'replay: maxAttempts must be an integer in 1..10' })),
    ...(['heal', 'run'] as const).map(useCase => ({ useCase, maxAttempts: 2, message: 'replay: maxAttempts applies to generate only' })),
  ])('TEST-17 validates before startup: $message', async ({ message, ...input }) => {
    const spy = vi.spyOn(generateScenario, 'createScenario');
    await expect(replayThroughUseCase({ useCase: 'generate', fixtures: [emptyStdoutExitZero()], ...input })).rejects.toThrow(message);
    expect(spy).not.toHaveBeenCalled();
  });

  it('TEST-17 reproduces reports with fresh scenarios and rejects count mismatches', async () => {
    const fixtures = repeatFixture(truncatedJson('claude-code-cli', { broken: true }), 2);
    const input = { useCase: 'generate' as const, fixtures };
    expect((await replayThroughUseCase(input)).report).toStrictEqual((await replayThroughUseCase(input)).report);
    await expect(replayThroughUseCase({ ...input, fixtures: [...fixtures, fixtures[0]!] })).rejects.toThrow('calls 2 but fixtures 3');
  });

  it('SUPP-2 bounds a never-settled use case and releases its timer', async () => {
    vi.useFakeTimers();
    const original = generateScenario.createScenario;
    vi.spyOn(generateScenario, 'createScenario').mockImplementation(overrides => original({ ...overrides, resolveAiExecutor: async () => new Promise(() => {}) }));
    const pending = replayThroughUseCase({ useCase: 'generate', fixtures: [emptyStdoutExitZero()], aiTimeoutMs: 1 }).catch(error => error);
    await vi.advanceTimersByTimeAsync(3002);
    const error = await pending;
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('replay: the use case did not settle');
    expect(error.message).toContain('calls 0 but fixtures 1');
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([
    ['unresolved', 'deadline', 'not-eligible', 'deadline'],
    ['unresolved', 'settled', 'no-artifact-change', 'settled'],
    ['unresolved', 'attempt-limit', 'no-artifact-change', 'attempt-limit'],
    ['no-changes-needed', 'attempt-limit', 'no-artifact-change', 'settled'],
    ['healed', 'settled', 'preview-only', 'settled'],
    ['partially-healed', 'attempt-limit', 'preview-only', 'attempt-limit'],
  ] as const)('TEST-22 projects %s with %s without changing evidence', (repairOutcome, stopReason, application, expectedStop) => {
    const result: HealCaseOutcome = {
      id: '/workspace/tests/login.test.md', file: '/workspace/tests/login.test.md', planFile: '/workspace/tests/login.ambercast.plan.json',
      repairOutcome, stopReason, steps: [{ id: 'repair-me', target: 'web', type: 'action', status: 'error', kind: 'environment' }],
      sessions: { web: { surface: 'web', executor: { kind: 'playwright', browser: 'chromium' }, state: 'closed' } }, explanation: 'Measured evidence.',
      durationMs: 7, aiCalls: 2, baselineFirstFailureIndex: 0, finalFirstFailureIndex: 0,
      stage3Error: undefined, finalReplayError: undefined,
      repairTrace: [{ stage: 'stage1', stepId: 'repair-me', outcome: 'not-eligible', reason: 'mode-none' }],
    };
    const outcome: HealOutcome = { results: [result], errors: [], noTestsFound: false, listed: [], skipped: [], interrupted: false };
    const before = structuredClone(outcome);
    const settled = settleDryRunOutcome(outcome);
    expect(settled).toStrictEqual({ ...outcome, results: [{ ...result, application, stopReason: expectedStop }] });
    expect(outcome).toStrictEqual(before);
    expect(settled.errors).toBe(outcome.errors);
    expect(settled.results[0]!.steps).toBe(result.steps);
    expect(settled.results[0]!.repairTrace).toBe(result.repairTrace);
  });
});
