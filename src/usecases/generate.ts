/**
 * Defines deterministic orchestration for turning source Markdown prompts
 * into validated, reviewable ambercast plan artifacts.
 */

import { typedJsonSchema } from '#core/ai/typed-json-schema.js';
import { composeAiDeadline, isAiDeadlineTimeout } from '#core/ai/ai-deadline.js';
import {
  buildGeneratorTask,
  GENERATE_PLAN_TASK_INSTRUCTION,
} from '#core/ai/prompt-envelope.js';
import {
  planProducerBundleComponentDiagnostics,
} from '#core/ai/plan-producer-bundle.js';
import { deriveCurrentPlanInputProvenance } from '#core/ai/plan-input-provenance.js';
import type { ResolvedConfig } from '#core/config/schema.js';
import { AiExecutorUnavailableError } from '#core/errors/ai-executor-unavailable-error.js';
import { AiResponseInvalidError } from '#core/errors/ai-response-invalid-error.js';
import { FsIoError } from '#core/errors/fs-io-error.js';
import { SecretLiteralRejectedError } from '#core/errors/secret-literal-rejected-error.js';
import { TargetUnresolvedError } from '#core/errors/target-unresolved-error.js';
import { AmbercastError, type AmbercastError as AmbercastErrorType, type ErrorKind } from '#core/errors/types.js';
import { toCanonicalArtifactText } from '#core/ir/canonical-json.js';
import { computePlanDigest } from '#core/ir/digest.js';
import { normalizeTestMd, type NormalizedTestMd } from '#core/ir/normalize.js';
import {
  GeneratedPlanResponseRequest,
  GeneratedPlanResponseForPolicy,
  GROUNDING_SCHEMA_VERSION,
  GroundingDocument,
  PLAN_SCHEMA_VERSION,
  PlanDocument,
  type GroundingDocument as GroundingDocumentType,
  type InstructionAttributedSteps,
  type JsonValueT,
  type PlanDocument as PlanDocumentType,
  type SecretName,
  type SecretRef,
  type StepId,
} from '#core/ir/schema.js';
import type { LayoutResolver } from '#core/layout/resolve.js';
import { joinPath } from '#core/paths.js';
import { resolveTarget } from '#core/target/resolve.js';
import type { AiExecutor } from '#ports/ai.js';
import type { StorageAdapter } from '#ports/storage.js';
import type { Clock, EventSink } from '#ports/system.js';
import { REPORT_ERROR_DETAILS } from '#report/error-mapping.js';
import type { ReportErrorCode } from '#report/schema.js';
import { REDACTED_ISSUE_PATH_SEGMENT, redactDynamicPathSegments } from '#core/ai/response-issue-path.js';
import {
  assertNoLiteralSecrets,
  assertSecretUsesAllowed,
  enumerateSecretUses,
  InstructionCoverageAttributionError,
} from './generator-secret-policy.js';
import {
  compareSecretWarnings,
  deriveSecretNames,
  normalizeAiStepSecretUses,
  type SecretUse,
  type SecretWarning,
} from './secret-naming.js';
import {
  validateCommittedInstructionCoverage,
  validateGeneratedInstructionCoverage,
  type InstructionCoverageIssue,
} from './instruction-coverage-policy.js';
import { assertNoEnvVarCollision, envVarNameFor } from '#core/secrets/env-var-name.js';
import { BatchInterruptionTracker } from './batch-interruption.js';
import { assertPromptPathsEligible } from './prompt-path-eligibility.js';

const GENERATED_PLAN_RESPONSE_SCHEMA = typedJsonSchema(GeneratedPlanResponseRequest);

type GeneratedPlanResponseForPolicyType = ReturnType<typeof GeneratedPlanResponseForPolicy.parse>;

/**
 * One accepted rename, addressed by its original file-and-name pair.
 *
 * An array makes the pair identity explicit and serializable. A native `Map`
 * cannot compare independently created tuple keys by value, so it would not
 * preserve the consent contract across the terminal and usecase boundary
 * (SPEC-C2-3, SPEC-C2-4).
 */
export interface SecretRename {
  /** Prompt whose original secret occurrence participates in the decision. */
  readonly file: string;
  /** Pre-consent name used as the simultaneous-substitution key. */
  readonly name: SecretName;
  /** Validated replacement for that original occurrence only. */
  readonly newName: SecretName;
}

/**
 * The single terminal result of the batch consent gate.
 *
 * An allowed result retains an empty rename list for ordinary acceptance,
 * avoiding a separate affirmative variant. Decline and non-interactive remain
 * distinct because the runtime needs to render or classify unavailable input
 * without treating it as an explicit user refusal (SPEC-C2-3, SPEC-C2-5).
 */
export type ConsentDecision =
  | { readonly kind: 'allowed'; readonly renames: readonly SecretRename[] }
  | { readonly kind: 'declined' }
  | { readonly kind: 'not-interactive' };

/**
 * Unmet secret uses for one prompt in consent presentation order.
 *
 * Grouping by file lets the terminal show each selection occurrence without
 * leaking values, environment mappings, or sink origins. The contained order
 * is the normalized use enumeration used later for validation (SPEC-C2-2,
 * SPEC-C2-4).
 */
export interface ConsentRequestItem {
  /** Selected prompt owning the listed unmet uses. */
  readonly file: string;
  /** Names-only secret uses that require one consent decision. */
  readonly uses: readonly SecretUse[];
}

/**
 * Result of checking a proposed simultaneous rename set.
 *
 * Failed keys identify only the participants that must be re-prompted; they
 * do not reject unrelated edits or invoke the consent capability again. This
 * keeps one gate request authoritative while preserving C1 naming invariants
 * after every accepted substitution (SPEC-C2-3).
 */
