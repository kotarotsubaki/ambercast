/**
 * Declares healing command composition between CLI parsing and the healing
 * usecase's confirmation, commit, and reporting boundaries.
 *
 * The command keeps candidate measurement separate from persistence: the
 * usecase returns buffered commit capabilities, and this runtime owns the
 * caller authorization required before any capability is invoked.
 */

import { AI_EXECUTOR_FACTORIES } from '#adapters/ai/registry.js';
import { createSpawnCommandRunner } from '#adapters/ai/shared/command-runner.js';
import { createUiExecutorResolver } from '#adapters/browser/registry.js';
import { createFsStorage } from '#adapters/storage/fs-storage.js';
import { createRunsDirContainedStorage } from '#adapters/storage/runs-dir-contained-storage.js';
import { createConfirmationAnswerReader, type ConfirmationAnswer, type ConfirmationAnswerReader } from '#adapters/system/confirmation-answer-reader.js';
import { createCryptoRandom } from '#adapters/system/crypto-random.js';
import { createEnvSecretsProvider } from '#adapters/system/env-secrets-provider.js';
import { createProcessEnvironmentInfo } from '#adapters/system/process-environment-info.js';
import { createFanOutEventSink } from '#adapters/system/fan-out-event-sink.js';
import { createStderrProgressSink } from '#adapters/system/stderr-progress-sink.js';
import { readCommandEnvironment } from '#adapters/system/process-command-environment.js';
import { readConfigEnvironment } from '#adapters/system/process-config-environment.js';
import { createSystemClock } from '#adapters/system/system-clock.js';
import { createTtyInteractivityCheck } from '#adapters/system/tty-interactivity.js';
import { loadConfig } from '#config/load.js';
import { ConfigInvalidError } from '#core/errors/config-invalid-error.js';
import { createCallIdAllocator } from '#core/ai/call-id-allocator.js';
import { FsIoError } from '#core/errors/fs-io-error.js';
import { IntegrityViolationError } from '#core/errors/integrity-violation-error.js';
import { isAbsolutePath, joinPath } from '#core/paths.js';
import { AmbercastError, type ExitCode } from '#core/errors/types.js';
import { UnexpectedCrashError } from '#core/errors/unexpected-crash-error.js';
import { heal, type HealBatchResult } from '#usecases/heal.js';
import { buildHealReport, type SettledHealOutcome } from '#usecases/heal-report.js';
import type { FinalizedReportEnvelope } from '#usecases/report-finalization.js';
import { finalizeReportEnvelope, isEmergencyFinalizedEnvelope } from '#usecases/report-finalization.js';
import { createAmbercast } from './create-ambercast.js';
import { resolveAiProvider } from './resolve-ai-provider.js';

import type {
  HealCaseCommit,
  HealCommitOutcome,
  HealDeps,
  HealOutcome,
} from '#usecases/heal.js';

import type { EventSink } from '#ports/system.js';

function reportTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function runIdFor(startedAt: string, uuid: string): string {
  return `${startedAt.replaceAll(':', '')}-${uuid}`;
}

/**
 * CLI flags accepted by the healing command.
 *
 * `json` remains a CLI rendering choice, while every other field maps to
 * command composition or the healing usecase. `yes` represents both
 * `--yes` and its `-y` alias.
 */
export interface HealCommandFlags {
  /** Whether candidate plan and grounding writes remain uncommitted. */
  readonly dryRun: boolean;

  /** Whether pending candidate writes are authorized without prompting. */
  readonly yes: boolean;

  /** Whether the CLI renders the returned report as JSON. */
  readonly json: boolean;


  /** Optional provider override used only when healing needs AI work. */
  readonly aiProviderOverride?: 'claude' | 'codex';

  /** Whether an empty discovered selection is a successful outcome. */
  readonly allowEmpty: boolean;

  /** Whether healing returns selected identities without attempting repair. */
  readonly list: boolean;
}

/**
 * Parsed data supplied by the CLI to the healing runtime.
 *
 * File paths remain literal until command composition makes them absolute,
 * following `run-command.ts`'s established `isAbsolutePath`/`joinPath`
 * against `cwd` precedent. Cancellation spans the complete invocation,
 * including confirmation and commit settlement.
 */
