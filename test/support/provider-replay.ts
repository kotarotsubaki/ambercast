import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { CommandRunner, CommandRunResult } from '#adapters/ai/shared/command-runner.js';
import { createClaudeCodeCliExecutor } from '#adapters/ai/claude-code-cli/index.js';
import { createCodexCliExecutor } from '#adapters/ai/codex-cli/index.js';
import type { AiExecuteRequest, AiExecuteResult, InstructionCoveredAiExecutor } from '#ports/ai.js';
import { createFakeCommandRunner, type FakeCommandRunCall, type FakeCommandRunScript } from '../doubles/create-fake-command-runner.js';
import { ProviderFixtureValue, type ProviderFixture } from './provider-fixture.js';

/** Bounds uncancelled hangs so a broken cancellation path fails visibly. */
export const HANG_GUARD_MS = 10000;
/** Allows started scripts to settle before harness cleanup intervenes. */
export const SETTLE_SLACK_MS = 3000;
/** Bounds resource release after the harness cancels overdue scripts. */
export const CLEANUP_WINDOW_MS = 1000;

/** A single-use fixture transport with observable calls and bounded cleanup. */
export type FixtureCommandRunner = {
  run: CommandRunner;
  readonly calls: readonly FakeCommandRunCall[];
  assertClean(): Promise<{ notes: readonly string[] }>;
};

/**
 * Replays validated fixtures in invocation order without spawning a provider.
 * Protocol mismatches are retained until cleanup so adapter wrapping cannot
 * conceal harness failures. Cleanup waits for internal scripts, checks Codex
 * temporary directories, and gives harness violations precedence over provider
 * outcomes. Unconsumed hangs are permitted only after a started caller aborts.
 * Concurrent cleanup calls share one promise; calls made after cleanup begins
 * reject. Fixtures and caller signals remain unchanged.
 * @param fixtures - One fixture per expected command invocation, revalidated here.
 * @param options - Optional hang guard and script-settlement deadline in milliseconds.
 * @returns A single-use runner whose cleanup reports early-abort notes.
 * @throws Error when hangGuardMs is not an integer in 1..60000.
 * Zod validation errors for malformed fixtures; cleanup rejects with an
 * aggregated replay Error for protocol, resource, or invocation-count failures.
 */
