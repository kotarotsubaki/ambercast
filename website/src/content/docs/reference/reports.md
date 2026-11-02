---
title: Reports
description: Report envelope, per-command result shapes, error details, and persistence rules for ambercast structured JSON reports.
---

Each command can emit one JSON report with run metadata, a summary, errors, and command-specific results.

## Envelope {#envelope}

All objects in the public report schemas are strict and reject unknown fields. The schema defines a `review` branch, but the CLI has no `review` command.

| field | type and contract |
| --- | --- |
| `schemaVersion` | literal `3.11` |
| `command` | `generate`, `run`, `check`, `heal`, or `review` |
| `startedAt` | UTC string shaped `YYYY-MM-DDTHH:mm:ssZ` |
| `durationMs` | non-negative integer |
| `summary` | strict object with non-negative integers `total`, `passed`, `failed`, `errored`, `skipped` |
| `errors` | array of `ReportError` |
| `results` | command-specific result array |
| `reportPersistence` | `run` only: `persisted`, `failed`, or `not-attempted` |

## Result shapes {#result-shapes}

The `results` array depends on the command. The next sections list each branch, including the ones only the schema defines.

## Generate results {#generate-results}

Every `GenerateResult` branch is strict. The optional fields listed are the only extra fields a branch allows.

| status | required fields | optional fields | forbidden fields |
| --- | --- | --- | --- |
| `generated` | `id`, `file`, `planFile`, `dryRun: false`, `ambiguities: JSON[]`, `secrets` | `durationMs`, `aiCalls`, `warnings` | — |
| `would-generate` | `id`, `file`, `planFile`, `dryRun: true`, `ambiguities: JSON[]`, `secrets` | `durationMs`, `aiCalls`, `warnings` | — |
| `skipped-fresh` (`dryRun: true`) | `id`, `file`, `planFile`, `dryRun: true`, `secrets` | `durationMs`, `aiCalls`, `warnings` | `ambiguities` |
| `skipped-fresh` (`dryRun: false`) | `id`, `file`, `planFile`, `dryRun: false` | `durationMs`, `aiCalls` | `ambiguities`, `secrets`, `warnings` |
| `listed` | `id`, `file`, `dryRun: false` | — | `planFile`, `ambiguities`, `durationMs`, `aiCalls` |
| `failed` | `id`, `file`, `dryRun: boolean` | `durationMs`, `aiCalls` | `planFile`, `ambiguities` |
| `skipped` | `id`, `file` | — | `planFile`, `dryRun`, `ambiguities`, `durationMs`, `aiCalls` |

The AI provider can list assumptions that the prompt does not state, in an optional string array named `assumptions`. On `generated` and `would-generate` results, `generate` adds each nonblank assumption to `warnings` as `{ kind: 'generator-assumption', message }`. Assumptions never stop `generate` or `heal`.

The human-readable output prints `  warning: <message>` right after the result line. If an assumption matches secret detection, ambercast replaces it with `An assumption was omitted because it looked like a secret.`.

ambercast does not store assumptions in the plan. A re-run on a fresh plan returns `skipped-fresh` with no assumption warnings. Pass `--force` to regenerate and see the assumptions again. Regeneration is non-deterministic.

On `generated` and `would-generate` results, `ambiguities` is always `[]`. A provider's `ambiguities` means only that a step's target cannot be assigned.

For a single target, ambercast retries a response with nonempty `ambiguities` as `AI_RESPONSE_INVALID`, and exits 3 when the retries run out. An unresolved assignment across several targets still produces `PROMPT_AMBIGUOUS` and exit 2.

A consumer that validates warning kinds as a closed union needs the report 3.11 schema.

## Run results {#run-results}

Every `RunResult` branch is strict.

| status | required fields | optional fields | forbidden fields |
| --- | --- | --- | --- |
| `passed` / `failed` / `error` | `id`, `file`, `planFile`, `durationMs`, `steps`, `sessions`, `explanation` | `aiCalls` | — |
| `listed` | `id`, `file` | — | `planFile`, `durationMs`, `steps`, `explanation`, `aiCalls` |
| `skipped` | `id`, `file` | — | `planFile`, `durationMs`, `steps`, `explanation`, `aiCalls` |

## Check results {#check-results}