export type HealCommandInput = Omit<HealCommandFlags, 'json'> & {
  /** Literal prompt paths, or an empty list for configured discovery. */
  readonly files: readonly string[];

  /** Current project directory used for configuration selection. */
  readonly cwd: string;

  /** Stream injected by the CLI for progress only; sink cleanup always applies to this exact stream. */
  readonly stderr: NodeJS.WritableStream;

  /** Optional caller cancellation propagated to healing. */
  readonly signal?: AbortSignal;

  /**
   * Receives healing lifecycle events alongside the default stderr progress
   * stream. Omitting it preserves the existing stderr output byte for byte.
   *
   * @remarks
   * The caller owns this sink and its lifetime. Fan-out permits an adapter,
   * including an MCP progress reporter, to subscribe without teaching this
   * runtime about its transport. Check is read-only and needs no external
   * progress subscription, so its command input has no matching field.
   */
  readonly events?: EventSink;
};

/**
 * Runtime capabilities required in addition to the healing usecase surface.
 *
 * `HealDeps` supplies storage, clock, configuration, CI state, discovery,
 * execution ports, and interruption wiring. This command-specific seam makes
 * interactive availability explicit so confirmation policy is testable without
 * relying on a process TTY.
 */
export interface HealCommandDeps extends HealDeps {
  /** Returns whether a confirmation prompt can be presented to this caller. */
  readonly isInteractive: () => boolean;

  /**
   * Obtains authorization for the supplied pending commit capabilities after
   * confirmation policy has decided that an interactive exchange is needed.
   */
  readonly readConfirmationAnswer: ConfirmationAnswerReader;
}

/**
 * Confirmation state after runtime policy has decided whether asking is needed.
 *
 * `not-required` is added above the terminal adapter because empty commits and
 * dry runs are runtime policy outcomes rather than user input. `--yes` is
 * separately represented as runtime-produced `authorized`.
 */
export type HealConfirmationOutcome = ConfirmationAnswer | 'not-required';

/**
 * Settled result of applying one authorized case commit capability.
 *
 * The case identifier associates a failed commit with the result row that
 * remains in the final report alongside its matching case-scoped error.
 */
export interface HealCommitSettlement {
  /** Stable case identity used as the key in `HealBatchResult.commits`. */
  readonly caseId: string;

  /** Capability that was authorized for this case. */
  readonly commit: HealCaseCommit;

  /** Persistence result reported by the case-local commit capability. */
  readonly result: HealCommitOutcome;
}

/**
 * Rendering-neutral result returned by the healing runtime.
 *
 * The envelope is produced once after authorization and every authorized
 * commit has settled, so a failed commit keeps its own result row and adds a
 * matching case-scoped error before report construction.
 */
export interface HealCommandOutput {
  /**
   * Process status selected by `buildHealReport`'s final report policy.
   * That selection incorporates `stage3Error` and `finalReplayError`; an
   * emergency finalization fallback alone replaces it with exit code 3.
   */
  readonly exitCode: ExitCode;

  /** Structured report for either JSON serialization or text rendering. */
  readonly envelope: FinalizedReportEnvelope;
}

/**
 * Measured healing candidates and the separate authority to settle them.
 *
 * @remarks
 * A caller can inspect whether any write is possible and which cases would
 * change before requesting consent. This boundary serves callers that need a
 * preview and later approval, while the CLI can retain its own interactive
 * confirmation policy over the same measured candidates. Measurement must
 * not itself authorize persistence. The returned object retains pending
 * commit capabilities privately; exposing only summaries prevents a caller
 * from committing a case outside the single settlement boundary.
 */
export interface HealPreparation {
  /**
   * Builds a report of measured changes without applying them.
   *
   * @returns A rendering-neutral preview report for consent or inspection.
   * @remarks
   * Preview performs no persistence and remains callable repeatedly, even
   * after settlement. A caller may need to retrieve the measured result again
   * while presenting or recording an approval decision; reading it never
   * consumes the authority to settle. Each call returns the same snapshot
   * fixed during measurement, regardless of whether settlement later runs or
   * succeeds. Purity includes both the absence of side effects and this
   * stable result.
   */
  preview(): HealCommandOutput;

