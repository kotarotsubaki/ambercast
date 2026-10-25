/*
 * Canonical CLI/view shared source for error-details key order and projection.
 */

/**
 * Keeps the report detail field order canonical for CLI and HTTP view consumers.
 * Projection is shared here so each consumer can apply escaping at its own boundary.
 */
export const ERROR_DETAILS_KEY_ORDER: Readonly<Record<string, readonly string[]>> = {
  EXECUTOR_UNSUPPORTED: ['target', 'executor', 'reason', 'missing', 'surface'],
  BROWSER_LAUNCH_FAILED: ['reason', 'engine'],
  PROMPT_PATH_INVALID: ['path', 'reason'],
  AI_RESPONSE_INVALID: ['issues', 'attempts'],
  AGENTIC_STEP_FAILED: ['stepId', 'actions', 'assertions', 'passedAssertions', 'failedAssertions', 'targetRejections', 'lastFailedAssertion'],
  SECRET_LITERAL_REJECTED: ['detector', 'path', 'attempts'],
  SECRET_ENV_VAR_COLLISION: ['envVar', 'refs'],
  SECRET_CONSENT_REQUIRED: ['reason', 'secrets'],
  SECRET_SYNTAX_REJECTED: ['occurrences'],
  AI_EXECUTOR_UNAVAILABLE: ['attempts'],
  UNEXPECTED_CRASH: ['cause'],
  FS_IO_ERROR: ['partiallyWritten'],
  GROUNDING_UNRESOLVED: ['stepId', 'reason'],
  CASE_ABORTED: ['reason', 'stepId'],
  PROMPT_AMBIGUOUS: ['ambiguities'],
};

/**
 * Projects report details into ordered, stringified entries for CLI and HTTP view.
 * Values remain unescaped so each consumer applies its own output-boundary escaping.
 */
export function errorDetailEntries(code: string, details: unknown): Array<[string, string]> {
  if (details === null || typeof details !== 'object' || Array.isArray(details)) {
    return [];
  }

  const detailRecord = details as Record<string, unknown>;
  const fields = Object.hasOwn(ERROR_DETAILS_KEY_ORDER, code)
    ? ERROR_DETAILS_KEY_ORDER[code]!
    : [];

  return fields
    .filter((key) => Object.hasOwn(detailRecord, key))
    .map((key) => {
      const value = detailRecord[key];
      if (key === 'issues' && Array.isArray(value)) {
        const issues = value.map((issue) => {
          if (issue === null || typeof issue !== 'object' || Array.isArray(issue)) {
            return String(issue);
          }
          const issueRecord = issue as Record<string, unknown>;
          return `${String(issueRecord.code ?? '')} @ ${JSON.stringify(issueRecord.path)}`;
        }).join('; ');
        return [key, issues];
      }
      const rendered = value !== null && typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
      return [key, rendered];
    });
}