export type RenameValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly failedKeys: readonly { readonly file: string; readonly name: SecretName }[] };

/**
 * Inputs supplied to the single consent request for a generation batch.
 *
 * The validator is provided by the use case, not the terminal adapter, so it
 * can enforce the final-plan collision and name rules without exposing plan
 * internals to presentation code (SPEC-C2-3, SPEC-C2-4).
 */
export interface ConsentRequest {
  /** Resolved configuration path for a user-facing remedy, when one was loaded. */
  readonly configPath: string | null;
  /** Only uses absent from the invocation-start allowlist. */
  readonly items: readonly ConsentRequestItem[];
  /** Validates rename participants without retrying the batch-level request. */
  readonly validateRenames: (renames: readonly SecretRename[]) => RenameValidationResult;
}

/**
 * Runtime capability that obtains consent and durably records an acceptance.
 *
 * Generation depends on this narrow capability instead of terminal or config
 * adapters directly, preserving the two-stage boundary: a decision and its
 * allowlist commit happen before any plan or grounding artifact settles
 * (SPEC-C2-3, SPEC-C2-11).
 */
export interface ConsentCapability {
  /** Obtains the one batch decision for the supplied unmet uses. */
  readonly request: (req: ConsentRequest) => Promise<ConsentDecision>;
  /** Persists names only after an allowed decision and before artifact writes. */
  readonly commitAllowlist: (configPath: string | null, names: readonly SecretName[], signal?: AbortSignal) => Promise<void>;
}

/**
 * Keeps generation-only step provenance beside instruction-coverage failures.
 *
 * The shared instruction-policy result deliberately remains reusable by
 * callers that have no generated step identity to report. Generation instead
 * retains the failing step here, so its response-error projection can give a
 * retry and a final report the same actionable scope without widening the
 * policy module's general contract.
 */
type PrepareInstructionCoveredStepsResult =
  | { readonly success: true; readonly data: InstructionAttributedSteps }
  | { readonly success: false; readonly issues: readonly InstructionCoverageIssue[]; readonly stepId: string };

/**
 * Attributes and validates provider instruction coverage before Plan assembly.
 *
 * @param response - Strict provider response with citations and full intents.
 * @param normalizedTestMd - Canonical prompt used for local attribution.
 * @returns Committed-shape steps without citation or intent data, or the
 * complete deterministic provider issue list and its generated step identity.
 * @remarks
 * Instruction validation runs
 * for every AI step, requires exact step-local success/intent bijections, and
 * discards transient fields before Plan construction. On failure, generation
 * maps the returned raw provider output and affected step to
 * `AiResponseInvalidError`, then performs no artifact write. The default empty
 */
export function prepareInstructionCoveredSteps(
  response: GeneratedPlanResponseForPolicyType,
  normalizedTestMd: NormalizedTestMd,
): PrepareInstructionCoveredStepsResult {
  try {
    const steps = response.steps.map((step) => {
      if (step.kind !== 'ai') return step;
      const coverage = validateGeneratedInstructionCoverage(step, normalizedTestMd);
      if (!coverage.success) throw new InstructionCoverageAttributionError(coverage.issues, step.id);
      const { verificationIntent: _verificationIntent, instructionCoverage: _instructionCoverage, ...attributed } = step;
      return { ...attributed, instructionCoverage: coverage.data };
    }) as unknown as InstructionAttributedSteps;
    return { success: true, data: steps };
  } catch (error) {
    if (error instanceof InstructionCoverageAttributionError) {
      return { success: false, issues: error.issues, stepId: error.stepId };
    }
    throw error;
  }
}

function asArtifactText(value: JsonValueT): string {
  return toCanonicalArtifactText(value);
}

function fsIoError(message: string, cause: unknown): FsIoError {
  return new FsIoError(message, undefined, { cause });
}

function fileFailure(error: unknown, message: string): AmbercastErrorType {
  return error instanceof AmbercastError ? error : fsIoError(message, error);
}

/**
 * Treats committed provenance failure as not fresh so generation regenerates.
 *
 * A committed plan artifact is reusable only
 * when strict schema, canonical bytes, input digest, and every committed AI
 * criterion agree with the current normalized prompt.
 */
function validFreshPlan(
  text: string,
  inputsDigest: string,
  normalizedTestMd: NormalizedTestMd,
): PlanDocumentType | undefined {
  try {
    const parsed = PlanDocument.safeParse(JSON.parse(text));
    if (!parsed.success || parsed.data.source.inputsDigest !== inputsDigest) {
      return undefined;
    }

    if (asArtifactText(parsed.data as unknown as JsonValueT) !== text) {
      return undefined;
    }

    for (const step of parsed.data.steps) {
      if (step.kind === 'ai'
        && !validateCommittedInstructionCoverage(step.instructionCoverage, normalizedTestMd).success) {
        return undefined;
      }
    }
    return parsed.data;
  } catch {
    return undefined;
  }
}

async function freshPlan(
  storage: StorageAdapter,
  planPath: string,
  inputsDigest: string,
  normalizedTestMd: NormalizedTestMd,
): Promise<PlanDocumentType | undefined> {
  if (!(await storage.exists(planPath))) {
    return undefined;
  }

  return validFreshPlan(await storage.readText(planPath), inputsDigest, normalizedTestMd);
}

function emptyGrounding(plan: PlanDocumentType): GroundingDocumentType {
  return { schemaVersion: GROUNDING_SCHEMA_VERSION, planDigest: computePlanDigest(plan), entries: {} };
}