  /**
   * Resolves the measured candidates under one explicit authorization.
   *
   * @param authorization - Whether the caller approved, declined, or was
   * interrupted before applying pending changes.
   * @returns The final report after the authorized commits have settled, or
   * after the non-applying decision has been recorded.
   * @remarks
   * Settlement is one-shot even when authorization declines or interrupts:
   * accepting a second decision could apply the same buffered writes twice
   * or rewrite an already reported outcome. A second call fails with
   * `UnexpectedCrashError`; preview remains available afterward. The decision
   * is consumed synchronously as the first step of the call, before any await,
   * so even near-simultaneous calls observe the consumed state in JavaScript's
   * single-threaded execution model. Individual commit failures become
   * case-scoped results in the final envelope rather than rejecting settle;
   * the no-interruption guarantee after settlement starts concerns aborting
   * the whole settlement, including by signal, not a failed case commit.
   */
  settle(authorization: 'authorized' | 'declined' | 'interrupted'): Promise<HealCommandOutput>;

  /** Whether consent could lead to at least one artifact write. */
  readonly hasCommits: boolean;

  /**
   * Case identities, files, and repair summaries available before consent.
   * These describe prospective changes without exposing commit capabilities.
   */
  readonly cases: readonly { readonly caseId: string; readonly file: string; readonly healingSummary: string }[];
}

/**
 * Requests authorization to persist the listed pending healing candidates.
 *
 * @param commits - Case-local capabilities represented only by their prompt
 * file and neutral repair summary.
 * @returns The explicit authorization state for every supplied capability.
 * @remarks
 * Confirmation describes the concrete files and repair kinds pending
 * persistence, while deliberately excluding internal stage identity. The
 * report-neutrality rule applies to this user-facing text as well: numbered
 * implementation stages must not become a wording contract merely because a
 * terminal is interactive. This helper decides only whether confirmation is
 * needed; when it is, the command's constructed answer reader performs the
 * short exchange. Empty commits and dry runs are not promptable, while `--yes`
 * is pre-authorization; those policy branches return explicit values without
 * consulting the adapter. The adapter itself has only three values so it
 * cannot claim the policy-owned no-prompt state and accidentally authorize a
 * write. Non-interactive callers still receive the existing configuration
 * error rather than a fifth confirmation outcome.
 */
export async function promptForHealConfirmation(
  commits: ReadonlyMap<string, Pick<HealCaseCommit, 'file' | 'healingSummary'>>,
  input: Pick<HealCommandInput, 'dryRun' | 'yes' | 'signal'>,
  deps: Pick<HealCommandDeps, 'isCI' | 'isInteractive' | 'readConfirmationAnswer'>,
): Promise<HealConfirmationOutcome> {
  if (commits.size === 0 || input.dryRun) {
    return 'not-required';
  }

  if (input.yes) {
    return 'authorized';
  }

  if (deps.isCI || !deps.isInteractive()) {
    throw new ConfigInvalidError('Healing requires --yes when confirmation cannot be shown.');
  }

  if (input.signal?.aborted === true) {
    return 'interrupted';
  }

  const candidates = new Map(
    [...commits].map(([caseId, { file, healingSummary }]) => [caseId, { file, healingSummary }]),
  );
  return deps.readConfirmationAnswer(candidates, input.signal);
}