Every `CheckResult` branch is strict.

| status | required fields | optional fields | forbidden fields |
| --- | --- | --- | --- |
| `fresh`, `stale`, `orphaned-plan`, `orphaned-grounding`, `missing-plan`, `missing-grounding`, `stale-grounding`, `invalid-grounding`, `fresh-without-grounding` | `id`, `file`, `planFile`, `reason` | `groundingFile`, `artifactFile` | — |
| `invalid-artifact-name` | `id`, `file`, `artifactFile`, `reason` | — | `planFile`, `groundingFile` |
| `listed` | `id`, `file` | — | `planFile`, `reason`, `groundingFile`, `artifactFile` |
| `skipped` | `id`, `file` | — | `planFile`, `reason`, `groundingFile`, `artifactFile` |

## Heal results {#heal-results}

Every completed `HealResult` branch requires `id`, `file`, `planFile`, `status: completed`, `durationMs`, `steps`, `sessions`, and `explanation`. `aiCalls` is optional.

Only a `healed` row can carry the optional `warnings`, which holds `generator-assumption` items from the `assumptions` of the accepted Stage 3 candidate. Other heal results forbid `warnings`. Assumptions do not fail Stage 3.

| repairOutcome | allowed application | allowed stopReason |
| --- | --- | --- |
| `healed` | `applied`, `preview-only`, `declined`, `not-applied-interrupted`, `apply-failed`, `partially-applied` | `settled`, `attempt-limit`, `deadline` |
| `partially-healed` | `applied`, `preview-only`, `declined`, `not-applied-interrupted`, `apply-failed`, `partially-applied` | `settled`, `attempt-limit`, `deadline` |
| `unresolved` | `no-artifact-change`, `not-eligible` | `settled`, `attempt-limit`, `deadline` |
| `no-changes-needed` | `no-artifact-change` | `settled` |
| `listed` | identity-only: `id`, `file`, `status` | forbidden: `application`, `stopReason`, `planFile`, `durationMs`, `steps`, `explanation` |
| `skipped` | identity-only: `id`, `file`, `status` | forbidden: `application`, `stopReason`, `planFile`, `durationMs`, `steps`, `explanation` |

When Stage 3 rejects a full-plan candidate because its set of logical secret names changes, the completed result has `stage3Rejection: { reason: "secret-set-changed", added: SecretName[], removed: SecretName[] }`. The rejection is hard. No artifact is committed, and you must regenerate with consent instead of silently reassigning the candidate.

Every completed branch can also carry `repairTrace`, an ordered diagnostic array of the case's Stage 1, Stage 2, and Stage 3 attempts. Each entry is strict, so fields from another stage or outcome are not allowed.

| stage | outcome | other fields |
| --- | --- | --- |
| `stage1` | `accepted`, `no-advance` | `stepId` |
| `stage1` | `not-eligible` | `stepId`, `reason`: one of `frontier-out-of-range`, `mode-none`, `trace-current`, `no-confirming-step`, `no-confirms` |
| `stage2` | `accepted` | `stepId` |
| `stage2` | `rejected` | `stepId`, `reason`: one of `provider-error`, `response-shape`, `id-mismatch`, `secret-name-invalid`, `coverage-invalid`, `obligation-mismatch`, `literal-secret`, `no-advance`, `intent-invalid` |
| `stage3` | `accepted` | — |
| `stage3` | `not-passing` | `firstFailureIndex` |
| `stage3` | `failed` | optional `code` |
| `stage3` | `secret-set-rejected` | — |

A phase that admission denies adds no `repairTrace` entry. It shows up only through the case's `stopReason: "attempt-limit"` or `"deadline"`. Interrupted work never reaches a completed result. It is reported as `skipped`, so it has no `repairTrace` entry and no `stopReason`.

## Result statuses {#result-statuses}

Step and review results share these branches.

| branch | required fields | optional fields |
| --- | --- | --- |
| `step` | `id`, `type: action/assert/capture/ai`, `target`, `status: passed/failed/error/skipped` | `variable` on capture only, `kind: assertion/environment`, `expected`, `actual`, `screenshot`, `screenshotOmitted: secret-detected`, `observed`, `binding` |
| `observed` | `note`: the fixed `OBSERVED_NOTE`, `accessibilitySnapshot` | — |
| `review sufficient / insufficient` | `id`, `file`, `planFile`, `concerns[]` | — |
| `review skipped` | `id`, `file`, `status: skipped` | — |

