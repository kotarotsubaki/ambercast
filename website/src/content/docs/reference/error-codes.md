---
title: Error codes
description: Stable error codes with their kind, scope, and exit code, and what each code's details contain.
---

ambercast reports run-level and case-level failures with a fixed set of error codes. Use this page to look up what a code means and which exit code it produces.

## Code vocabulary {#code-vocabulary}

Usage errors and environment errors have separate vocabularies. `SECRET_GRANT_UNATTRIBUTABLE` is the legacy exception. It stays in the report-code schema only for compatibility with reports from an earlier version, and no current error kind or report branch produces it.

| code | kind | scope | exit | condition |
| --- | --- | --- | --- | --- |
| CONFIG_INVALID | usage | run/case | 2 | invalid configuration |
| PROMPT_PATH_INVALID | usage | run only | 2 | selected prompt path ineligible |
| SECRET_UNRESOLVED | usage | run/case | 2 | unresolved secret |
| TARGET_UNRESOLVED | usage | run/case | 2 | target cannot resolve |
| EXECUTOR_UNSUPPORTED | usage | case | 2 | executor lacks a capability or surface the plan needs |
| PROMPT_AMBIGUOUS | usage | case | 2 | generated response has unresolved target ambiguities |
| MISSING_PLAN | usage | run/case | 4 | plan absent |
| STALE_PLAN | usage | run/case | 4 | stale plan |
| INTEGRITY_VIOLATION | usage | run/case | 4 | artifact integrity fails |
| GROUNDING_UNRESOLVED | usage | case | 4 | grounding miss in an ai step or element step without `--resolve`; four other reasons can occur even with `--resolve` |
| SECRET_LITERAL_REJECTED | usage | run/case | 2 | literal secret rejected |
| SECRET_GRANT_UNATTRIBUTABLE | legacy | not producible | — | retained in the report schema for backward compatibility with reports from an earlier tool version; not produced by current `generate`, `run`, `heal`, or `check` |
| SECRET_ENV_VAR_COLLISION | usage | case | 2 | secret environment variable collision |
| SECRET_CONSENT_REQUIRED | usage | case | 2 | secret consent required |
| SECRET_SYNTAX_REJECTED | usage | case | 2 | legacy secret syntax rejected |
| BROWSER_LAUNCH_FAILED | environment | run/case | 3 | browser launch fails |
| AI_EXECUTOR_UNAVAILABLE | environment | run/case | 3 | provider unavailable |
| AI_RESPONSE_INVALID | environment | run/case | 3 | provider response invalid |
| AGENTIC_STEP_FAILED | environment | case | 3 | AI-directed interaction declared failure |
| CASE_ABORTED | environment | case | 3 | case aborted mid-step for a caller-correctable or environmental reason |
| FS_IO_ERROR | environment | run/case | 3 | filesystem operation fails |
| UNEXPECTED_CRASH | environment | run/case | 3 | uncategorized crash |
| INTERRUPTED | environment | run only | 3 | batch cancellation |

### AI response issue codes {#ai-response-issue-codes}

When a generated `confirms` reference fails validation, these `AiResponseIssueCode` values can appear in `AI_RESPONSE_INVALID` retries and report issues. `confirms-unsorted` is internal and never appears in retry feedback.

| code | condition |
| --- | --- |
| `confirms-unknown-step` | referenced step ID is unknown |
| `confirms-not-earlier` | referenced step is the same or later step |
| `confirms-not-action` | referenced step is not an eligible action or capture |
| `confirms-duplicate` | referenced step ID is repeated |

## Details by code {#details}

Only the codes below carry `details`. See [Reports](/ambercast/reference/reports/#errors) for the full contract of each code.

| code | `details` content |
| --- | --- |
| `FS_IO_ERROR` | In case scope, may contain `details.partiallyWritten` with `plan` and/or `grounding`. |
| `AI_RESPONSE_INVALID` | Normalized issues and optional retry attempts. |
| `SECRET_LITERAL_REJECTED` | The detector, the path, and optional attempts. |
| `SECRET_ENV_VAR_COLLISION` | The colliding `envVar` and the list of colliding secret references. |
| `SECRET_CONSENT_REQUIRED` | The reason (`consent-required`, `declined`, or `not-interactive`) and the unresolved secrets, each with its name, step ID, environment variable, and reason. |
| `SECRET_SYNTAX_REJECTED` | Each rejected legacy-syntax occurrence: line, column, and whether it is a grant line or a reference. |
| `AI_EXECUTOR_UNAVAILABLE` | Optional attempts. |
| `BROWSER_LAUNCH_FAILED` | A closed remediation reason (`executable-missing` or `launch-failed`) and the resolved engine name. The fixed remediation hint is the report-level `hint` field, not part of `details`. |
| `AGENTIC_STEP_FAILED` | The step ID, the completed tool-call counters, and an optional last failed assertion. |
| `CASE_ABORTED` | The closed abort reason and the step ID. |
| `PROMPT_AMBIGUOUS` | The count of unresolved ambiguities. |
| `UNEXPECTED_CRASH` | An allowlisted cause name. |
| `EXECUTOR_UNSUPPORTED` | The target, the executor, the reason (`surface-mismatch` or `capability-missing`), the missing capabilities, and optionally the surface. |
| `PROMPT_PATH_INVALID` | The path and the reason (`outside-test-dir`, `not-test-md`, or `no-name`). |
| `GROUNDING_UNRESOLVED` | The step ID and the reason (`missing`, `recoverable-miss`, `no-candidate`, `ambiguous`, `proposal-rejected`, or `candidate-changed`). |

## See also {#see-also}

- [Reports](/ambercast/reference/reports/#errors)
- [Exit codes](/ambercast/reference/exit-codes/#exit-code-table)
- [Troubleshoot common failures](/ambercast/how-to/troubleshoot/)