export function createFixtureCommandRunner(fixtures: readonly ProviderFixture[], options?: { hangGuardMs?: number; deadlineMs?: number }): FixtureCommandRunner {
  const hangGuardMs = options?.hangGuardMs ?? HANG_GUARD_MS;
  if (!Number.isInteger(hangGuardMs) || hangGuardMs < 1 || hangGuardMs > 60000) throw new Error('replay: hangGuardMs must be an integer in 1..60000');
  const values = fixtures.map(fixture => ProviderFixtureValue.parse(fixture));
  const problems: string[] = [];
  const directories = new Set<string>();
  const cleanup = new AbortController();
  const started: { promise: Promise<CommandRunResult>; settled: boolean; callerSignal: AbortSignal | undefined }[] = [];
  let cleaning = false;
  let cleanPromise: Promise<{ notes: readonly string[] }> | undefined;

  /** Aggregation prevents adapters from disguising transport-test failures. */
  function harnessError(): Error {
    return new Error(`replay: ${problems.length} problem(s)\n${problems.map(problem => `- ${problem}`).join('\n')}`);
  }

  /**
   * One exit releases both timer and listener, including pre-aborted entry.
   * Caller cancellation and harness cleanup share wait mechanics but only the
   * original caller signal is retained for early-termination eligibility.
   */
  function waitUntilAborted(signal: AbortSignal, ms: number | undefined): Promise<void> {
    return new Promise((resolve, reject) => {
      let finished = false;
      /** All terminal paths converge here so normal expiry also frees listeners. */
      function finish(error?: unknown): void {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        if (error === undefined) resolve();
        else reject(error);
      }
      /** Cancellation preserves the reason selected by the signal owner. */
      function onAbort(): void {
        finish(signal.reason ?? new DOMException('aborted', 'AbortError'));
      }
      const timer = setTimeout(() => {
        if (ms === undefined) {
          const message = 'replay: hang fixture was never aborted';
          problems.push(message);
          finish(new Error(message));
        } else finish();
      }, ms ?? hangGuardMs);
      timer.unref?.();
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
  }

  /**
   * Bounded settlement clears its losing timer immediately. Deadline handling
   * runs in the timer callback itself, before any later promise can settle.
   */
  async function within(work: Promise<unknown>, ms: number, onDeadline: () => void): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([work, new Promise<void>(resolve => {
        timer = setTimeout(() => { onDeadline(); resolve(); }, ms);
        timer.unref?.();
      })]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  const scripts: FakeCommandRunScript[] = values.map(fixture => call => {
    /** Protocol checks precede effects; mismatches resolve harmlessly for adapters. */
    async function replayScript(): Promise<CommandRunResult> {
      const expected = fixture.provider === 'claude-code-cli' ? 'claude' : 'codex';
      const outputIndex = call.args.indexOf('-o');
      const outputPath = outputIndex < 0 ? undefined : call.args[outputIndex + 1];
      const harmless: CommandRunResult = { outcome: 'exited', exitCode: 0, stdout: '', stderr: '' };
      if (call.command !== expected) {
        problems.push(`fixture provider ${fixture.provider} but command ${call.command}`);
        return harmless;
      }
      if (fixture.provider === 'claude-code-cli' ? call.args[0] !== '-p' : call.args[0] !== 'exec' || !outputPath) {
        problems.push(`invalid ${call.command} command protocol`);
        return harmless;
      }
      if (fixture.provider === 'codex-cli') directories.add(dirname(outputPath!));
      const signal = call.options?.signal === undefined ? cleanup.signal : AbortSignal.any([call.options.signal, cleanup.signal]);
      if ('hang' in fixture.run) {
        if (call.options?.signal === undefined) {
          const message = 'hang fixture requires an AbortSignal';
          problems.push(message);
          throw new Error(message);
        }
      }
      try {
        if ('hang' in fixture.run) await waitUntilAborted(signal, undefined);
        else if (fixture.delayMs > 0) await waitUntilAborted(signal, fixture.delayMs);
      } catch (error) {
        if (!signal.aborted && !(error instanceof Error && error.message === 'replay: hang fixture was never aborted')) {
          problems.push('fixture wait failed');
        }
        throw error;
      }
      if (fixture.outputFile !== undefined) {
        try { await writeFile(outputPath!, fixture.outputFile, 'utf8'); }
        catch (error) {
          problems.push('could not write fixture output file');
          throw error;
        }
      }
      if ('exitCode' in fixture.run) return { outcome: 'exited', stdout: fixture.stdout, stderr: fixture.stderr, exitCode: fixture.run.exitCode };
      if ('signal' in fixture.run) return { outcome: 'signaled', stdout: fixture.stdout, stderr: fixture.stderr, signal: fixture.run.signal };
      throw new Error('replay: hang fixture was never aborted');
    }
    const record = { promise: replayScript(), settled: false, callerSignal: call.options?.signal };
    started.push(record);
    // Observe both outcomes without replacing the script promise used by cleanup.
    void record.promise.then(() => { record.settled = true; }, () => { record.settled = true; });
    return record.promise;
  });
  const fake = createFakeCommandRunner(scripts);

  /** Only started scripts qualify for caller-abort exemption; skipped slots do not. */
  async function finishCleanup(): Promise<{ notes: readonly string[] }> {
    const all = Promise.allSettled(started.map(record => record.promise));
    let expired = false;
    await within(all, options?.deadlineMs ?? SETTLE_SLACK_MS, () => {
      const unsettled = started.filter(record => !record.settled);
      expired = unsettled.length > 0;
      for (const record of unsettled) problems.push(`unsettled script ${started.indexOf(record) + 1} at cleanup deadline`);
      cleanup.abort(new Error('replay: cleanup deadline exceeded'));
    });
    if (expired) {
      await within(all, CLEANUP_WINDOW_MS, () => {
        for (const record of started.filter(record => !record.settled)) problems.push(`unsettled script ${started.indexOf(record) + 1} after cleanup window`);
      });
    }
    const notes: string[] = [];
    if (fake.calls.length !== values.length) {
      const remaining = values.slice(fake.calls.length);
      if (fake.calls.length < values.length && remaining.every(fixture => 'hang' in fixture.run) && started.some(record => record.callerSignal?.aborted)) {
        notes.push(`${remaining.length} unconsumed hang fixture(s) after caller abort`);
      } else problems.push(`calls ${fake.calls.length} but fixtures ${values.length}`);
    }
    for (const directory of directories) {
      if (existsSync(directory)) problems.push('codex temporary directory remains');
    }
    if (problems.length > 0) throw harnessError();
    return { notes };
  }

  return {
    calls: fake.calls,
    run(command, args, callOptions) {
      if (cleaning) {
        problems.push('run called while cleaning');
        return Promise.reject(harnessError());
      }
      return fake.run(command, args, callOptions);
    },
    assertClean() {
      if (cleanPromise === undefined) {
        cleaning = true;
        cleanPromise = finishCleanup();
      }
      return cleanPromise;
    },
  };
}

/**
 * Selects the real structured-output adapter while injecting a hermetic transport.
 * Provider protocol interpretation stays owned by the production adapter.
 * @param provider - The fixture's provider identity.
 * @param run - The command seam that supplies recorded output.
 * @returns The corresponding real adapter without invoking availability probes.
 */
export function createAdapterFor(provider: ProviderFixture['provider'], run: CommandRunner): InstructionCoveredAiExecutor {
  return provider === 'claude-code-cli' ? createClaudeCodeCliExecutor({ run }) : createCodexCliExecutor({ run });
}

/**
 * Executes a fixture through its real adapter and awaits cleanup on either outcome.
 * Harness violations outrank adapter failures; otherwise the adapter's original
 * result or rejection is preserved. The runner bounds waits, so this layer adds
 * no outer timeout. Supply a fresh runner when observing cancellation or calls.
 * @param fixture - The provider output to replay.
 * @param request - The structured request and optional caller cancellation.
 * @param runner - An optional single-use runner, defaulting to this one fixture.
 * @returns The adapter's validated response.
 * @throws A harness violation, or the original adapter rejection after clean settlement.
 */
export async function replayExecute<T>(fixture: ProviderFixture, request: AiExecuteRequest<T>, runner = createFixtureCommandRunner([fixture])): Promise<AiExecuteResult<T>> {
  const validated = ProviderFixtureValue.parse(fixture);
  const executor = createAdapterFor(validated.provider, runner.run);
  const [outcome] = await Promise.allSettled([executor.execute(request)]);
  await runner.assertClean();
  if (outcome!.status === 'rejected') throw outcome!.reason;
  return outcome!.value;
}

/**
 * Supplies repeated invocations without changing or cloning fixture data.
 * @param fixture - The immutable replay input shared by all entries.
 * @param n - A positive integer invocation count.
 * @returns A fresh array containing the same fixture reference in every slot.
 * @throws Error when the count is not an integer of at least one.
 */
export function repeatFixture(fixture: ProviderFixture, n: number): ProviderFixture[] {
  if (!Number.isInteger(n) || n < 1) throw new Error('replay: repeatFixture n must be an integer >= 1');
  return Array.from({ length: n }, () => fixture);
}

import type { HealOutcome } from '#usecases/heal.js';
import type { SettledHealOutcome } from '#usecases/heal-report.js';
import type { ExitCode } from '#core/errors/types.js';
import type { ReportEnvelope } from '#report/schema.js';
import { generate } from '#usecases/generate.js';
import { buildGenerateReport } from '#usecases/generate-report.js';
import { computeAccessibilityFingerprint } from '#core/ir/fingerprint.js';
import { Step } from '#core/ir/schema.js';
import { run } from '#usecases/run.js';
import { buildRunReport } from '#usecases/run-report.js';
import { heal } from '#usecases/heal.js';
import { buildHealReport } from '#usecases/heal-report.js';
import * as generateScenario from './generate-scenario.js';
import * as healScenario from './heal-scenario.js';
import * as runScenario from './run-scenario.js';
import { createFakeUiExecutor } from '../doubles/fake-ui-executor.js';

/**
 * Projects measured healing into preview-only reporting without committing.
 * All evidence is preserved; only application and the no-change stop reason
 * are settled.
 * @remarks
 * ponytail: this deliberately copies settleHealOutcome's dry-run branch,
 * rather than detecting runtime drift. Production sources are outside #546;
 * actual drift needs a separate issue exporting the production function.
 */
export function settleDryRunOutcome(outcome: HealOutcome): SettledHealOutcome {
  return { ...outcome, results: outcome.results.map(result => {
    switch (result.repairOutcome) {
      case 'unresolved': return { ...result, application: result.stopReason === 'deadline' ? 'not-eligible' : 'no-artifact-change' };
      case 'no-changes-needed': return { ...result, application: 'no-artifact-change', stopReason: 'settled' };
      case 'healed':
      case 'partially-healed': return { ...result, application: 'preview-only' };
    }
  }) };
}

type UseCaseReplayInput = { useCase: 'generate' | 'heal' | 'run'; fixtures: readonly ProviderFixture[]; aiTimeoutMs?: number; maxAttempts?: number };
type UseCaseReplayResult = { report: ReportEnvelope; exitCode: ExitCode; calls: readonly FakeCommandRunCall[] };

/**
 * Replays provider output through an isolated production use case and report.
 * Inputs are checked before scenario startup. Each invocation owns fresh
 * storage and a runner; cleanup failures outrank use-case outcomes on every
 * exit, including expiration of the fixture-count-based settlement window.
 * @throws Error for invalid inputs, harness violations, or an unsettled use case.
 */
export async function replayThroughUseCase(input: UseCaseReplayInput): Promise<UseCaseReplayResult> {
  if (input.fixtures.length === 0) throw new Error('replay: fixtures is empty');
  if (input.fixtures.some(fixture => fixture.provider !== input.fixtures[0]!.provider)) throw new Error('replay: fixtures mix providers');
  const aiTimeoutMs = input.aiTimeoutMs ?? 5000;
  if (!Number.isInteger(aiTimeoutMs) || aiTimeoutMs < 1 || aiTimeoutMs > 600000) throw new Error('replay: aiTimeoutMs must be an integer in 1..600000');
  if (input.useCase !== 'generate' && input.maxAttempts !== undefined) throw new Error('replay: maxAttempts applies to generate only');
  const maxAttempts = input.maxAttempts ?? 2;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) throw new Error('replay: maxAttempts must be an integer in 1..10');
  switch (input.useCase) {
    case 'generate': return replayGenerate(input.fixtures, aiTimeoutMs, maxAttempts);
    case 'heal': return replayHeal(input.fixtures, aiTimeoutMs);
    case 'run': return replayRun(input.fixtures, aiTimeoutMs);
  }
}

const REPLAY_REPORT_CONTEXT = { startedAt: '2026-10-10T00:00:00Z', durationMs: 0 };

/**
 * Blocks agentic work before request access can start MCP or browser effects.
 * Cleanup retains the violation even when a use case handles the rejection.
 */
function createUseCaseAdapter(provider: ProviderFixture['provider'], runner: FixtureCommandRunner): InstructionCoveredAiExecutor {
  const adapter = createAdapterFor(provider, runner.run);
  let agenticAttempted = false;
  const assertClean = runner.assertClean;
  runner.assertClean = async () => {
    const outcome = await Promise.allSettled([assertClean()]);
    const result = outcome[0]!;
    if (agenticAttempted) {
      const summary = result.status === 'rejected' ? `\n${result.reason instanceof Error ? result.reason.message : String(result.reason)}` : '';
      throw new Error(`replay: agentic execution is out of scope${summary}`);
    }
    if (result.status === 'rejected') throw result.reason;
    return result.value;
  };
  return {
    name: adapter.name,
    execute: adapter.execute,
    isAvailable: adapter.isAvailable,
    executeAgentic: async () => {
      agenticAttempted = true;
      throw new Error('replay: agentic execution is out of scope');
    },
  };
}

/**
 * Uses one settlement bound for transport cleanup and use-case patience.
 * Observing both promise outcomes keeps late rejection handled after a timeout;
 * the losing timer is always released before cleanup decides failure priority.
 */
async function settleUseCase<T>(work: Promise<T>, runner: FixtureCommandRunner, settleWindowMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = work.then(value => ({ kind: 'resolved' as const, value }), error => ({ kind: 'rejected' as const, error }));
  const outcome = await Promise.race([settled, new Promise<{ kind: 'expired' }>(resolve => {
    timer = setTimeout(() => resolve({ kind: 'expired' }), settleWindowMs);
  })]).finally(() => { if (timer !== undefined) clearTimeout(timer); });
  if (outcome.kind === 'expired') {
    let summary = '';
    try { await runner.assertClean(); } catch (error) { summary = `\n${error instanceof Error ? error.message : String(error)}`; }
    throw new Error(`replay: the use case did not settle${summary}`);
  }
  await runner.assertClean();
  if (outcome.kind === 'rejected') throw outcome.error;
  return outcome.value;
}

/** Fresh prompt storage makes retries and report identity independent per replay. */
async function replayGenerate(fixtures: readonly ProviderFixture[], aiTimeoutMs: number, maxAttempts: number): Promise<UseCaseReplayResult> {
  const settleWindowMs = fixtures.length * aiTimeoutMs + SETTLE_SLACK_MS;
  // ponytail: capped at the existing 1..60000 hangGuardMs bound (SPEC-4); aiTimeoutMs beyond ~57s can still trip the guard first, widen if that range is ever exercised.
  const hangGuardMs = Math.min(60000, Math.max(HANG_GUARD_MS, aiTimeoutMs + SETTLE_SLACK_MS));
  const runner = createFixtureCommandRunner(fixtures, { hangGuardMs, deadlineMs: settleWindowMs });
  const executor = createUseCaseAdapter(fixtures[0]!.provider, runner);
  const { deps } = generateScenario.createScenario({ resolveAiExecutor: async () => executor });
  const timedDeps = { ...deps, config: { ...deps.config, ai: { ...deps.config.ai, timeoutMs: aiTimeoutMs } } };
  await generateScenario.writePrompt(deps.storage);
  const options = { ...generateScenario.DEFAULT_OPTIONS, maxAttempts };
  const outcome = await settleUseCase(generate(timedDeps, options), runner, settleWindowMs);
  const built = buildGenerateReport({ ...REPLAY_REPORT_CONTEXT, options, outcome });
  return { report: built.envelope, exitCode: built.exitCode, calls: runner.calls };
}

/** The invalid navigation reproduces the existing Stage-2-triggering scenario. */
async function replayHeal(fixtures: readonly ProviderFixture[], aiTimeoutMs: number): Promise<UseCaseReplayResult> {
  const settleWindowMs = fixtures.length * aiTimeoutMs + SETTLE_SLACK_MS;
  // ponytail: capped at the existing 1..60000 hangGuardMs bound (SPEC-4); aiTimeoutMs beyond ~57s can still trip the guard first, widen if that range is ever exercised.
  const hangGuardMs = Math.min(60000, Math.max(HANG_GUARD_MS, aiTimeoutMs + SETTLE_SLACK_MS));
  const runner = createFixtureCommandRunner(fixtures, { hangGuardMs, deadlineMs: settleWindowMs });
  const { deps } = await healScenario.createScenario({ steps: [Step.parse({ id: 'repair-me', kind: 'action', target: 'web', action: 'navigate', url: 'http://[' })], grounding: {} });
  const executor = createUseCaseAdapter(fixtures[0]!.provider, runner);
  const timedDeps = { ...deps, resolveAiExecutor: async () => executor,
    config: { ...deps.config, ai: { ...deps.config.ai, timeoutMs: aiTimeoutMs } },
  };
  const options = { ...healScenario.OPTIONS, dryRun: true };
  const batch = await settleUseCase(heal(timedDeps, options), runner, settleWindowMs);
  // Generic hang exemptions support early aborts, but must not mask a dropped
  // Stage 3 call. SPEC-7 fixes heal at two calls, enforced by this driver.
  if (runner.calls.length !== 2) throw new Error(`replay: heal fixtures must produce exactly 2 calls (Stage 2 + Stage 3), observed ${runner.calls.length}`);
  const built = buildHealReport({ ...REPLAY_REPORT_CONTEXT, options, outcome: settleDryRunOutcome(batch.outcome) });
  return { report: built.envelope, exitCode: built.exitCode, calls: runner.calls };
}

/** A first binding with live evidence exercises structured AI resolution only. */
async function replayRun(fixtures: readonly ProviderFixture[], aiTimeoutMs: number): Promise<UseCaseReplayResult> {
  const settleWindowMs = fixtures.length * aiTimeoutMs + SETTLE_SLACK_MS;
  // ponytail: capped at the existing 1..60000 hangGuardMs bound (SPEC-4); aiTimeoutMs beyond ~57s can still trip the guard first, widen if that range is ever exercised.
  const hangGuardMs = Math.min(60000, Math.max(HANG_GUARD_MS, aiTimeoutMs + SETTLE_SLACK_MS));
  const runner = createFixtureCommandRunner(fixtures, { hangGuardMs, deadlineMs: settleWindowMs });
  const tree = { role: 'root', name: '', children: [{ role: 'button', name: 'Submit', children: [] }] };
  const fingerprint = computeAccessibilityFingerprint(tree, runScenario.SUBMIT, []);
  if (fingerprint.kind !== 'ok') throw new Error('replay: the Submit fixture is not fingerprintable');
  const session = runScenario.createFakeBrowserSession(runScenario.liveEntries([runScenario.SUBMIT], fingerprint.fingerprint));
  session.accessibilitySnapshot = async () => ({ tree, rawYaml: 'Submit', scalarValues: [] });
  const executor = createUseCaseAdapter(fixtures[0]!.provider, runner);
  const { deps } = runScenario.createScenario({
    resolveAiExecutor: async () => executor,
    uiExecutor: () => createFakeUiExecutor(() => session),
  });
  const timedDeps = { ...deps, config: { ...deps.config,
    ai: { ...deps.config.ai, timeoutMs: aiTimeoutMs },
    targets: { web: { ...runScenario.RESOLVED_TARGETS.web, resolveTimeoutMs: 0 } },
  } };
  const testPath = await runScenario.writePrompt(deps.storage);
  await runScenario.seedFreshArtifacts(deps.storage, testPath, [
    { id: 'click-submit', kind: 'action', target: 'web', action: 'click', intent: {
      description: 'Submit button', roleHint: 'button', sourceSpan: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 56 },
    } },
    { id: 'confirm-submit', kind: 'assert', check: 'text-visible', text: 'Done', confirms: ['click-submit'] },
  ]);
  const options = runScenario.DEFAULT_OPTIONS;
  const outcome = await settleUseCase(run(timedDeps, options), runner, settleWindowMs);
  const built = buildRunReport({ ...REPLAY_REPORT_CONTEXT, options, outcome });
  return { report: built.envelope, exitCode: built.exitCode, calls: runner.calls };
}