async function groundingIsCurrent(
  storage: StorageAdapter,
  groundingPath: string,
  plan: PlanDocumentType,
): Promise<boolean> {
  if (!(await storage.exists(groundingPath))) {
    return false;
  }

  try {
    const parsed = GroundingDocument.safeParse(JSON.parse(await storage.readText(groundingPath)));
    return parsed.success && parsed.data.planDigest === computePlanDigest(plan);
  } catch {
    return false;
  }
}

async function repairGroundingIfNeeded(
  storage: StorageAdapter,
  groundingPath: string,
  plan: PlanDocumentType,
): Promise<void> {
  if (!(await groundingIsCurrent(storage, groundingPath, plan))) {
    await storage.writeText(groundingPath, asArtifactText(emptyGrounding(plan) as unknown as JsonValueT));
  }
}

/**
 * Converts a rejected AI request into its reportable failure classification.
 *
 * The caller supplies the already-established local-deadline classification
 * so this presentation boundary does not repeat a name-based timeout guess or
 * diverge from the cancellation contract used by other AI call sites.
 *
 * @param error - Rejection value from the provider request.
 * @param isTimeout - Whether the error is this request's own timeout reason.
 * @returns The existing Ambercast error or a classified unavailable-provider error.
 */
function aiFailure(error: unknown, isTimeout: boolean): AmbercastErrorType {
  if (error instanceof AmbercastError) {
    return error;
  }

  if (isTimeout) {
    return new AiExecutorUnavailableError('The AI provider did not respond within the configured timeout.', undefined, { cause: error });
  }

  return new AiExecutorUnavailableError('The AI provider call failed.', undefined, { cause: error });
}

/**
 * Command policy for one generation batch.
 *
 * Consent mode is invocation policy rather than a dependency setting because
 * C3 must reuse generation internally without allowing it to prompt or mutate
 * configuration. Omission deliberately preserves ordinary CLI consent-gate
 * behavior (SPEC-C2-3).
 */
export interface GenerateOptions {
  /** Literal prompt paths, or an empty list to use configured discovery. */
  readonly files: readonly string[];

  /** Whether non-empty ambiguities escalate after generation. */
  readonly strict: boolean;

  /** Whether a fresh existing plan still regenerates. */
  readonly force: boolean;

  /** Prevents both consent interaction and allowlist persistence for internal callers. */
  readonly consentMode?: 'forbid';

  /**
   * Limits provider attempts for one prompt during regular generation.
   *
   * Callers supply the resolved one-to-five configuration value so normal
   * generation can retry local validation rejections without making retry
   * policy implicit. Heal repairs retain their separately explicit one-shot
   * policy and never inherit this budget.
   */
  readonly maxAttempts: number;

  /** Whether validated artifacts are previewed instead of written. */
  readonly dryRun: boolean;

  /** Optional explicit target name; an invalid name never falls back. */
  readonly target?: string;

  /** Whether zero discovered files are an allowed empty outcome. */
  readonly allowEmpty: boolean;

  /** Whether discovery is reported without reading prompts or calling AI. */
  readonly list: boolean;
}

/**
 * Dependencies supplied at the generation application boundary.
 *
 * The consent capability is optional only to preserve the existing heal
 * composition until C3 supplies `consentMode: 'forbid'`. Production runtime
 * always injects it; if consent becomes necessary without it, generation must
 * fail closed rather than silently writing artifacts or attempting a UI that
 * does not exist (SPEC-C2-3).
 */
export interface GenerateDeps {
  /** Artifact persistence for prompts, plans, and grounding documents. */
  readonly storage: StorageAdapter;

  /** Batch consent and allowlist persistence supplied by interactive runtime composition. */
  readonly consent?: ConsentCapability;

  /** Deterministic companion-path arithmetic for discovered prompt paths. */
  readonly layout: LayoutResolver;

  /**
   * Defers provider resolution until this batch reaches its first AI dispatch.
   *
   * `generate()` memoizes this resolver for the whole batch rather than once
   * per file: unlike `run`, generation has one shared provider-resolution
   * budget. List, zero-match, and all-fresh batches never invoke it.
   */
  readonly resolveAiExecutor: (signal?: AbortSignal) => Promise<AiExecutor>;

  /**
   * Receives lifecycle accounting for structured provider invocations.
   *
   * Every attempted `aiExecutor.execute` call emits one `ai-call`; paths that
   * avoid the provider emit none.
   */
  readonly events: EventSink;

  /**
   * Monotonic clock reserved for provider and selected-occurrence durations.
   *
   * The implementation measures only the bare executor call for an
   * event result and separately measures selected occurrence processing for
   * report rows, so wall-clock corrections cannot affect either value.
   */
  readonly clock: Clock;

  /**
   * Allocates one command-wide ID for each real provider dispatch.
   *
   * Runtime owns this closure so nested heal generation cannot restart the
   * sequence with a second local counter.
   */
  readonly allocateCallId: () => string;

  /**
   * Configured prompt discovery injected from runtime.
   *
   * This structural callback mirrors runtime's `TestFileDiscovery` without a
   * forbidden usecase-to-runtime import; runtime owns the filesystem walk and
   * supplies the compatible function at composition time.
   */
  readonly discoverTestFiles: (config: {
    readonly testDir: string;
    readonly testMatch: readonly string[];
    readonly testIgnore: readonly string[];
  }) => Promise<readonly string[]>;

  /** The subset of resolved configuration the generation algorithm reads. */
  readonly config: Pick<
    ResolvedConfig,
    'testDir' | 'testMatch' | 'testIgnore' | 'targets' | 'defaultTarget' | 'ai'
  > & Partial<Pick<ResolvedConfig, 'secrets' | 'projectRoot'>>;

  /** Selected configuration provenance retained for later consent diagnostics. */
  readonly configSource?: { readonly path: string | null };

