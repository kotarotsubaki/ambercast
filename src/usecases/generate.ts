/**
 * Defines deterministic orchestration for turning source Markdown prompts
 * into validated, reviewable ambercast plan artifacts.
 */

import { typedJsonSchema } from '#core/ai/typed-json-schema.js';
import { composeAiDeadline, isAiDeadlineTimeout } from '#core/ai/ai-deadline.js';
import {
  buildGeneratorTask,
  GENERATE_PLAN_TASK_INSTRUCTION,
  toAnchoredLines,
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
import { SecretConsentRequiredError } from '#core/errors/secret-consent-required-error.js';
import { SecretSyntaxRejectedError } from '#core/errors/secret-syntax-rejected-error.js';
import { TargetUnresolvedError } from '#core/errors/target-unresolved-error.js';
import { UnexpectedCrashError } from '#core/errors/unexpected-crash-error.js';
import { AmbercastError, type AmbercastError as AmbercastErrorType, type ErrorKind } from '#core/errors/types.js';
import { toCanonicalArtifactText } from '#core/ir/canonical-json.js';
import { computePlanDigest } from '#core/ir/digest.js';
import { secretNameFor } from '#core/ir/secret-ref.js';
import { normalizeTestMd, type NormalizedTestMd } from '#core/ir/normalize.js';
import {
  GeneratedPlanResponseRequest,
  GeneratedPlanResponseForPolicy,
  GROUNDING_SCHEMA_VERSION,
  GroundingDocument,
  PLAN_SCHEMA_VERSION,
  PlanDocument,
  type GroundingDocument as GroundingDocumentType,
  type ElementRef,
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
import { scanLegacySecretSyntax } from '#core/ir/secret-syntax-scan.js';

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
  /** One accepted replacement addressed by its original file-and-name pair. */
  /** @remarks An array is used because native `Map` keys do not compare tuple values structurally. */
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
 * Internal callers can reuse generation without allowing it to prompt or mutate
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
 * composition when callers use `consentMode: 'forbid'`. Production runtime
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
export type GenerateFileStatus = 'generated' | 'skipped-fresh' | 'would-generate' | 'candidate' | 'listed' | 'skipped' | 'failed';

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

  /** Prepared final plan returned only when an internal caller forbids settlement. */
  readonly plan?: PlanDocumentType;

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
  readonly useIndex?: number;
  readonly target?: ElementRef;
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
  // Provider-side attribution mistakes are correctable, unlike an inherently
  // unresolvable terminal URL assertion, so the generic invalid-response rule
  // needs no code-specific carve-out.
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

function secretRowsForPlan(
  plan: PlanDocumentType,
  allow: readonly SecretName[] | '*',
  namedUses?: readonly SecretUse[],
): GenerateSecretOutcome[] {
  const allowed = allow === '*' ? undefined : new Set(allow);
  return enumerateSecretUses(plan).map(({ ref, stepId, useIndex }) => {
    const name = secretNameFor(ref);
    const named = namedUses?.find((use) => use.stepId === stepId && use.ref === ref && use.useIndex === useIndex);
    return {
      name,
      stepId,
      envVar: envVarNameFor(ref),
      allowed: allowed === undefined || allowed.has(name),
      selectionSource: named?.selectionSource ?? 'existing-plan',
    };
  });
}

function consentRowsForPlan(plan: PlanDocumentType, rows: readonly GenerateSecretOutcome[]): GenerateSecretOutcome[] {
  const targets = new Map<StepId, ElementRef>();
  for (const step of plan.steps) {
    if (step.kind === 'action' && step.action === 'fill-secret') targets.set(step.id, step.target);
  }
  return enumerateSecretUses(plan).map(({ ref, stepId, useIndex }) => {
    const row = rows.find((use) => use.stepId === stepId && use.name === secretNameFor(ref));
    return {
      ...(row ?? { name: secretNameFor(ref), stepId, envVar: envVarNameFor(ref), allowed: false, selectionSource: 'existing-plan' as const }),
      ...(useIndex === undefined ? {} : { useIndex }),
      ...(targets.get(stepId) === undefined ? {} : { target: targets.get(stepId)! }),
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

function useOccurrenceKey(file: string, use: Pick<GenerateSecretOutcome, 'name' | 'stepId' | 'useIndex'>): string {
  return `${file}\u0000${use.stepId}\u0000${use.useIndex ?? ''}\u0000${use.name}`;
}

function finalSecretRows(
  candidate: PreparedCandidate,
  plan: PlanDocumentType,
  allowed: readonly SecretName[] | '*',
  renamedSourceUses: ReadonlySet<string>,
): GenerateSecretOutcome[] {
  const permitted = allowed === '*' ? undefined : new Set(allowed);
  return enumerateSecretUses(plan).map(({ ref, stepId, useIndex }) => {
    const original = candidate.uses.find((use) => use.stepId === stepId && use.useIndex === useIndex);
    const name = secretNameFor(ref);
    const sourceKey = original === undefined ? undefined : useOccurrenceKey(candidate.file, original);
    return {
      name,
      stepId,
      ...(useIndex === undefined ? {} : { useIndex }),
      ...(original?.target === undefined ? {} : { target: original.target }),
      envVar: envVarNameFor(ref),
      allowed: permitted === undefined || permitted.has(name),
      selectionSource: sourceKey !== undefined && renamedSourceUses.has(sourceKey)
        ? 'interactive-rename'
        : original?.selectionSource ?? 'existing-plan',
    };
  });
}

function finalWarnings(candidate: PreparedCandidate, plan: PlanDocumentType): SecretWarning[] {
  return [
    ...existingPlanWarnings(plan),
    ...candidate.warnings.filter((warning) => warning.kind !== 'secret-name-reused-across-targets'),
  ].sort(compareSecretWarnings);
}

/**
 * Projects an execution allowlist into the bounded provider-visible name set.
 *
 * Generation and Stage 2 must use exactly one C2 projection so a provider
 * cannot receive a differently ordered, oversized, or wildcard-derived view
 * of the policy (SPEC-C3-2). The projection is deliberately not an
 * authorization check: wildcard execution permission contributes no suggested
 * names, while the counts let callers report truncation without retaining the
 * omitted values.
 *
 * @param allow - The configured execution allowlist or its wildcard form.
 * @returns A deterministic provider projection and its retained and omitted
 * counts.
 */
export function projectAllowedNames(allow: readonly SecretName[] | '*'): { readonly names: readonly SecretName[]; readonly kept: number; readonly dropped: number } {
  if (allow === '*') return { names: [], kept: 0, dropped: 0 };
  const all = [...new Set(allow)].sort();
  const names = all.slice(0, 64);
  while (names.length > 0 && Buffer.byteLength(JSON.stringify(names), 'utf8') > 4096) names.pop();
  return { names, kept: names.length, dropped: all.length - names.length };
}

function targetChangeWarnings(previous: PlanDocumentType | undefined, next: PlanDocumentType): SecretWarning[] {
  if (previous === undefined) return [];
  const oldTargets = new Map<string, unknown>();
  for (const step of previous.steps) {
    if (step.kind === 'action' && step.action === 'fill-secret') {
      oldTargets.set(`${secretNameFor(step.secretRef)}\u0000${step.id}`, step.target);
    }
  }
  const warnings: SecretWarning[] = [];
  for (const step of next.steps) {
    if (step.kind !== 'action' || step.action !== 'fill-secret') continue;
    const key = `${secretNameFor(step.secretRef)}\u0000${step.id}`;
    const previousTarget = oldTargets.get(key);
    if (previousTarget !== undefined && JSON.stringify(previousTarget) !== JSON.stringify(step.target)) {
      warnings.push({ kind: 'secret-target-changed', name: secretNameFor(step.secretRef), stepId: step.id, previousTarget: previousTarget as never, target: step.target });
    }
  }
  return warnings.sort(compareSecretWarnings);
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

/** Prepares one selected occurrence for the batch-level consent and settlement stages. */
async function generatePreparedOccurrence(deps: GenerateDeps & { readonly stageTracker?: BatchInterruptionTracker; readonly occurrenceWorkKey?: string }, options: GenerateOptions): Promise<GenerateOutcome> {
  const tracker = deps.stageTracker ?? new BatchInterruptionTracker(deps.signal);
  const ownsTracker = deps.stageTracker === undefined;
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
    if (ownsTracker) for (const [index, file] of discovered.entries()) tracker.addDiscovered(`generate:${index}:${file}`, file);
    const results: GenerateFileOutcome[] = [];
    for (const [index, file] of discovered.entries()) {
      const workKey = deps.occurrenceWorkKey ?? `generate:${index}:${file}`;
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

        const normalizedTestMd = normalizeTestMd(testMd);
        const legacySecretSyntax = scanLegacySecretSyntax(normalizedTestMd);
        if (legacySecretSyntax.length > 0) {
          results.push({
            file,
            status: 'failed',
            error: new SecretSyntaxRejectedError('Legacy secret syntax is not supported.', {
              occurrences: legacySecretSyntax,
              hint: 'Delete the offending line(s) and re-run `ambercast generate`.',
            }),
            ...metrics(),
          });
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

        const provenance = deriveCurrentPlanInputProvenance({
          normalizedTestMd,
          targetDefinitions: resolvedTargets,
        });
        const { inputsDigest, producerBundleFingerprint, producerBundleInputs } = provenance;
        const planPath = deps.layout.planPathFor(file);
        const groundingPath = deps.layout.groundingPathFor(file);

        let forcedPreviousPlan: PlanDocumentType | undefined;
        if (options.force) {
          let snapshot: { readonly text: string } | null;
          try {
            snapshot = await deps.storage.readTextSnapshotIfExists(planPath);
          } catch (error) {
            results.push({ file, status: 'failed', error: fsIoError('The previous plan could not be read.', error), ...metrics() });
            continue;
          }
          if (snapshot !== null) {
            try {
              const parsed = PlanDocument.safeParse(JSON.parse(snapshot.text));
              if (parsed.success) forcedPreviousPlan = parsed.data;
            } catch { /* An invalid old artifact is not a comparison source. */ }
          }
        }

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
              ? { testMd: toAnchoredLines(normalizedTestMd), targets: resolvedTargets, allowedSecretNames: projectAllowedNames(secretAllow).names }
              : { testMd: toAnchoredLines(normalizedTestMd), targets: resolvedTargets, allowedSecretNames: projectAllowedNames(secretAllow).names, previousAttempts }) as unknown as JsonValueT,
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
            named = deriveSecretNames(prepared.data, { projected: projectAllowedNames(secretAllow).names, allowlist: secretAllow });
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

          const secrets = secretRowsForPlan(parsedPlan.data, secretAllow, named.uses);
          const projection = projectAllowedNames(secretAllow);
          const warnings = [
            ...named.warnings,
            ...targetChangeWarnings(forcedPreviousPlan, parsedPlan.data),
            ...(projection.dropped === 0 ? [] : [{ kind: 'allowed-names-truncated' as const, kept: projection.kept, dropped: projection.dropped }]),
          ].sort(compareSecretWarnings);

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
        if (!interruptedDuringAi && ownsTracker) tracker.markTerminal(workKey);
      }
    }

    if (ownsTracker && tracker.interrupted) results.push(...tracker.pendingIdentities.map((file) => ({ file, status: 'skipped' as const })));
    return { results, noTestsFound: false, interrupted: tracker.interrupted };
  } finally {
    if (ownsTracker) tracker.dispose();
  }
}

function renamedPlan(plan: PlanDocumentType, file: string, renames: readonly SecretRename[]): PlanDocumentType {
  const replacements = new Map(renames.filter((rename) => rename.file === file).map((rename) => [rename.name, rename.newName]));
  if (replacements.size === 0) return plan;
  return {
    ...plan,
    steps: plan.steps.map((step) => {
      if (step.kind === 'action' && step.action === 'fill-secret') {
        const replacement = replacements.get(secretNameFor(step.secretRef));
        return replacement === undefined ? step : { ...step, secretRef: `{{secrets.${replacement}}}` as SecretRef };
      }
      if (step.kind === 'ai' && step.secrets !== undefined) {
        return {
          ...step,
          secrets: step.secrets.map((use) => {
            const replacement = replacements.get(secretNameFor(use.ref));
            return replacement === undefined ? use : { ...use, ref: `{{secrets.${replacement}}}` as SecretRef };
          }),
        };
      }
      return step;
    }),
  } as PlanDocumentType;
}

function consentFailure(candidate: PreparedCandidate, reason: 'declined' | 'not-interactive'): GenerateFileOutcome {
  return {
    file: candidate.file,
    status: 'failed',
    error: new SecretConsentRequiredError('Secret consent is required.', { reason, secrets: candidate.uses.map((use) => ({ name: use.name, stepId: use.stepId, envVar: use.envVar, reason: 'requires consent' })), hint: 'Add the secret names to secrets.allow in ambercast.config.json, then rerun `ambercast generate`.' }),
    ...candidate.metrics,
  };
}

/**
 * Generates deterministic plans for selected prompts.
 *
 * @param deps - Storage, configuration, provider, runtime, and optional consent dependencies.
 * @param options - Selection, freshness, preview, and consent policy for this invocation.
 * @returns Results in selected-occurrence order, including case-local failures and interruption state.
 * @throws {@link UnexpectedCrashError} when a required consent capability is unavailable or the consent protocol is malformed.
 * @remarks Generation prepares every occurrence before one consent decision. Accepted names are committed before ordered plan and grounding settlement; a failed artifact write is case-local and does not roll back earlier durable work. `consentMode: 'forbid'` returns candidates without consent or writes.
 */
export async function generate(deps: GenerateDeps, options: GenerateOptions): Promise<GenerateOutcome> {
  const tracker = new BatchInterruptionTracker(deps.signal);
  try {
    const discovered = options.files.length === 0
      ? (await deps.discoverTestFiles({ testDir: deps.config.testDir, testMatch: deps.config.testMatch, testIgnore: deps.config.testIgnore })).map((path) => joinPath(deps.config.testDir, path))
      : [...options.files];
    if (discovered.length === 0) return { results: [], noTestsFound: true, interrupted: false };
    if (options.list) return { results: discovered.map((file) => ({ file, status: 'listed' })), noTestsFound: false, interrupted: false };
    assertPromptPathsEligible(deps.layout, discovered);
    for (const [index, file] of discovered.entries()) tracker.addDiscovered(`generate:${index}:${file}`, file);

    const initialAllow = deps.config.secrets?.allow ?? [];
    const allowSnapshot = initialAllow === '*' ? '*' as const : [...initialAllow];
    const stageConfig = {
      ...deps.config,
      ...(deps.config.secrets === undefined ? {} : { secrets: { ...deps.config.secrets, allow: allowSnapshot } }),
    };
    const virtualTexts = new Map<string, string>();
    const virtualStorage: StorageAdapter = {
      ...deps.storage,
      async exists(path) { return virtualTexts.has(path) || deps.storage.exists(path); },
      async readText(path) { return virtualTexts.get(path) ?? deps.storage.readText(path); },
      async readTextSnapshot(path) {
        const text = virtualTexts.get(path);
        if (text === undefined) return deps.storage.readTextSnapshot(path);
        const bytes = new TextEncoder().encode(text);
        return { text, bytes: new Uint8Array(bytes) };
      },
      async readTextSnapshotIfExists(path) {
        const text = virtualTexts.get(path);
        if (text === undefined) return deps.storage.readTextSnapshotIfExists(path);
        const bytes = new TextEncoder().encode(text);
        return { text, bytes: new Uint8Array(bytes) };
      },
      async writeText(path, content) {
        if (path.endsWith('.ambercast.plan.json') || path.endsWith('.ambercast.grounding.json')) {
          virtualTexts.set(path, content);
          return;
        }
        await deps.storage.writeText(path, content);
      },
    };

    const resultSlots: Array<GenerateFileOutcome | undefined> = Array.from({ length: discovered.length });
    const record = (occurrenceIndex: number, result: GenerateFileOutcome): void => {
      resultSlots[occurrenceIndex] = result;
    };
    const orderedResults = (): GenerateFileOutcome[] => resultSlots.filter((result): result is GenerateFileOutcome => result !== undefined);
    const candidates: PreparedCandidate[] = [];
    const started = new Set<string>();
    const terminal = new Set<string>();
    let aiExecutorPromise: Promise<AiExecutor> | undefined;
    for (const [index, file] of discovered.entries()) {
      const workKey = `generate:${index}:${file}`;
      if (tracker.interrupted) break;
      started.add(workKey);
      const occurrence = await generatePreparedOccurrence(
        {
          ...deps,
          config: stageConfig,
          storage: options.force
            ? { ...virtualStorage, readTextSnapshotIfExists: (path) => deps.storage.readTextSnapshotIfExists(path) }
            : virtualStorage,
          stageTracker: tracker,
          occurrenceWorkKey: workKey,
          resolveAiExecutor: (signal) => {
            aiExecutorPromise ??= deps.resolveAiExecutor(signal);
            return aiExecutorPromise;
          },
        },
        { ...options, files: [file], dryRun: false },
      );
      const result = occurrence.results[0];
      if (result === undefined || result.status === 'failed' || result.status === 'skipped') {
        if (result !== undefined) record(index, result);
        if (!tracker.interrupted) {
          tracker.markTerminal(workKey);
          terminal.add(workKey);
        }
        continue;
      }
      const planPath = deps.layout.planPathFor(file);
      const planText = await virtualStorage.readText(planPath);
      const parsed = PlanDocument.parse(JSON.parse(planText));
      try {
        assertNoEnvVarCollision(enumerateSecretUses(parsed).map(({ ref }) => ref));
      } catch (error) {
        record(index, { file, status: 'failed', error: fileFailure(error, 'The generated secret environment variables could not be inspected.'), durationMs: result.durationMs ?? 0, aiCalls: result.aiCalls ?? 0 });
        tracker.markTerminal(workKey);
        terminal.add(workKey);
        continue;
      }
      const origin = result.status === 'skipped-fresh' ? 'fresh' as const : 'generated' as const;
      virtualTexts.set(planPath, planText);
      candidates.push({
        workKey,
        occurrenceIndex: index,
        file,
        planPath,
        groundingPath: deps.layout.groundingPathFor(file),
        plan: parsed,
        uses: consentRowsForPlan(parsed, result.secrets ?? secretRowsForPlan(parsed, allowSnapshot)),
        warnings: result.warnings ?? existingPlanWarnings(parsed),
        ambiguities: result.ambiguities ?? [],
        origin,
        metrics: { durationMs: result.durationMs ?? 0, aiCalls: result.aiCalls ?? 0 },
        pendingCommit: origin === 'fresh' ? 'repair-grounding-only' : 'write-plan-and-grounding',
      });
    }

    const interruptionResult = (): GenerateOutcome => {
      for (const candidate of candidates) {
        if (!terminal.has(candidate.workKey)) {
          record(candidate.occurrenceIndex, { file: candidate.file, status: 'skipped' });
          terminal.add(candidate.workKey);
        }
      }
      for (const [index, file] of discovered.entries()) {
        const workKey = `generate:${index}:${file}`;
        if (started.has(workKey) && !terminal.has(workKey)) {
          record(index, { file, status: 'skipped' });
          terminal.add(workKey);
        }
      }
      const untouched = new Set<string>();
      for (const [index, file] of discovered.entries()) {
        const workKey = `generate:${index}:${file}`;
        if (!started.has(workKey) && !untouched.has(file)) {
          record(index, { file, status: 'skipped' });
          untouched.add(file);
        }
      }
      return { results: orderedResults(), noTestsFound: false, interrupted: true };
    };
    if (tracker.interrupted) return interruptionResult();

    if (options.consentMode === 'forbid') {
      for (const candidate of candidates) {
        record(candidate.occurrenceIndex, {
          file: candidate.file,
          status: 'candidate' as const,
          plan: candidate.plan,
          secrets: candidate.uses,
          ...(candidate.warnings.length === 0 ? {} : { warnings: candidate.warnings }),
          ...candidate.metrics,
        });
      }
      return {
        results: orderedResults(),
        noTestsFound: false,
        interrupted: false,
      };
    }

    const allowed = allowSnapshot === '*' ? new Set<SecretName>() : new Set(allowSnapshot);
    const neededItems = allowSnapshot === '*' ? [] : candidates.map((candidate) => ({ file: candidate.file, uses: candidate.uses.filter((use) => !allowed.has(use.name)) })).filter((item) => item.uses.length > 0);
    let selected = candidates;
    if (!options.dryRun && options.consentMode !== 'forbid' && neededItems.length > 0) {
      if (deps.consent === undefined) throw new UnexpectedCrashError('Secret consent capability is unavailable.');
      const validateRenames = (renames: readonly SecretRename[]): RenameValidationResult => {
        try {
          if (!Array.isArray(renames)) throw new Error('Malformed rename collection.');
          const requestedRenames: readonly SecretRename[] = renames;
          Array.from(requestedRenames);
          const participantOrder = neededItems.flatMap((item) => item.uses.map((use) => ({ file: item.file, name: use.name })));
          const participant = new Set(participantOrder.map(({ file, name }) => `${file}\u0000${name}`));
          const requestedKeys = new Set<string>();
          const malformed = requestedRenames.some((rename) => {
            const key = `${rename.file}\u0000${rename.name}`;
            if (!participant.has(key) || requestedKeys.has(key)) return true;
            requestedKeys.add(key);
            return false;
          });
          try {
            const plans = candidates.map((candidate) => renamedPlan(candidate.plan, candidate.file, requestedRenames));
            if (malformed || plans.some((plan) => !PlanDocument.safeParse(plan).success)) throw new Error('Invalid rename set.');
            for (const plan of plans) assertNoEnvVarCollision(enumerateSecretUses(plan).map(({ ref }) => ref));
          } catch {
            const failedKeys = participantOrder.filter(({ file, name }) => requestedKeys.has(`${file}\u0000${name}`));
            return { ok: false, failedKeys };
          }
          return { ok: true };
        } catch (error) {
          throw new UnexpectedCrashError('Secret rename validation crashed unexpectedly.', undefined, { cause: error });
        }
      };
      const decision = await deps.consent.request({
        configPath: deps.configSource?.path ?? null,
        items: neededItems.map((item) => ({
          file: item.file,
          uses: item.uses.map((use) => ({ ...use, ref: `{{secrets.${use.name}}}` as SecretRef })),
        })),
        validateRenames,
      });
      if (tracker.interrupted) return interruptionResult();
      if (decision.kind === 'allowed') {
        const validation = validateRenames(decision.renames);
        if (!validation.ok) throw new UnexpectedCrashError('Secret rename validation returned an invalid accepted decision.');
        const renamedSourceUses = new Set(
          candidates.flatMap((candidate) => candidate.uses.filter((use) => decision.renames.some((rename) => rename.file === candidate.file && rename.name === use.name)).map((use) => useOccurrenceKey(candidate.file, use))),
        );
        const finalAllowedNames = [...new Set(candidates.flatMap((candidate) => candidate.uses.map((use) => use.name)).concat(decision.renames.map((rename) => rename.newName)))];
        selected = candidates.map((candidate) => {
          const plan = renamedPlan(candidate.plan, candidate.file, decision.renames);
          return {
            ...candidate,
            plan,
            uses: finalSecretRows(candidate, plan, finalAllowedNames, renamedSourceUses),
            warnings: finalWarnings(candidate, plan),
          };
        });
        const names = [...new Set(selected.flatMap((candidate) => candidate.uses.map((use) => use.name)))];
        await deps.consent.commitAllowlist(deps.configSource?.path ?? null, names, deps.signal);
        if (tracker.interrupted) return interruptionResult();
      } else {
        const neededKeys = new Set(neededItems.flatMap((item) => item.uses.map((use) => `${item.file}\u0000${use.name}`)));
        for (const candidate of candidates) {
          if (candidate.uses.some((use) => neededKeys.has(`${candidate.file}\u0000${use.name}`))) {
            record(candidate.occurrenceIndex, consentFailure(candidate, decision.kind));
            tracker.markTerminal(candidate.workKey);
            terminal.add(candidate.workKey);
          }
        }
        selected = candidates.filter((candidate) => !terminal.has(candidate.workKey));
      }
    }

    for (const candidate of selected) {
      if (tracker.interrupted) return interruptionResult();
      try {
        if (!options.dryRun && options.consentMode !== 'forbid') {
          if (candidate.pendingCommit === 'write-plan-and-grounding') {
            await deps.storage.writeText(candidate.planPath, asArtifactText(candidate.plan as unknown as JsonValueT));
            await deps.storage.writeText(candidate.groundingPath, asArtifactText(emptyGrounding(candidate.plan) as unknown as JsonValueT));
          } else {
            await repairGroundingIfNeeded(deps.storage, candidate.groundingPath, candidate.plan);
          }
        }
        record(candidate.occurrenceIndex, {
          file: candidate.file,
          status: candidate.origin === 'fresh' ? 'skipped-fresh' : options.dryRun ? 'would-generate' : 'generated',
          planFile: candidate.planPath,
          ...((candidate.origin === 'generated' || options.dryRun) ? {
            ambiguities: candidate.ambiguities,
            secrets: candidate.uses.map(({ target: _target, useIndex: _useIndex, ...use }) => use),
          } : {}),
          ...(candidate.warnings.length === 0 ? {} : { warnings: candidate.warnings }),
          ...candidate.metrics,
        });
      } catch (error) {
        record(candidate.occurrenceIndex, { file: candidate.file, status: 'failed', error: fileFailure(error, 'The generated artifacts could not be written.'), ...candidate.metrics });
      }
      tracker.markTerminal(candidate.workKey);
      terminal.add(candidate.workKey);
    }
    return { results: orderedResults(), noTestsFound: false, interrupted: false };
  } finally {
    tracker.dispose();
  }
}