/**
 * Produces report-ready outcomes after confirmation and commit settlement.
 *
 * @param outcome - The measured outcome returned by the healing usecase.
 * @param confirmation - The explicit policy or adapter confirmation outcome.
 * @param dryRun - Whether runtime policy intentionally withheld all commits.
 * @param settlements - Results of commit capabilities attempted after authorization.
 * @returns A distinct settled outcome with mandatory report application facts.
 * @remarks
 * The mapping is total and preserves the measurement-owned `stopReason`.
 * `no-changes-needed` is always `'settled'` because its loop never starts.
 * A row without a commit capability retains `no-artifact-change`; in
 * particular, an unresolved row that reached Stage 3 can retain either
 * `'settled'` or `'attempt-limit'` without being reclassified by settlement.
 * A batch-level confirmation for other rows has no effect on these rows:
 *
 * | Measured repair outcome | Per-case settlement | Application |
 * | --- | --- | --- |
 * | no commit capability | absent | `no-artifact-change` |
 *
 * For every commit-capable `healed` or `partially-healed` row, the remaining
 * confirmation and settlement combinations are exhaustive:
 *
 * | Confirmation | `dryRun` | Per-case settlement | Application |
 * | --- | --- | --- |
 * | `not-required` | `true` | absent | `preview-only` |
 * | `authorized` | `false` | `committed` | `applied` |
 * | `authorized` | `false` | `failed`, `partiallyWritten` empty | `apply-failed` |
 * | `authorized` | `false` | `failed`, `partiallyWritten` non-empty | `partially-applied` |
 * | `declined` | `false` | absent | `declined` |
 * | `interrupted` | `false` | absent | `not-applied-interrupted` |
 *
 * The function throws `UnexpectedCrashError` for every omitted combination:
 * a settlement for `no-changes-needed`, `unresolved`, preview-only, declined,
 * or interrupted; `not-required` with `dryRun: false`; any non-
 * `not-required` confirmation with `dryRun: true`; a missing, duplicate, or
 * wrong-case settlement for an authorized commit-capable row; or an untyped
 * settlement result. The explicit `dryRun` argument distinguishes preview-only
 * from the invalid non-dry-run no-settlement state; confirmation and
 * settlement count alone cannot do so. Confirmation interruption is ORed into
 * the settled batch interruption flag because `heal()` returned before the
 * terminal exchange began. Failed commits retain their rows and add matching
 * case-scoped errors without collapsing an integrity refusal into an
 * execution-environment failure: integrity failures remain
 * `INTEGRITY_VIOLATION`, while genuine persistence failures remain
 * `FS_IO_ERROR`. The error itself must carry `details.partiallyWritten` from
 * its `HealCommitOutcome`, because report mapping reads the error details
 * rather than the settlement wrapper. Other structured details from the
 * underlying classified error remain available, while the outcome's
 * partial-write evidence authoritatively replaces any stale value carried by
 * that error.
 */
