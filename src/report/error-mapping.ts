import type { AmbercastError, ErrorKind } from '#core/errors/types.js';
import {
  AiExecutorUnavailableDetails,
  AiResponseInvalidDetails,
  BrowserLaunchFailedDetails,
  CauseName,
  PromptPathInvalidDetails,
  SecretGrantUnattributableDetails,
  SecretLiteralRejectedDetails,
  UnexpectedCrashDetails,
  type ReportError,
  type ReportErrorCode,
} from './schema.js';

const CAUSE_NAMES = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'AbortError', 'TimeoutError']);

function readRecordField(value: unknown, key: string): unknown {
  try {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)[key]
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Projects a trusted caught error to the report's stable cause vocabulary.
 *
 * Only genuine `Error` instances establish class identity at this public
 * boundary. The conservative fallback prevents untrusted values or hostile
 * accessors from turning crash reporting into a second failure.
 */
export function projectCauseName(cause: unknown): CauseName {
  try {
    if (!(cause instanceof Error)) return 'Error';
    const name = cause.name;
    return CAUSE_NAMES.has(name) ? name as CauseName : 'Error';
  } catch {
    return 'Error';
  }
}

/**
 * Maps classified Ambercast errors to stable report classifications and codes.
 *
 * @remarks
 * All report builders use this identical `ErrorKind` to `{ kind, code }`
 * correspondence. Keeping it here prevents drift between hand-maintained
 * command tables. Interruption maps to the stable environment vocabulary but
 * remains a run-only condition; the conversion boundary rejects any attempt
 * to attach it to a case. `prompt-path-invalid` carries the same run-only
 * restriction for a different reason: it is always raised before any case's
 * work begins, so no case identifier could ever describe it truthfully. Its
 * process status still comes only from
 * `ERROR_EXIT_CODES`, while each interrupted report builder creates exactly
 * one `{ scope: 'run', kind: 'environment', code: 'INTERRUPTED' }` entry. The
 * `test/unit/report/error-code-correspondence.test.ts` contract test pins
 * `ERROR_EXIT_CODES` and `ReportErrorCode` directly, so the correspondence is
 * not coupled to a particular report builder as its home.
 */
export const REPORT_ERROR_DETAILS = {
  'config-invalid': { kind: 'usage', code: 'CONFIG_INVALID' },
  'secret-unresolved': { kind: 'usage', code: 'SECRET_UNRESOLVED' },
  'target-unresolved': { kind: 'usage', code: 'TARGET_UNRESOLVED' },
  'prompt-path-invalid': { kind: 'usage', code: 'PROMPT_PATH_INVALID' },
  'secret-literal-rejected': { kind: 'usage', code: 'SECRET_LITERAL_REJECTED' },
  'secret-grant-unattributable': { kind: 'usage', code: 'SECRET_GRANT_UNATTRIBUTABLE' },
  'missing-plan': { kind: 'usage', code: 'MISSING_PLAN' },
  'stale-ir': { kind: 'usage', code: 'STALE_PLAN' },
  'integrity-violation': { kind: 'usage', code: 'INTEGRITY_VIOLATION' },
  'browser-launch-failed': {
    kind: 'environment',
    code: 'BROWSER_LAUNCH_FAILED',
    hint: 'Install Chromium by running `npx playwright install chromium`, then retry.',
  },
  'ai-executor-unavailable': { kind: 'environment', code: 'AI_EXECUTOR_UNAVAILABLE' },
  'ai-response-invalid': { kind: 'environment', code: 'AI_RESPONSE_INVALID' },
  'fs-io-error': { kind: 'environment', code: 'FS_IO_ERROR' },
  'unexpected-crash': { kind: 'environment', code: 'UNEXPECTED_CRASH' },
  interrupted: { kind: 'environment', code: 'INTERRUPTED' },
} as const satisfies Partial<Record<ErrorKind, {
  readonly kind: 'usage' | 'environment';
  readonly code: ReportErrorCode;
  readonly hint?: string;
}>>;

/**
 * Converts a classified error into a serializable run- or case-scoped report
 * error.
 *
 * @param error - The classified failure to serialize.
 * @param location - The report scope, including a case identifier when needed.
 * @returns The stable report error corresponding to the classified failure.
 * @throws {Error} If the error kind has no report-code correspondence, or if
 * interruption or prompt-path-invalid is requested at case scope. Interruption
 * describes an incomplete batch, while prompt-path-invalid is always raised
 * before any case begins, so both remain run-only.
 *
 * @remarks
 * For diagnostics without a table-defined hint, a string
 * `error.details.hint` is copied for every report scope and code. The seven
 * existing diagnostic codes construct strict `details` values from normalized
 * producer context; `UNEXPECTED_CRASH` alone reads `error.cause`, never
 * `error.details`. `BROWSER_LAUNCH_FAILED` projects `{ reason, engine }`
 * from source details, validating the reason against its closed three-value
 * vocabulary and the engine against the resolved engine passed through the
 * case location.
 *
 * Unlike every other code, `BROWSER_LAUNCH_FAILED` has a table-defined
 * hint in `REPORT_ERROR_DETAILS`. That hint is authoritative over an
 * instance-level `error.details.hint`; other codes retain the instance-level
 * hint precedence described above. If no resolved engine reaches the
 * location, the browser-launch projection omits `details` defensively, just
 * as it does for malformed producer details, while the table-defined hint
 * still appears. The case location keeps `engine` as a string so this
 * report-layer boundary does not depend on the browser-port vocabulary.
 *
 * A malformed or unexpected producer details shape is omitted defensively
 * rather than causing report construction to throw.
 *
 * `partiallyWritten` is extracted only for a case-scoped `FS_IO_ERROR`.
 * Report schemas reject that field on every other branch, and this conversion
 * otherwise omits `AmbercastError.details`, so preserving validated storage
 * evidence here is required rather than optional metadata.
 */
export function reportError(error: AmbercastError, location: { readonly scope: 'run' }): ReportError;
export function reportError(error: AmbercastError, location: { readonly scope: 'case'; readonly caseId: string; readonly engine?: string }): ReportError;
export function reportError(
  error: AmbercastError,
  location: { readonly scope: 'run' } | { readonly scope: 'case'; readonly caseId: string; readonly engine?: string },
): ReportError {
  const details = REPORT_ERROR_DETAILS[error.kind as keyof typeof REPORT_ERROR_DETAILS];
  if (details === undefined) {
    throw new Error(`Error kind ${error.kind} cannot be serialized as a report error.`);
  }
  if (error.kind === 'interrupted' && location.scope === 'case') {
    throw new Error('Error kind interrupted cannot be serialized at case scope.');
  }
  if (error.kind === 'prompt-path-invalid' && location.scope === 'case') {
    throw new Error('Error kind prompt-path-invalid cannot be serialized at case scope.');
  }

  const tableHint = 'hint' in details ? details.hint : undefined;
  const instanceHint = readRecordField(error.details, 'hint');
  const hint = tableHint ?? (typeof instanceHint === 'string' ? instanceHint : undefined);
  const hintField = hint === undefined ? {} : { hint };
  const sourceDetails = error.details;
  const browserLaunchDetails = error.kind === 'browser-launch-failed'
    && location.scope === 'case'
    && location.engine !== undefined
    ? (() => {
      const candidate = BrowserLaunchFailedDetails.safeParse({
        reason: readRecordField(sourceDetails, 'reason'),
        engine: readRecordField(sourceDetails, 'engine'),
      });
      return candidate.success && candidate.data.engine === location.engine
        ? candidate
        : BrowserLaunchFailedDetails.safeParse({ reason: 'launch-failed', engine: location.engine });
    })()
    : undefined;
  const detailsByCode = error.kind === 'ai-response-invalid' && readRecordField(sourceDetails, 'issues') !== undefined
    ? AiResponseInvalidDetails.safeParse({
      issues: readRecordField(sourceDetails, 'issues'),
      ...(readRecordField(sourceDetails, 'attempts') === undefined ? {} : { attempts: readRecordField(sourceDetails, 'attempts') }),
    })
    : error.kind === 'secret-literal-rejected'
      ? SecretLiteralRejectedDetails.safeParse({
        detector: readRecordField(sourceDetails, 'detector'),
        path: readRecordField(sourceDetails, 'path'),
        ...(readRecordField(sourceDetails, 'attempts') === undefined ? {} : { attempts: readRecordField(sourceDetails, 'attempts') }),
      })
      : error.kind === 'prompt-path-invalid'
        ? PromptPathInvalidDetails.safeParse({
          path: readRecordField(sourceDetails, 'path'),
          reason: readRecordField(sourceDetails, 'reason'),
        })
      : error.kind === 'secret-grant-unattributable'
        ? SecretGrantUnattributableDetails.safeParse({
          reason: readRecordField(sourceDetails, 'reason'),
          secretRef: readRecordField(sourceDetails, 'secretRef'),
          ...(readRecordField(sourceDetails, 'sourceSpan') === undefined
            ? { stepId: readRecordField(sourceDetails, 'stepId') }
            : { sourceSpan: readRecordField(sourceDetails, 'sourceSpan') }),
          ...(readRecordField(sourceDetails, 'attempts') === undefined ? {} : { attempts: readRecordField(sourceDetails, 'attempts') }),
        })
        : error.kind === 'ai-executor-unavailable' && readRecordField(sourceDetails, 'attempts') !== undefined
          ? AiExecutorUnavailableDetails.safeParse({
            ...(readRecordField(sourceDetails, 'attempts') === undefined ? {} : { attempts: readRecordField(sourceDetails, 'attempts') }),
          })
          : error.kind === 'unexpected-crash'
            ? UnexpectedCrashDetails.safeParse({ cause: { name: projectCauseName(error.cause) } })
            : error.kind === 'browser-launch-failed'
              ? browserLaunchDetails
            : undefined;
  const diagnosticDetails = detailsByCode?.success ? { details: detailsByCode.data } : {};

  const partiallyWritten = readRecordField(error.details, 'partiallyWritten');
  const fsIoDetails = error.kind === 'fs-io-error'
    && Array.isArray(partiallyWritten)
    && partiallyWritten.every((artifact): artifact is 'plan' | 'grounding' => artifact === 'plan' || artifact === 'grounding')
    ? { details: { partiallyWritten: [...partiallyWritten] } }
    : {};

  return (location.scope === 'run'
    ? { scope: location.scope, ...details, message: error.message, ...hintField, ...diagnosticDetails }
    : { scope: location.scope, ...details, caseId: location.caseId, message: error.message, ...hintField, ...diagnosticDetails, ...fsIoDetails }) as ReportError;
}