  /**
   * Caller cancellation observed at the sequential per-file scheduling boundary.
   *
   * Cancellation retains terminal outcomes and turns every discovered but
   * nonterminal identity into an evidence-free skipped row. Cancellation while
   * the batch AI-provider resolver is pending instead rejects `generate()` at
   * the top level without producing a skipped row.
   */
  readonly signal?: AbortSignal;
}

/**
 * The per-file state represented in a generation outcome.
 *
 * Interrupted work uses the shared identity-only skipped state; it never
 * borrows plan, provider, ambiguity, or dry-run evidence from completed work.
 */
export type GenerateFileStatus = 'generated' | 'skipped-fresh' | 'would-generate' | 'listed' | 'skipped' | 'failed';

/**
 * Serializable-identifying data plus any live error for one prompt path.
 */
export interface GenerateFileOutcome {
  /** Source Markdown prompt path. */
  readonly file: string;

  /** The completed state for this source prompt. */
  readonly status: GenerateFileStatus;

  /** Plan path retained only for generated, fresh, or previewed results. */
  readonly planFile?: string;

  /** Provider ambiguities retained only for generated or previewed plans. */
  readonly ambiguities?: readonly JsonValueT[];

  /** Classified per-file failure retained only for a failed result. */
  readonly error?: AmbercastError;

  /**
   * Terminal rows retain this selected-occurrence interval so reports can
   * distinguish work that reached a final decision from listing or interruption
   * identities. `GenerateDeps.clock` measures processing start through that
   * decision; listed and interruption-skipped rows intentionally omit it.
   */
  readonly durationMs?: number;

  /** Counts provider calls admitted after local request construction, not retries that fail before dispatch. */
  readonly aiCalls?: number;

  /** Resolved secret-use evidence retained only on reportable generation rows. */
  readonly secrets?: readonly GenerateSecretOutcome[];

  /** Non-fatal secret naming warnings retained with secret-use evidence. */
  readonly warnings?: readonly SecretWarning[];
}

type GenerateSecretOutcome = {
  readonly name: SecretName;
  readonly stepId: StepId;
  readonly envVar: string;
  readonly allowed: boolean;
  readonly selectionSource: 'allowed-name' | 'target-slug' | 'hint' | 'ordinal' | 'existing-plan' | 'interactive-rename';
};

/**
 * A successfully prepared occurrence awaiting the consent gate and settlement.
 *
 * Each selected occurrence remains distinct even when it shares a file with a
 * duplicate. Keeping its final plan, uses, diagnostics, and intended commit
 * together lets Stage 1 be artifact-free while virtual freshness and ordered
 * Stage 2 settlement preserve recovery after partial writes (SPEC-C2-2,
 * SPEC-C2-3, SPEC-C2-11).
 */
type PreparedCandidate = {
  /** Occurrence-qualified identity used for interruption and finalization. */
  readonly workKey: string;
  /** Selection position, retained so duplicate occurrences never collapse after starting. */
  readonly occurrenceIndex: number;
  /** Prompt path associated with this occurrence. */
  readonly file: string;
  /** Durable destination for the prepared plan. */
  readonly planPath: string;
  /** Durable destination for the companion grounding artifact. */
  readonly groundingPath: string;
  /** Final normalized plan from either virtual/durable freshness or generation. */
  readonly plan: PlanDocumentType;
  /** Secret naming outcomes used to compute the batch-wide unmet set. */
  readonly uses: readonly GenerateSecretOutcome[];
  /** Non-fatal naming diagnostics retained through reporting. */
  readonly warnings: readonly SecretWarning[];
  /** Provider ambiguities retained for later strict-exit evaluation. */
  readonly ambiguities: readonly JsonValueT[];
  /** Whether the final plan required generation or was already fresh. */
  readonly origin: 'generated' | 'fresh';
  /** Metrics measured before consent so later settlement does not distort them. */
  readonly metrics: { readonly durationMs: number; readonly aiCalls: number };
  /** Ordered artifact action needed if this occurrence reaches settlement. */
  readonly pendingCommit: 'write-plan-and-grounding' | 'repair-grounding-only';
};

/**
 * Represents one report-safe provider or instruction-coverage issue.
 *
 * The retry context and the final response error share this projection
 * instead of each defensively interpreting error details. That single shape
 * keeps a missing or malformed issue list from producing inconsistent retry
 * feedback and report diagnostics.
 */
type GenerateResponseIssue = {
  readonly code: string;
  readonly path: readonly (string | number)[];
  readonly stepId?: string;
};

/**
 * Records the safe feedback from one rejected provider attempt.
 *
 * A discriminated three-variant union prevents unrelated diagnostic fields from
 * crossing back into provider context and rules out a bag of optional fields
 * that could describe no real failure. Each retryable record carries only the
 * information needed to avoid the prior rejection and no raw provider text,
 * secret reference, hint, or detector data.
 */
type PreviousAttemptContext =
  | {
    readonly attempt: number;
    readonly code: 'AI_RESPONSE_INVALID';
    readonly issues: readonly GenerateResponseIssue[];
  }
  | {
    readonly attempt: number;
    readonly code: 'SECRET_LITERAL_REJECTED';
  };

/**
 * Separates one generation dispatch from the file-level retry controller.
 *
 * The discriminant lets that controller consume a feedback record only after
 * a retryable failure, preserve a concrete classified error for every
 * terminal failure, and stop scheduling immediately for interruption. A
 * successful branch guarantees a complete file outcome, so callers never
 * reconstruct success or retryability from raw provider data twice.
 */
type AttemptOutcome =
  | { readonly kind: 'success'; readonly outcome: GenerateFileOutcome }
  | { readonly kind: 'retryable'; readonly error: AmbercastError; readonly record: PreviousAttemptContext }
  | { readonly kind: 'terminal'; readonly error: AmbercastError }
  | { readonly kind: 'interrupted' };