After local verification, an action or capture step can carry `binding: { provenance: "grounding" | "quoted-match" | "ai-proposed", confirmed: boolean, quoteWaitMs?: non-negative integer, aiProposalMs?: non-negative integer }`. For `grounding`, `confirmed` is always `true`, because the binding came from an entry confirmed in an earlier run. It does not mean the entry was written in this run. For `quoted-match` and `ai-proposed`, it holds the value at case end. The timing fields appear only when those stages ran. Earlier binding failures report a case error instead.

Every executed run result and every completed heal result has a `sessions` entry for each target in the plan. Each value is `{ surface: "web", executor: { kind: "playwright", browser: "chromium" }, state }`, where `state` is `not-opened`, `closed`, or `close-failed`. `not-opened` means the target's launch returned no session, including when execution stopped before its first step. A failed close leaves the case status unchanged.

## Review concerns {#review-concerns}

A review reports its findings as concerns on the plan.

| field | type |
| --- | --- |
| `stepId` | string |
| `concern` | string |
| `suggestion` | string |

## Errors {#errors}

A report error is a strict object scoped to the whole run or to one case. Every entry has `scope`, `kind`, `code`, and `message`. `hint` is optional for every code, and a case-scoped entry also has a non-whitespace `caseId`. `details` is optional and exists only for the fifteen codes below.

Where `attempts` appears, it is `Array<{ attempt: integer 1–5, code: ReportErrorCode }>`. A `SecretRef` has the syntax `{{secrets.<identifier>(.<identifier>)*}}`.

| code | optional `details` shape |
| --- | --- |
| `AGENTIC_STEP_FAILED` | `{ stepId: non-whitespace string, actions: non-negative integer, assertions: non-negative integer, passedAssertions: non-negative integer, failedAssertions: non-negative integer, targetRejections: non-negative integer, lastFailedAssertion?: { check: "text-visible" \| "element-visible" \| "text-equals" \| "url-matches" \| "element-count", expected: string } }` Case scope only. The counters describe completed tool calls. |
| `CASE_ABORTED` | `{ reason: "run-reference-invalid" \| "run-value-missing" \| "secret-fill-incomplete" \| "agentic-no-terminal-evidence" \| "agentic-coverage-inexact" \| "agentic-proof-invalid" \| "grounding-secret-contaminated" \| "grounding-snapshot-invalid", stepId: string }` Case scope only. `reason` has eight defined values. |
| `AI_RESPONSE_INVALID` | `{ issues: Array<{ code: instruction-coverage, element-intent, or confirms issue code \| "text-equals-self-quote" \| "invalid-json" \| "schema-mismatch" \| "secret-allowed-name-not-projected" \| "secret-conflicting-target-names", path: Array<string or non-negative integer>, stepId?: StepId }>, attempts?: ... }` The `confirms` issue codes are `confirms-unknown-step`, `confirms-not-earlier`, `confirms-not-action`, and `confirms-duplicate`. The last two non-`confirms` issue codes always carry `stepId`. |
| `SECRET_LITERAL_REJECTED` | `{ detector: credential-prefix-sk \| credential-prefix-ghp \| credential-prefix-aws-access-key \| high-entropy-token \| embedded-secret-reference, path: non-whitespace string, attempts?: ... }` |
| `SECRET_ENV_VAR_COLLISION` | `{ envVar: non-whitespace string, refs: SecretRef[] }` `refs` has at least two entries. |
| `SECRET_CONSENT_REQUIRED` | `{ reason: "consent-required" \| "declined" \| "not-interactive", secrets: Array<{ name: SecretName, stepId: StepId, envVar: non-whitespace string, reason: string }> }` The inner `reason` can be any string. |
| `SECRET_SYNTAX_REJECTED` | `{ occurrences: Array<{ line: positive integer, column: positive integer, kind: "grant-line" \| "reference" }> }` |
| `BROWSER_LAUNCH_FAILED` | `{ reason: "executable-missing" \| "launch-failed", engine: non-whitespace string }` |
| `EXECUTOR_UNSUPPORTED` | `{ target: non-whitespace string, executor: non-whitespace string, reason: "surface-mismatch" \| "capability-missing", missing: UiCapability[], surface?: { target: "web", executor: non-whitespace string } }` |
| `PROMPT_AMBIGUOUS` | `{ ambiguities: integer at least 1 }` Case scope only. |
| `AI_EXECUTOR_UNAVAILABLE` | `{ attempts?: ... }` |
| `UNEXPECTED_CRASH` | `{ cause: { name: "Error" \| "TypeError" \| "RangeError" \| "SyntaxError" \| "ReferenceError" \| "AbortError" \| "TimeoutError" } }` |
| `FS_IO_ERROR` | `{ partiallyWritten: Array<"plan" \| "grounding"> }` Case scope only. |
| `PROMPT_PATH_INVALID` | `{ path: non-whitespace string, reason: "outside-test-dir" \| "not-test-md" \| "no-name" }` |
| `GROUNDING_UNRESOLVED` | `{ stepId: string, reason: "missing" \| "recoverable-miss" \| "no-candidate" \| "ambiguous" \| "proposal-rejected" \| "candidate-changed" }` For an element step, `missing` means no grounding entry exists, and `recoverable-miss` means an existing entry does not match the current page. |

