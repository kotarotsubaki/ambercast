---
title: Error codes
description: Reference vocabulary of stable error codes, execution scopes, and exit codes for ambercast.
---

ambercast defines a stable vocabulary of error codes for run- and case-level failures. For error payload envelopes, see [Reports](/ambercast/reference/reports/#errors); for process exit code definitions, see [Exit codes](/ambercast/reference/exit-codes/#exit-code-table); for recovery workflows, see [Troubleshoot common failures](/ambercast/how-to/troubleshoot/).

## Code vocabulary {#code-vocabulary}

Usage errors and environment errors have independent report vocabularies. `SECRET_GRANT_UNATTRIBUTABLE` is the legacy exception: it remains in the report-code schema solely for backward compatibility with reports from an earlier tool version, but has no current `ErrorKind` or report-error branch.

| code | kind | scope | exit | condition |
| --- | --- | --- | --- | --- |
| CONFIG_INVALID | usage | run/case | 2 | invalid configuration |
| PROMPT_PATH_INVALID | usage | run only | 2 | selected prompt path ineligible |
| SECRET_UNRESOLVED | usage | run/case | 2 | unresolved secret |
| TARGET_UNRESOLVED | usage | run/case | 2 | target cannot resolve |
| MISSING_PLAN | usage | run/case | 4 | plan absent |
| STALE_PLAN | usage | run/case | 4 | stale plan |
| INTEGRITY_VIOLATION | usage | run/case | 4 | artifact integrity fails |
| GROUNDING_UNRESOLVED | usage | case | 4 | grounding miss without `--resolve` |
| SECRET_LITERAL_REJECTED | usage | run/case | 2 | literal secret rejected |
| SECRET_GRANT_UNATTRIBUTABLE | legacy | not producible | — | retained in the report schema for backward compatibility with reports from an earlier tool version; not produced by current `generate`, `run`, `heal`, or `check` |
| SECRET_ENV_VAR_COLLISION | usage | case | 2 | secret environment variable collision |
| SECRET_CONSENT_REQUIRED | usage | case | 2 | secret consent required |
| SECRET_SYNTAX_REJECTED | usage | case | 2 | legacy secret syntax rejected |
| BROWSER_LAUNCH_FAILED | environment | run/case | 3 | browser launch fails |
| AI_EXECUTOR_UNAVAILABLE | environment | run/case | 3 | provider unavailable |
| AI_RESPONSE_INVALID | environment | run/case | 3 | provider response invalid |
| FS_IO_ERROR | environment | run/case | 3 | filesystem operation fails |
| UNEXPECTED_CRASH | environment | run/case | 3 | uncategorized crash |
| INTERRUPTED | environment | run only | 3 | batch cancellation |

A case-scoped `FS_IO_ERROR` can include `details.partiallyWritten` containing `plan` and/or `grounding`. Where present, `AI_RESPONSE_INVALID` details contain normalized issues and optional retry attempts; `SECRET_LITERAL_REJECTED` details contain its detector, path, and optional attempts; `SECRET_ENV_VAR_COLLISION` details contain the colliding `envVar` and the list of colliding secret refs; `SECRET_CONSENT_REQUIRED` details contain the reason (`consent-required`, `declined`, or `not-interactive`) and the list of unresolved secrets, each with its name, step id, environment variable, and reason; `SECRET_SYNTAX_REJECTED` details contain each rejected legacy-syntax occurrence (line, column, and whether it is a grant line or reference); `AI_EXECUTOR_UNAVAILABLE` details contain optional attempts; `BROWSER_LAUNCH_FAILED` details contain a closed remediation reason (`executable-missing`, `engine-unregistered`, or `launch-failed`) and the resolved engine name — its fixed remediation hint is the report-level `hint` field, not part of `details`; and `UNEXPECTED_CRASH` details contain an allowlisted cause name. See [Reports](/ambercast/reference/reports/#errors) for the complete per-code contract.
