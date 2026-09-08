---
title: Reports
description: Reference for ambercast structured report schemas, envelope properties, command result shapes, and error structures.
---

Ambercast reports provide structured, machine-readable JSON execution data for commands. Every object across public report schemas is strict and rejects unknown fields, organizing status metadata, execution duration, summary metrics, errors, and command-specific result payloads into a top-level envelope.

## Envelope {#envelope}

All objects across the public report schemas are strict and reject unknown fields. The `review` branch is defined in the schema, but no `review` command is available in the implemented CLI.

| Field | Type and Contract |
| --- | --- |
| `schemaVersion` | literal 3.1 |
| `command` | `generate`, `run`, `check`, `heal`, or `review` |
| `startedAt` | UTC-shaped YYYY-MM-DDTHH:mm:ssZ string |
| `durationMs` | non-negative integer |
| `summary` | strict `total`, `passed`, `failed`, `errored`, `skipped` non-negative integers |
| `errors` | array of ReportError |
| `results` | command-specific result array |
| `reportPersistence` | `run` only: `persisted`, `failed`, or `not-attempted` |

## Result shapes {#result-shapes}

The envelope's `results` array is command-specific. The following sections enumerate each implemented and schema-only branch.

## Generate results {#generate-results}

In `GenerateResult`, every branch is strict; fields not listed are forbidden.

| Status | Required Fields | Forbidden Branch Fields |
| --- | --- | --- |
| `generated` | `id`, `file`, `planFile`, `dryRun: false`, `ambiguities: JSON[]` | — |
| `would-generate` | `id`, `file`, `planFile`, `dryRun: true`, `ambiguities: JSON[]` | — |
| `skipped-fresh` | `id`, `file`, `planFile`, `dryRun: boolean` | `ambiguities` |
| `listed` | `id`, `file`, `dryRun: false` | `planFile`, `ambiguities` |
| `failed` | `id`, `file`, `dryRun: boolean` | `planFile`, `ambiguities` |
| `skipped` | `id`, `file` | `planFile`, `dryRun`, `ambiguities` |

## Run results {#run-results}

In `RunResult`, every branch is strict.

| Status | Required Fields | Forbidden Branch Fields |
| --- | --- | --- |
| `passed` / `failed` / `error` | `id`, `file`, `planFile`, `durationMs`, `steps`, `explanation` | — |
| `listed` | `id`, `file` | `planFile`, `durationMs`, `steps`, `explanation` |
| `skipped` | `id`, `file` | `planFile`, `durationMs`, `steps`, `explanation` |

## Check results {#check-results}

In `CheckResult`, every branch is strict.

| Status | Required Fields | Optional Fields | Forbidden Branch Fields |
| --- | --- | --- | --- |
| `fresh`, `stale`, `orphaned-plan`, `orphaned-grounding`, `missing-plan`, `missing-grounding`, `stale-grounding`, `invalid-grounding`, `fresh-without-grounding` | `id`, `file`, `planFile`, `reason` | `groundingFile`, `artifactFile` | — |
| `invalid-artifact-name` | `id`, `file`, `artifactFile`, `reason` | — | `planFile`, `groundingFile` |
| `listed` | `id`, `file` | — | `planFile`, `reason`, `groundingFile`, `artifactFile` |
| `skipped` | `id`, `file` | — | `planFile`, `reason`, `groundingFile`, `artifactFile` |

## Heal results {#heal-results}

In `HealResult`, every completed branch requires `id`, `file`, `planFile`, `status: completed`, `durationMs`, `steps`, and `explanation`.

| repairOutcome | Allowed Application | Allowed stopReason |
| --- | --- | --- |
| `healed` | `applied`, `preview-only`, `declined`, `not-applied-interrupted`, `apply-failed`, `partially-applied` | `settled`, `attempt-limit`, `deadline` |
| `partially-healed` | `applied`, `preview-only`, `declined`, `not-applied-interrupted`, `apply-failed`, `partially-applied` | `settled`, `attempt-limit`, `deadline` |
| `unresolved` | `no-artifact-change`, `not-eligible` | `settled`, `attempt-limit`, `deadline` |
| `no-changes-needed` | `no-artifact-change` | `settled` |
| `listed` | identity-only: `id`, `file`, `status` | `application`, `stopReason`, `planFile`, `durationMs`, `steps`, `explanation` |
| `skipped` | identity-only: `id`, `file`, `status` | `application`, `stopReason`, `planFile`, `durationMs`, `steps`, `explanation` |

## Result statuses {#result-statuses}

Step and review execution structures share common result branches.