On `generated` and `would-generate` results, `secrets` lists the candidate secret uses that ambercast resolved. A dry-run `skipped-fresh` result includes it too. The optional `warnings` records non-fatal policy warnings of five kinds: `secret-name-reused-across-targets`, `secret-target-changed`, `allowed-names-truncated`, `action-unconfirmed` (with `stepId`), and `generator-assumption`. These fields make consent-related output observable without exposing secret values. For the high-risk `"*"` setting, see [Secret consent](/ambercast/reference/configuration/#secret-consent).

## Report persistence {#persistence}

Only `run` persists a report. It writes `runsDir/runId/report.json` with `JSON.stringify` of the finalized envelope.

The `reportPersistence` property records the write outcome:

- `persisted` follows a successful write whose JSON on disk equals the returned envelope.
- `failed` follows a write failure with no partial content visible.
- `not-attempted` applies when no write is tried, including a command failure before an outcome.

Only the writer is pinned to the current schema version. The viewer reads any 3.x report leniently. The examples below show one envelope per command.

```json
{"schemaVersion":"3.11","command":"generate","startedAt":"2026-09-06T00:00:00Z","durationMs":120,"summary":{"total":1,"passed":1,"failed":0,"errored":0,"skipped":0},"results":[{"id":"checkout.test.md","file":"checkout.test.md","planFile":"checkout.ambercast.plan.json","status":"generated","dryRun":false,"ambiguities":[],"secrets":[{"name":"LOGIN_PASSWORD","stepId":"fill-password","envVar":"AMBERCAST_SECRET_LOGIN_PASSWORD","allowed":true,"selectionSource":"target-slug"}],"durationMs":120,"aiCalls":1}],"errors":[]}
```
```json
{"schemaVersion":"3.11","command":"run","startedAt":"2026-09-06T00:00:00Z","durationMs":0,"summary":{"total":0,"passed":0,"failed":0,"errored":0,"skipped":0},"results":[],"errors":[],"reportPersistence":"not-attempted"}
```
```json
{"schemaVersion":"3.11","command":"check","startedAt":"2026-09-06T00:00:00Z","durationMs":0,"summary":{"total":0,"passed":0,"failed":0,"errored":0,"skipped":0},"results":[],"errors":[]}
```
```json
{"schemaVersion":"3.11","command":"heal","startedAt":"2026-09-06T00:00:00Z","durationMs":0,"summary":{"total":0,"passed":0,"failed":0,"errored":0,"skipped":0},"results":[],"errors":[]}
```

## Persistence compatibility anchor {#report-persistence}

This section keeps an older anchor alive. See [Report persistence](/ambercast/reference/reports/#persistence) for the content.

## See also {#see-also}

- [Error codes](/ambercast/reference/error-codes/#code-vocabulary)
- [Exit codes](/ambercast/reference/exit-codes/#exit-code-table)
- [File layout](/ambercast/reference/file-layout/#run-artifacts)
- [ambercast run](/ambercast/reference/cli/run/#report-and-exits)