const ATTEMPTS_ELIGIBLE_CODES = new Set<ReportErrorCode>([
  'AI_RESPONSE_INVALID',
  'SECRET_LITERAL_REJECTED',
  'AI_EXECUTOR_UNAVAILABLE',
]);

/**
 * Projects an invalid-response error's issues to the retry-safe shape.
 *
 * The defensive reader normalizes absent or malformed details to
 * an empty list. Keeping that rule in one helper prevents retry classification,
 * provider feedback, and terminal report reconstruction from disagreeing
 * about the same error. Terminal invalid-response reconstruction stores this
 * normalized array back into `details.issues`, so report projection has the
 * required key even when the original error did not.
 */
function responseIssues(error: AiResponseInvalidError): readonly GenerateResponseIssue[] {
  const issues = error.details?.['issues'];
  return Array.isArray(issues) ? issues as readonly GenerateResponseIssue[] : [];
}

/**
 * Decides whether a classified generation failure merits another attempt.
 *
 * The policy allows invalid responses, unattributable secret grants, and
 * literal-secret rejections. Because every literal-secret detector raises the
 * same error, its retry decision applies uniformly rather than only to the
 * embedded-reference case. Retry records omit diagnostic payloads to extend
 * the existing
 * non-disclosure boundary used by the other variants. An invalid
 * response with no projected issues remains retryable, while a non-empty issue list containing only the terminal URL
 * prohibition is terminal: that carve-out guarantees generation does not
 * spend another provider call on a prompt condition the provider cannot infer
 * a valid destination assertion for.
 */
function isRetryable(error: AmbercastError): boolean {
  if (error instanceof SecretLiteralRejectedError) return true;
  if (!(error instanceof AiResponseInvalidError)) return false;

  const issues = responseIssues(error);
  return issues.length === 0 || !issues.every((issue) => issue.code === 'terminal-url-matches-forbidden');
}

/**
 * Finds the stable report code for a classified generation error.
 *
 * The checked lookup returns `undefined` for an unexpected error
 * kind instead of indexing the intentionally partial report mapping directly.
 * That boundary lets future error kinds omit retry history safely rather than
 * turning terminal error handling into a second failure.
 */
function reportCodeFor(error: AmbercastError): ReportErrorCode | undefined {
  return (REPORT_ERROR_DETAILS as Partial<Record<ErrorKind, { readonly code: ReportErrorCode }>>)[error.kind]?.code;
}

/**
 * Adds retry history while preserving a terminal error's concrete class.
 *
 * Explicit `instanceof` dispatch over the four report-eligible classes, rather
 * than constructor reflection, keeps the supported reconstruction and
 * preservation of all existing details and `cause` auditable; an ineligible
 * error passes through untouched if a future caller reaches this boundary
 * unexpectedly.
 *
 * When reconstructing an `AiResponseInvalidError`, the dispatch must write
 * `responseIssues(error)` to `details.issues` rather than only spreading the
 * original details. `reportError()` forwards its `details.attempts` only when
 * that key is present, so this always-present normalized array preserves
 * terminal retry history for both ordinary and no-details invalid responses.
 */
function attachAttemptsHistory(
  error: AmbercastError,
  history: readonly { readonly attempt: number; readonly code: ReportErrorCode }[],
): AmbercastError {
  if (error instanceof AiResponseInvalidError) {
    return new AiResponseInvalidError(error.message, {
      ...error.details,
      issues: responseIssues(error),
      attempts: history,
    }, { cause: error.cause });
  }
  if (error instanceof SecretLiteralRejectedError) {
    return new SecretLiteralRejectedError(error.message, {
      ...error.details,
      attempts: history,
    }, { cause: error.cause });
  }
  if (error instanceof AiExecutorUnavailableError) {
    return new AiExecutorUnavailableError(error.message, {
      ...error.details,
      attempts: history,
    }, { cause: error.cause });
  }
  return error;
}

function secretNameFor(ref: SecretRef): SecretName {
  return ref.slice('{{secrets.'.length, -'}}'.length) as SecretName;
}

function secretRowsForPlan(
  plan: PlanDocumentType,
  allow: readonly SecretName[] | '*',
  namedUses?: readonly ({ readonly ref: SecretRef; readonly name: SecretName; readonly stepId: StepId; readonly selectionSource: GenerateSecretOutcome['selectionSource'] })[],
): GenerateSecretOutcome[] {
  const allowed = allow === '*' ? undefined : new Set(allow);
  return enumerateSecretUses(plan).map(({ ref, stepId }) => {
    const name = secretNameFor(ref);
    const named = namedUses?.find((use) => use.stepId === stepId && use.ref === ref);
    return {
      name,
      stepId,
      envVar: envVarNameFor(ref),
      allowed: allowed === undefined || allowed.has(name),
      selectionSource: named?.selectionSource ?? 'existing-plan',
    };
  });
}

function existingPlanWarnings(plan: PlanDocumentType): SecretWarning[] {
  const groups = new Map<SecretName, { readonly stepId: StepId; readonly target: string }[]>();
  for (const step of plan.steps) {
    if (step.kind !== 'action' || step.action !== 'fill-secret') continue;
    const name = secretNameFor(step.secretRef);
    groups.set(name, [...(groups.get(name) ?? []), { stepId: step.id, target: JSON.stringify(step.target) }]);
  }
  return [...groups.entries()]
    .filter(([, uses]) => new Set(uses.map(({ target }) => target)).size > 1)
    .map(([name, uses]) => ({ kind: 'secret-name-reused-across-targets' as const, name, stepIds: uses.map(({ stepId }) => stepId) }))
    .sort(compareSecretWarnings);
}