| Branch | Required Fields | Optional Fields |
| --- | --- | --- |
| `step` | `id`, `type: action/assert/capture/ai`, `status: passed/failed/error/skipped` | `kind: assertion/environment`, `expected`, `actual`, `screenshot`, `screenshotOmitted: secret-detected`, `observed` |
| `observed` | `note: fixed OBSERVED_NOTE`, `accessibilitySnapshot` | — |
| `review sufficient / insufficient` | `id`, `file`, `planFile`, `concerns[]` | — |
| `review skipped` | `id`, `file`, `status: skipped` | `concerns`, `planFile` |

## Review concerns {#review-concerns}

Structures representing diagnostic findings reported during plan review.

| Field | Type |
| --- | --- |
| `stepId` | string |
| `concern` | string |
| `suggestion` | string |

## Errors {#errors}

Report errors are strict objects scoped to either the overall command run or a specific test case. Every entry has `scope`, `kind`, `code`, and `message`; `hint` is optional for every code, and case-scoped entries additionally have a non-whitespace `caseId`. `details` is optional and is available only for these six codes. Whenever shown, `attempts` is `Array<{ attempt: integer 1–5, code: ReportErrorCode }>`; `SecretRef` has the `{{secrets.<identifier>(.<identifier>)*}}` syntax.

| Code | Optional `details` shape |
| --- | --- |
| `AI_RESPONSE_INVALID` | `{ issues: Array<{ code: any instruction-coverage issue code, "invalid-json", or "schema-mismatch"; path: Array<string or non-negative integer>; stepId?: StepId }>, attempts?: ... }` |
| `SECRET_LITERAL_REJECTED` | `{ detector: credential-prefix-sk, credential-prefix-ghp, credential-prefix-aws-access-key, high-entropy-token, or embedded-secret-reference; path: non-whitespace string; attempts?: ... }` |
| `SECRET_GRANT_UNATTRIBUTABLE` | `{ reason: "uncovered-grant", secretRef: SecretRef, sourceSpan: { startLine: positive integer, endLine: positive integer at least startLine }, attempts?: ... }` or `{ reason: citation-not-found, citation-not-unique, citation-missing-ref, citation-unresolved, multiply-attributed-grant, or stale-grant-span; secretRef: SecretRef; stepId?: StepId; attempts?: ... }` |
| `AI_EXECUTOR_UNAVAILABLE` | `{ attempts?: ... }` |
| `UNEXPECTED_CRASH` | `{ cause: { name: "Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "AbortError", or "TimeoutError" } }` |
| `FS_IO_ERROR` | Case scope only: `{ partiallyWritten: Array<"plan" or "grounding"> }` |

## Report persistence {#persistence}

Only `run` attempts persistence, writing to `runsDir/runId/report.json` using `JSON.stringify` of the finalized persisted envelope.

The `reportPersistence` property tracks the write outcome:
- `persisted` follows a successful write whose disk JSON equals the returned envelope.
- `failed` follows a write failure with no partial content visible.
- `not-attempted` applies when a write is never tried, including a command failure before an outcome.

```json
{"schemaVersion":"3.1","command":"generate","startedAt":"2026-09-06T00:00:00Z","durationMs":0,"summary":{"total":0,"passed":0,"failed":0,"errored":0,"skipped":0},"results":[],"errors":[]}
```
```json
{"schemaVersion":"3.1","command":"run","startedAt":"2026-09-06T00:00:00Z","durationMs":0,"summary":{"total":0,"passed":0,"failed":0,"errored":0,"skipped":0},"results":[],"errors":[],"reportPersistence":"not-attempted"}
```
```json
{"schemaVersion":"3.1","command":"check","startedAt":"2026-09-06T00:00:00Z","durationMs":0,"summary":{"total":0,"passed":0,"failed":0,"errored":0,"skipped":0},"results":[],"errors":[]}
```
```json
{"schemaVersion":"3.1","command":"heal","startedAt":"2026-09-06T00:00:00Z","durationMs":0,"summary":{"total":0,"passed":0,"failed":0,"errored":0,"skipped":0},"results":[],"errors":[]}
```

## Persistence compatibility link {#report-persistence}

See [Reports](/ambercast/reference/reports/#persistence) for report persistence details.

Links: [Error codes](/ambercast/reference/error-codes/#code-vocabulary), [Exit codes](/ambercast/reference/exit-codes/#exit-code-table), [File layout](/ambercast/reference/file-layout/#run-artifacts), [ambercast run](/ambercast/reference/cli/run/#report-and-exits).