function settleHealOutcome(
  outcome: HealOutcome,
  confirmation: HealConfirmationOutcome,
  dryRun: boolean,
  commitCaseIds: ReadonlySet<string>,
  settlements: readonly HealCommitSettlement[],
): SettledHealOutcome {
  function unexpected(reason: string): never {
    throw new UnexpectedCrashError(`Healing settlement invariant failed: ${reason}`);
  }
  const settlementsByCaseId = new Map<string, HealCommitSettlement>();
  for (const settlement of settlements) {
    if (settlementsByCaseId.has(settlement.caseId)) {
      unexpected(`duplicate settlement for ${settlement.caseId}`);
    }
    settlementsByCaseId.set(settlement.caseId, settlement);
  }

  const resultIds = new Set(outcome.results.map(({ id }) => id));
  const commitCapableIds = new Set(outcome.results
    .filter(({ repairOutcome }) => repairOutcome === 'healed' || repairOutcome === 'partially-healed')
    .map(({ id }) => id));
  if (commitCaseIds.size !== commitCapableIds.size || [...commitCaseIds].some((caseId) => !commitCapableIds.has(caseId))) {
    unexpected('commit capabilities do not match commit-capable measured cases');
  }
  for (const [caseId, settlement] of settlementsByCaseId) {
    if (!resultIds.has(caseId) || settlement.commit.file !== caseId) {
      unexpected(`settlement does not match a measured case: ${caseId}`);
    }
  }

  if (dryRun && confirmation !== 'not-required') {
    unexpected('a dry run received a promptable confirmation outcome');
  }

  const commitErrors: Array<HealOutcome['errors'][number]> = [];
  const results = outcome.results.map((result) => {
    const settlement = settlementsByCaseId.get(result.id);
    switch (result.repairOutcome) {
      case 'no-changes-needed':
        if (settlement !== undefined) {
          unexpected(`${result.repairOutcome} case has a commit settlement: ${result.id}`);
        }
        return { ...result, application: 'no-artifact-change' as const, stopReason: 'settled' as const };
      case 'unresolved':
        if (settlement !== undefined) {
          unexpected(`${result.repairOutcome} case has a commit settlement: ${result.id}`);
        }
        return result.stopReason === 'deadline'
          ? { ...result, application: 'not-eligible' as const }
          : { ...result, application: 'no-artifact-change' as const };
      case 'healed':
      case 'partially-healed':
        switch (confirmation) {
          case 'not-required':
            if (!dryRun || settlement !== undefined) {
              unexpected(`non-preview ${result.repairOutcome} case lacks an authorized settlement: ${result.id}`);
            }
            return { ...result, application: 'preview-only' as const };
          case 'declined':
            if (settlement !== undefined) {
              unexpected(`declined ${result.repairOutcome} case has a commit settlement: ${result.id}`);
            }
            return { ...result, application: 'declined' as const };
          case 'interrupted':
            if (settlement !== undefined) {
              unexpected(`interrupted ${result.repairOutcome} case has a commit settlement: ${result.id}`);
            }
            return { ...result, application: 'not-applied-interrupted' as const };
          case 'authorized':
            if (dryRun) {
              unexpected(`authorized ${result.repairOutcome} case occurred during a dry run: ${result.id}`);
            }
            if (settlement === undefined) {
              unexpected(`authorized ${result.repairOutcome} case lacks a commit settlement: ${result.id}`);
            }
            if (settlement.result.outcome === 'committed') {
              return { ...result, application: 'applied' as const };
            }
            if (settlement.result.outcome === 'failed') {
              const partiallyWritten = settlement.result.partiallyWritten;
              if (!(settlement.result.error instanceof FsIoError
                || settlement.result.error instanceof IntegrityViolationError)
                || !Array.isArray(partiallyWritten)
                || !partiallyWritten.every((artifact) => artifact === 'plan' || artifact === 'grounding')) {
                return unexpected(`malformed failed settlement for ${result.id}`);
              }
              const persisted = partiallyWritten.length === 0 ? 'no artifacts' : partiallyWritten.join(' and ');
              const errorDetails = {
                ...(settlement.result.error.details ?? {}),
                partiallyWritten: [...partiallyWritten],
              };
              commitErrors.push({
                file: result.file,
                error: settlement.result.error instanceof IntegrityViolationError
                  ? new IntegrityViolationError(
                    `Healing artifacts could not be committed after persisting ${persisted}.`,
                    errorDetails,
                    { cause: settlement.result.error },
                  )
                  : new FsIoError(
                    `Healing artifacts could not be committed after persisting ${persisted}.`,
                    errorDetails,
                    { cause: settlement.result.error },
                  ),
              });
              return {
                ...result,
                application: partiallyWritten.length === 0 ? 'apply-failed' as const : 'partially-applied' as const,
              };
            }
            return unexpected(`unknown settlement outcome: ${String((settlement.result as { readonly outcome: unknown }).outcome)}`);
          default:
            return unexpected(`unknown confirmation outcome: ${String(confirmation)}`);
        }
      default:
        return unexpected(`unknown repair outcome: ${String(result.repairOutcome)}`);
    }
  });

  return {
    ...outcome,
    results,
    errors: [...outcome.errors, ...commitErrors],
    interrupted: outcome.interrupted || confirmation === 'interrupted',
  };
}

function finalizeHealOutput(built: ReturnType<typeof buildHealReport>, projectRoot: string): HealCommandOutput {
  const finalized = finalizeReportEnvelope(built.envelope, projectRoot);
  return { exitCode: isEmergencyFinalizedEnvelope(finalized) ? 3 : built.exitCode, envelope: finalized };
}

/**
 * Measures healing candidates and returns a preview and settlement capability.
 *
 * @param input - Selected prompts, command policy, project directory, and
 * optional cancellation and progress subscribers.
 * @returns Measured cases with a repeatable preview and one settlement choice.
 * @remarks
 * Separating measurement from settlement lets a two-stage caller present the
 * exact proposed repairs for approval before applying them. The CLI can use
 * the same preparation while retaining its interactive confirmation flow.
 * This phase does not treat `dryRun` or `yes` as write authority: neither
 * flag may commit a candidate during measurement. Pending commit capabilities
 * stay private until a caller makes the explicit settlement choice. Settlement
 * depends only on its authorization argument and never consults the original
 * `dryRun` input: `settle('authorized')` commits normally even for a dry-run
 * preparation. A dry-run caller must choose preview instead of settlement;
 * `runHealCommand` makes that choice by returning `preview()` without calling
 * `settle`.
 *
 * The command still applies its normal list short-circuit and CI healing
 * refusal at their established boundaries. Its eventual implementation
 * must preserve replay isolation and classify measurement failures into the
 * rendering-neutral command report contract rather than leaking raw errors.
 */