/**
 * Ordered terminal and interruption results of one generation invocation.
 *
 * The batch interruption fact is distinct from any individual result. It is
 * true only when caller cancellation was observed while a discovered work key
 * remained nonterminal, allowing report construction to add one run-scoped
 * interruption error without converting skipped identities into case errors.
 */
export interface GenerateOutcome {
  /** Per-file results in literal or deterministic discovery order. */
  readonly results: readonly GenerateFileOutcome[];

  /** Whether resolution found no files before any per-file work began. */
  readonly noTestsFound: boolean;

  /** Whether cancellation intersected discovered nonterminal work. */
  readonly interrupted: boolean;
}

/**
 * Generates or previews deterministic plan artifacts for resolved prompt files.
 *
 * @param deps - I/O, layout, deferred provider resolution, event delivery, discovery,
 * configuration, and optional cancellation dependencies.
 * @param options - Batch selection and generation policy.
 * @returns Ordered file outcomes, the zero-match fact, and whether cancellation
 * intersected incomplete discovered work.
 * @remarks
 * Literal paths retain caller order and discovered paths retain the injected
 * discovery order, including duplicate occurrences. Each occurrence receives
 * a key such as `generate:<index>:<file>`, so duplicate public identities keep
 * their existing visible result rows without sharing scheduling terminality.
 * List mode is an atomic boundary after selection: it returns every listed row
 * and `GenerateOutcome.interrupted` is false even when its caller signal is
 * already aborted. It does not read prompt files, invoke AI, emit lifecycle
 * events, or write artifacts. The deadline is constructed only after provider
 * resolution succeeds and before executor dispatch, so availability probing
 * does not consume the AI request budget. Every attempted
 * `aiExecutor.execute` dispatch emits one `ai-call`; resolution and paths
 * avoiding dispatch emit none. A resolver rejection emits no `ai-call`, never
 * becomes a file-level `failed` row, and propagates as a top-level rejection,
 * leaving grounding repairs already written for earlier fresh files intact
 * because the batch is non-transactional. Cancellation while resolution is pending
 * follows that rejection path rather than the tracker's per-file skipped rows.
 * Other files run sequentially, so a caller cancellation
 * prevents new work without discarding earlier terminal outcomes, while an
 * individual file failure does not block later files.
 *
 * Freshness requires both semantic validity and canonical artifact bytes,
 * preventing malformed or reformatted plans from skipping generation. A
 * non-dry-run fresh plan repairs only its grounding cache, while dry-run leaves
 * that cache untouched; `force` is the explicit opt-out from fresh-plan reuse.
 * The provider receives a smaller response contract than the committed plan:
 * the shared core resolver supplies one target while this use case owns
 * provenance, then validates the assembled plan and its duplicate-ID invariant
 * before the literal-secret policy permits persistence. Restricting the target
 * record to that selection prevents unrelated definitions from changing the
 * digest or entering provider context. A classified selection failure remains
 * attached to its file and stops that case before digest computation, existing
 * plan inspection, provider invocation, or artifact writes. Later prompts
 * retain the same isolation as other generation failures.
 * A separate batch-level prompt-path preflight runs before that per-file
 * boundary, so no selected case begins when any selected path is ineligible.
 * It throws `PromptPathInvalidError` before per-file work in that case.
 *
 * The caller signal is distinct from the per-call timeout. A synchronous
 * tracker records discovered work keys and their public identities. A work key
 * becomes terminal whenever its scheduled file processing completes,
 * independently of whether completion creates a public row. Cancellation
 * leaves every still-pending public identity as an ordered, deduplicated,
 * identity-only skipped row and latches even when in-flight work later
 * completes; the listener is disposed in `finally` on success or rejection.
 * This skipped-row behavior applies after resolution succeeds; cancellation
 * while resolution is pending rejects `generate()` at the top level. A timeout
 * instead fails only the current file as an unavailable executor. Plan
 * text precedes grounding text so a grounding write failure leaves a
 * repairable fresh plan rather than a partial plan. Cross-process generation
 * against the same prompt is undefined behavior.
 */
