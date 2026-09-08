---
title: Error codes
description: Reference vocabulary of stable error codes, execution scopes, and exit codes for ambercast.
---

ambercast defines a stable vocabulary of error codes for run- and case-level failures. For error payload envelopes, see [Reports](/ambercast/reference/reports/#errors); for process exit code definitions, see [Exit codes](/ambercast/reference/exit-codes/#exit-code-table); for recovery workflows, see [Troubleshoot common failures](/ambercast/how-to/troubleshoot/).

## Code vocabulary {#code-vocabulary}

Usage errors and environment errors have independent report vocabularies; each code-to-kind mapping is centralized in `REPORT_ERROR_DETAILS`.

| code | kind | scope | exit | condition |
| --- | --- | --- | --- | --- |
| CONFIG_INVALID | usage | run/case | 2 | invalid configuration |
| SECRET_UNRESOLVED | usage | run/case | 2 | unresolved secret |
| TARGET_UNRESOLVED | usage | run/case | 2 | target cannot resolve |
| MISSING_PLAN | usage | run/case | 4 | plan absent |
| STALE_PLAN | usage | run/case | 4 | stale plan |
| INTEGRITY_VIOLATION | usage | run/case | 4 | artifact integrity fails |
| SECRET_LITERAL_REJECTED | usage | run/case | 2 | literal secret rejected |
| SECRET_GRANT_UNATTRIBUTABLE | usage | run/case | 2 | grant cannot be attributed |
| BROWSER_LAUNCH_FAILED | environment | run/case | 3 | browser launch fails |
| AI_EXECUTOR_UNAVAILABLE | environment | run/case | 3 | provider unavailable |
| AI_RESPONSE_INVALID | environment | run/case | 3 | provider response invalid |
| FS_IO_ERROR | environment | run/case | 3 | filesystem operation fails |
| UNEXPECTED_CRASH | environment | run/case | 3 | uncategorized crash |
| INTERRUPTED | environment | run only | 3 | batch cancellation |

A case-scoped `FS_IO_ERROR` can include `details.partiallyWritten` containing `plan` and/or `grounding`. Where present, `AI_RESPONSE_INVALID` details contain normalized issues and optional retry attempts; `SECRET_LITERAL_REJECTED` details contain its detector, path, and optional attempts; `SECRET_GRANT_UNATTRIBUTABLE` details contain its reason and safe grant location; `AI_EXECUTOR_UNAVAILABLE` details contain optional attempts; and `UNEXPECTED_CRASH` details contain an allowlisted cause name. See [Reports](/ambercast/reference/reports/#errors) for the complete per-code contract.