export async function prepareHeal(input: HealCommandInput): Promise<HealPreparation> {
  let projectRoot = input.cwd;
  const clock = createSystemClock();
  const startedAt = reportTimestamp(clock.now());
  const runId = runIdFor(startedAt, createCryptoRandom().uuid());
  const startedMs = clock.monotonicMs();
  const reportContext = () => ({
    startedAt,
    durationMs: Math.max(0, Math.round(clock.monotonicMs() - startedMs)),
    options: { allowEmpty: input.allowEmpty, list: input.list },
  });

  try {
    const storage = createFsStorage();
    const { resolved: config, source } = await loadConfig({
      cwd: input.cwd,
      storage,
      configEnv: readConfigEnvironment(),
    });
    projectRoot = config.projectRoot;
    const isCI = createProcessEnvironmentInfo().isCI();
    const uiExecutor = createUiExecutorResolver();
    const secrets = createEnvSecretsProvider();
    const stderrSink = createStderrProgressSink({
      command: 'heal',
      stderr: input.stderr,
      projectRoot: config.projectRoot,
      isCI,
      clock,
    });
    const events = input.events === undefined ? stderrSink : createFanOutEventSink([stderrSink, input.events]);
    const allocateCallId = createCallIdAllocator();
    try {
      const ambercast = createAmbercast({
        config,
        aiProvider: 'claude',
        uiExecutor,
        secrets,
        events,
      });
      const deps: HealDeps = {
        storage: ambercast.storage,
        containWrites: createRunsDirContainedStorage(ambercast.storage),
        layout: ambercast.layout,
        clock: ambercast.clock,
        allocateCallId,
        runId,
        uiExecutor,
        secrets,
        events,
        discoverTestFiles: ambercast.discoverTestFiles,
        config,
        configSource: source,
        isCI,
        resolveAiExecutor: (signal) => resolveAiProvider(
          config.ai.provider,
          input.aiProviderOverride,
          signal,
        ).then((provider) => AI_EXECUTOR_FACTORIES[provider]({
          run: createSpawnCommandRunner({ env: readCommandEnvironment() }),
        })),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      };
      const options = {
        files: input.files.map((file) => (isAbsolutePath(file) ? file : joinPath(input.cwd, file))),
        dryRun: true,
        yes: false,
        allowEmpty: input.allowEmpty,
        list: input.list,
      };

      if (!input.list && isCI && !config.ci.heal) {
        throw new ConfigInvalidError('Healing is disabled in CI; set ci.heal to true to enable it.');
      }

      const result: HealBatchResult = await heal(deps, options);
      const commitCaseIds = new Set(result.commits.keys());
      let cachedPreview: HealCommandOutput | undefined;
      const preview = (): HealCommandOutput => {
        if (cachedPreview === undefined) {
          try {
            cachedPreview = finalizeHealOutput(
              buildHealReport({
                ...reportContext(),
                outcome: settleHealOutcome(result.outcome, 'not-required', true, commitCaseIds, []),
              }),
              projectRoot,
            );
          } catch (error) {
            const classified = error instanceof AmbercastError
              ? error
              : new UnexpectedCrashError('The heal command crashed unexpectedly.', undefined, { cause: error });
            cachedPreview = finalizeHealOutput(buildHealReport({ ...reportContext(), error: classified }), projectRoot);
          }
        }
        return cachedPreview;
      };
      const hasCommits = result.commits.size > 0;
      const cases: { readonly caseId: string; readonly file: string; readonly healingSummary: string }[] = [];
      result.commits.forEach(({ file, healingSummary }, caseId) => {
        cases.push({ caseId, file, healingSummary });
      });

      let settled = false;
      return {
        preview,
        hasCommits,
        cases,
        async settle(authorization) {
          if (settled) {
            throw new UnexpectedCrashError('Healing settlement was already consumed.');
          }
          settled = true;
          if (!hasCommits) {
            return preview();
          }
          try {
            const settlements: HealCommitSettlement[] = [];
            if (authorization === 'authorized') {
              for (const [caseId, commit] of result.commits) {
                try {
                  settlements.push({ caseId, commit, result: await commit.commit() });
                } catch (error) {
                  const partiallyWritten: ('plan' | 'grounding')[] = [];
                  const persisted = partiallyWritten.length === 0 ? 'no artifacts' : partiallyWritten.join(' and ');
                  settlements.push({
                    caseId,
                    commit,
                    result: {
                      outcome: 'failed',
                      error: new FsIoError(
                        `Healing artifacts could not be committed after persisting ${persisted}.`,
                        {
                          ...(error instanceof FsIoError ? error.details ?? {} : {}),
                          partiallyWritten: [...partiallyWritten],
                        },
                        { cause: error },
                      ),
                      partiallyWritten,
                    },
                  });
                }
              }
            }
            return finalizeHealOutput(
              buildHealReport({
                ...reportContext(),
                outcome: settleHealOutcome(result.outcome, authorization, false, commitCaseIds, settlements),
              }),
              projectRoot,
            );
          } catch (error) {
            const classified = error instanceof AmbercastError
              ? error
              : new UnexpectedCrashError('The heal command crashed unexpectedly.', undefined, { cause: error });
            return finalizeHealOutput(buildHealReport({ ...reportContext(), error: classified }), projectRoot);
          }
        },
      };
    } finally {
      stderrSink.close();
    }
  } catch (error) {
    const classified = error instanceof AmbercastError
      ? error
      : new UnexpectedCrashError('The heal command crashed unexpectedly.', undefined, { cause: error });
    const crashOutput = finalizeHealOutput(buildHealReport({ ...reportContext(), error: classified }), projectRoot);
    let settled = false;
    return {
      preview: () => crashOutput,
      hasCommits: false,
      cases: [],
      async settle() {
        if (settled) {
          throw new UnexpectedCrashError('Healing settlement was already consumed.');
        }
        settled = true;
        return crashOutput;
      },
    };
  }
}