export async function generate(deps: GenerateDeps, options: GenerateOptions): Promise<GenerateOutcome> {
  const tracker = new BatchInterruptionTracker(deps.signal);
  try {
    const discovered = options.files.length === 0
      ? (await deps.discoverTestFiles({
        testDir: deps.config.testDir,
        testMatch: deps.config.testMatch,
        testIgnore: deps.config.testIgnore,
      })).map((path) => joinPath(deps.config.testDir, path))
      : [...options.files];

    if (discovered.length === 0) {
      return { results: [], noTestsFound: true, interrupted: false };
    }

    if (options.list) {
      return {
        results: discovered.map((file) => ({ file, status: 'listed' })),
        noTestsFound: false,
        interrupted: false,
      };
    }

    assertPromptPathsEligible(deps.layout, discovered);

    let aiExecutorPromise: Promise<AiExecutor> | undefined;
    for (const [index, file] of discovered.entries()) tracker.addDiscovered(`generate:${index}:${file}`, file);
    const results: GenerateFileOutcome[] = [];
    for (const [index, file] of discovered.entries()) {
      const workKey = `generate:${index}:${file}`;
      let interruptedDuringAi = false;
      if (tracker.interrupted) {
        break;
      }
      const processingStartedMs = deps.clock.monotonicMs();
      let aiCalls = 0;
      const metrics = () => ({
        durationMs: Math.max(0, Math.round(deps.clock.monotonicMs() - processingStartedMs)),
        aiCalls,
      });
      try {

        let testMd: string;
        try {
          testMd = await deps.storage.readText(file);
        } catch (error) {
          results.push({ file, status: 'failed', error: fsIoError('The test prompt could not be read.', error), ...metrics() });
          continue;
        }

        const targetSelection = resolveTarget({
          targets: deps.config.targets,
          defaultTarget: deps.config.defaultTarget,
          explicitTarget: options.target,
        });
        if (targetSelection instanceof TargetUnresolvedError) {
          results.push({ file, status: 'failed', error: targetSelection, ...metrics() });
          continue;
        }
        const resolvedTargets = targetSelection.definitions;
        const secretAllow = deps.config.secrets?.allow ?? [];

        const normalizedTestMd = normalizeTestMd(testMd);
        const provenance = deriveCurrentPlanInputProvenance({
          normalizedTestMd,
          targetDefinitions: resolvedTargets,
        });
        const { inputsDigest, producerBundleFingerprint, producerBundleInputs } = provenance;
        const planPath = deps.layout.planPathFor(file);
        const groundingPath = deps.layout.groundingPathFor(file);

        let existingPlan: PlanDocumentType | undefined;
        try {
          existingPlan = await freshPlan(deps.storage, planPath, inputsDigest, normalizedTestMd);
        } catch (error) {
          results.push({ file, status: 'failed', error: fsIoError('The existing plan could not be read.', error), ...metrics() });
          continue;
        }

        if (existingPlan !== undefined && !options.force) {
          try {
            if (!options.dryRun) {
              await repairGroundingIfNeeded(deps.storage, groundingPath, existingPlan);
            }
            results.push({
              file,
              status: 'skipped-fresh',
              planFile: planPath,
              ...(options.dryRun
                ? {
                  dryRun: true,
                  secrets: secretRowsForPlan(existingPlan, secretAllow),
                  ...(existingPlanWarnings(existingPlan).length === 0 ? {} : { warnings: existingPlanWarnings(existingPlan) }),
                }
                : {}),
              ...metrics(),
            });
          } catch (error) {
            results.push({ file, status: 'failed', error: fsIoError('The grounding cache could not be repaired.', error), ...metrics() });
          }
          continue;
        }

        aiExecutorPromise ??= deps.resolveAiExecutor(deps.signal);
        const aiExecutor = await aiExecutorPromise;

        /**
         * Executes one provider attempt using the per-file state captured by this
         * scope.
         *
         * Caller cancellation interrupts an `execute()` rejection only when it is
         * not this request's timeout. Response and final-Plan schema mismatches,
         * plus retryable coverage failures, retain the classified error and
         * feedback needed by the file-level controller. Literal-secret rejection
         * is retryable, while artifact-write failures remain terminal.
         * The outer `fileFailure()` boundary
         * around `prepareInstructionCoveredSteps` keeps unexpected inspection
         * errors isolated to this file rather than rejecting the batch.
         */
        async function attemptGeneration(
          attempt: number,
          previousAttempts: readonly PreviousAttemptContext[],
        ): Promise<AttemptOutcome> {
          const outcomeForError = (error: AmbercastError): AttemptOutcome => {
            if (!isRetryable(error)) return { kind: 'terminal', error };
            if (error instanceof AiResponseInvalidError) {
              return {
                kind: 'retryable',
                error,
                record: { attempt, code: 'AI_RESPONSE_INVALID', issues: responseIssues(error) },
              };
            }
            if (error instanceof SecretLiteralRejectedError) {
              return {
                kind: 'retryable',
                error,
                record: { attempt, code: 'SECRET_LITERAL_REJECTED' },
              };
            }
            return { kind: 'terminal', error };
          };

          const deadline = composeAiDeadline(deps.signal, deps.config.ai.timeoutMs);
          const request = {
            prompt: buildGeneratorTask(GENERATE_PLAN_TASK_INSTRUCTION),
            responseSchema: GENERATED_PLAN_RESPONSE_SCHEMA,
            context: (attempt === 1
              ? { testMd: normalizedTestMd, targets: resolvedTargets, allowedSecretNames: [] }
              : { testMd: normalizedTestMd, targets: resolvedTargets, allowedSecretNames: [], previousAttempts }) as unknown as JsonValueT,
            signal: deadline.signal,
          };
          const callId = deps.allocateCallId();
          deps.events.emit({ type: 'ai-call', callId, file, attempt, attemptLimit: options.maxAttempts });
          aiCalls += 1;
          const startedMs = deps.clock.monotonicMs();
          let providerOutcome: 'ok' | 'error' = 'error';
          let response;
          try {
            response = await aiExecutor.execute(request);
            providerOutcome = 'ok';
          } catch (error) {
            const isTimeout = isAiDeadlineTimeout(deadline, error);
            if (!isTimeout && deps.signal?.aborted) return { kind: 'interrupted' };
            return outcomeForError(aiFailure(error, isTimeout));
          } finally {
            deps.events.emit({
              type: 'ai-result',
              callId,
              durationMs: Math.max(0, Math.round(deps.clock.monotonicMs() - startedMs)),
              outcome: providerOutcome,
            });
          }

          if (tracker.interrupted) return { kind: 'interrupted' };

          // Parsed-value traversal keeps dynamic provider data non-disclosive even
          // where generated-schema structure cannot identify the true container.
          const parsedResponse = GeneratedPlanResponseForPolicy.safeParse(response.data);
          if (!parsedResponse.success) {
            return outcomeForError(new AiResponseInvalidError(
              'The AI provider response did not match the generation contract.',
              {
                raw: response.raw,
                issues: parsedResponse.error.issues.map((issue) => ({
                  code: 'schema-mismatch',
                  path: redactDynamicPathSegments(response.data, issue.path),
                })),
              },
            ));
          }

          let prepared: PrepareInstructionCoveredStepsResult;
          try {
            prepared = prepareInstructionCoveredSteps(parsedResponse.data, normalizedTestMd);
          } catch (error) {
            return outcomeForError(fileFailure(error, 'The generated plan could not be inspected.'));
          }
          if (!prepared.success) {
            // Internal context retains raw provider output for diagnostics, while
            // the public report projection excludes it and exposes only safe issue
            // fields.
            return outcomeForError(new AiResponseInvalidError(
              'The AI provider response contains invalid instruction coverage.',
              {
                raw: response.raw,
                issues: prepared.issues.map((issue) => ({
                  code: issue.code,
                  path: issue.code === 'intent-id-missing'
                    ? [...issue.path.slice(0, -1), REDACTED_ISSUE_PATH_SEGMENT]
                    : issue.path,
                  ...(prepared.stepId === undefined ? {} : { stepId: prepared.stepId }),
                })),
              },
            ));
          }

          let named;
          try {
            named = deriveSecretNames(prepared.data, { projected: [], allowlist: secretAllow });
          } catch (error) {
            return outcomeForError(fileFailure(error, 'The generated secret names could not be derived.'));
          }

          let normalizedSteps;
          try {
            normalizedSteps = normalizeAiStepSecretUses(named.steps);
          } catch (error) {
            return outcomeForError(fileFailure(error, 'The generated secret uses could not be normalized.'));
          }
          const candidate = {
            schemaVersion: PLAN_SCHEMA_VERSION,
            source: { inputsDigest },
            generatorMeta: {
              ...(response.data.generatorMeta ?? {}),
              planProducerBundle: {
                fingerprint: producerBundleFingerprint,
                components: planProducerBundleComponentDiagnostics(producerBundleInputs),
              },
            },
            targets: resolvedTargets,
            steps: normalizedSteps,
          };
          // Candidate-value traversal preserves the same non-disclosure invariant
          // for dynamic target namespaces after assembly.
          const parsedPlan = PlanDocument.safeParse(candidate);
          if (!parsedPlan.success) {
            return outcomeForError(new AiResponseInvalidError(
              'The AI provider response could not form a valid plan.',
              {
                raw: response.raw,
                issues: parsedPlan.error.issues.map((issue) => ({
                  code: 'schema-mismatch',
                  path: redactDynamicPathSegments(candidate, issue.path),
                })),
              },
            ));
          }

          try {
            assertNoEnvVarCollision(enumerateSecretUses(parsedPlan.data).map(({ ref }) => ref));
          } catch (error) {
            return outcomeForError(fileFailure(error, 'The generated secret environment variables could not be inspected.'));
          }

          try {
            assertNoLiteralSecrets(parsedPlan.data);
          } catch (error) {
            return outcomeForError(fileFailure(error, 'The generated plan could not be inspected.'));
          }

          try {
            assertNoLiteralSecrets(response.data.ambiguities);
          } catch (error) {
            return outcomeForError(fileFailure(error, 'The generated ambiguities could not be inspected.'));
          }

          try {
            assertSecretUsesAllowed(parsedPlan.data, secretAllow, {
              configPath: deps.configSource?.path ?? null,
              cwd: deps.config.projectRoot ?? '',
            });
          } catch (error) {
            return outcomeForError(fileFailure(error, 'The generated secret uses are not allowed.'));
          }

          const secrets = secretRowsForPlan(parsedPlan.data, secretAllow, named.uses);
          const warnings = named.warnings;

          if (options.dryRun) {
            return {
              kind: 'success',
              outcome: { file, status: 'would-generate', planFile: planPath, ambiguities: response.data.ambiguities, secrets, ...(warnings.length === 0 ? {} : { warnings }) },
            };
          }

          try {
            await deps.storage.writeText(planPath, asArtifactText(parsedPlan.data as unknown as JsonValueT));
            await deps.storage.writeText(groundingPath, asArtifactText(emptyGrounding(parsedPlan.data) as unknown as JsonValueT));
            return {
              kind: 'success',
              outcome: { file, status: 'generated', planFile: planPath, ambiguities: response.data.ambiguities, secrets, ...(warnings.length === 0 ? {} : { warnings }) },
            };
          } catch (error) {
            return outcomeForError(fsIoError('The generated artifacts could not be written.', error));
          }
        }

        const history: { attempt: number; code: ReportErrorCode }[] = [];
        let previousAttempts: PreviousAttemptContext[] = [];
        let outcome: GenerateFileOutcome | undefined;
        for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
          if (attempt > 1 && deps.signal?.aborted) {
            interruptedDuringAi = true;
            break;
          }

          const attemptResult = await attemptGeneration(attempt, previousAttempts);
          if (attemptResult.kind === 'interrupted') {
            interruptedDuringAi = true;
            break;
          }
          if (attemptResult.kind === 'success') {
            outcome = attemptResult.outcome;
            break;
          }

          const code = reportCodeFor(attemptResult.error);
          if (code !== undefined) history.push({ attempt, code });
          const isFinal = attemptResult.kind === 'terminal' || attempt === options.maxAttempts;
          if (isFinal) {
            const error = code !== undefined && ATTEMPTS_ELIGIBLE_CODES.has(code)
              ? attachAttemptsHistory(attemptResult.error, history)
              : attemptResult.error;
            outcome = { file, status: 'failed', error };
            break;
          }
          previousAttempts = [...previousAttempts, attemptResult.record];
        }

        if (outcome !== undefined) results.push({ ...outcome, ...metrics() });
        if (interruptedDuringAi) break;
      } finally {
        if (!interruptedDuringAi) tracker.markTerminal(workKey);
      }
    }

    if (tracker.interrupted) results.push(...tracker.pendingIdentities.map((file) => ({ file, status: 'skipped' as const })));
    return { results, noTestsFound: false, interrupted: tracker.interrupted };
  } finally {
    tracker.dispose();
  }
}