/**
 * Runs the composed healing command and produces its final report result.
 *
 * @param input - Parsed command arguments, working directory, and cancellation.
 * @returns A structured envelope and its selected process exit code.
 * @remarks
 * This is the CLI-facing composition of {@link prepareHeal}, the existing
 * interactive confirmation policy, and {@link HealPreparation.settle}. A dry
 * run and a genuinely empty commit set both skip confirmation and settlement
 * entirely by returning the preparation's preview, since neither has an
 * artifact write to authorize. Confirmation reconstructs its candidate map
 * from the preparation's already-disclosed case summaries rather than from
 * the private commit capabilities themselves, preserving the boundary that
 * only `settle` may invoke a commit.
 */
export async function runHealCommand(
  input: HealCommandInput,
): Promise<HealCommandOutput> {
  const preparation = await prepareHeal(input);
  if (input.dryRun) {
    return preparation.preview();
  }
  try {
    const commits = new Map(preparation.cases.map(({ caseId, file, healingSummary }) => [caseId, { file, healingSummary }]));
    const confirmation = await promptForHealConfirmation(commits, input, {
      isCI: createProcessEnvironmentInfo().isCI(),
      isInteractive: () => createTtyInteractivityCheck()(),
      readConfirmationAnswer: (candidates, signal) => createConfirmationAnswerReader()(candidates, signal),
    });
    if (confirmation === 'not-required') {
      return preparation.preview();
    }
    return await preparation.settle(confirmation);
  } catch (error) {
    const classified = error instanceof AmbercastError
      ? error
      : new UnexpectedCrashError('The heal command crashed unexpectedly.', undefined, { cause: error });
    const clock = createSystemClock();
    return finalizeHealOutput(
      buildHealReport({
        startedAt: reportTimestamp(clock.now()),
        durationMs: 0,
        options: { allowEmpty: input.allowEmpty, list: input.list },
        error: classified,
      }),
      input.cwd,
    );
  }
}
