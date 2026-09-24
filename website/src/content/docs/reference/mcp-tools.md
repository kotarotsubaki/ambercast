---
title: MCP Tools
description: Tool contracts, inputs, results, and errors for ambercast MCP workflows.
---

The MCP server exposes six tools in this order: `ambercast_generate`, `ambercast_run`, `ambercast_check`, `ambercast_heal`, `ambercast_job_status`, and `ambercast_job_cancel`. Tool names use the ambercast prefix and snake_case; the server does not mirror every CLI command.

## Tool table {#tool-table}

Annotations list readOnly / destructive / idempotent / openWorld, in that order. All four values are explicit. They are hints, not authorization. Generate's idempotent hint is weak: a fresh Plan is skipped and effects converge, but AI output can vary.

| Tool | CLI equivalent | Annotations | `isError: true` | Negative result with `isError: false` |
| --- | --- | --- | --- | --- |
| `ambercast_generate` | generate | false / false / true (weak) / false | Exit 2 or 3 | Exit 1 (strict ambiguity), exit 5 |
| `ambercast_run` | run | false / false / false / true | Exit 2, 3, or 4 (MISSING_PLAN / STALE_PLAN / INTEGRITY_VIOLATION / GROUNDING_UNRESOLVED) | Exit 1 (assertion red), exit 5 |
| `ambercast_check` | check | true / false / true / false | Exit 2 or 3 | Exit 4 (stale is a normal result in results[].status), exit 5 |
| `ambercast_heal` | heal | false / true / false / true | Exit 2 (including CI refusal), 3, or 4; `HEAL_APPLY_TOKEN_INVALID`; `HEAL_APPLY_FAILED` | Exit 1 (unresolved or declined), exit 5 |
| `ambercast_job_status` | — | true / false / true / false | `JOB_NOT_FOUND`; `JOB_FAILED` for a failed job; completed/cancelled jobs with a result use their source tool's mapping | Nonterminal record, job list, queued-cancel record |
| `ambercast_job_cancel` | — | false / false / true / false | `JOB_NOT_FOUND` | — |

The report's aggregated exit code determines `isError`; the server does not reclassify individual report errors. The heal tool also sets the Claude Code interaction hint, but the hint is not proof of approval.

## Inputs {#inputs}

Inputs are strict objects. Unknown keys, type mismatches, and invalid refinements produce the SDK's `Input validation error` text with `isError: true`. Supply `{}` when there are no arguments.

| Scope | Properties and defaults |
| --- | --- |
| Common workflow input | `files?: string[]` (omission and `[]` both select config discovery; relative paths use the session root), `allowEmpty?: boolean` (false) |
| `ambercast_generate` | `target?: string` (restricts which Target definitions the generator may use), `strict?: boolean` (false), `force?: boolean` (false), `dryRun?: boolean` (false), `ai?: 'claude' \| 'codex'` |
| `ambercast_run` | `grep?: string` (valid regular expression), `resolve?: boolean` (false), `updateCache?: boolean` (false), `ai?: 'claude' \| 'codex'` |
| `ambercast_check` | Common input only |
| `ambercast_heal` | `dryRun?: boolean` (true), `applyToken?: string`, `ai?: 'claude' \| 'codex'` |
| `ambercast_job_status` | `jobId?: string` (omit for this server process's job list), `waitMs?: number` (0; integer 0–45000, effective with a job ID) |
| `ambercast_job_cancel` | `jobId: string` |

The MCP input intentionally excludes CLI flags `headed` (headless fixed), `list`, `stale` (fail fixed), `json`, `yes` (replaced by `applyToken`), and `configPath`.

## Heal preview and apply {#heal-preview-and-apply}

`ambercast_heal` defaults to preview (`dryRun: true`), unlike CLI heal's false default. A preview with commits returns an `applyToken`; a preview without commits does not. Apply with `dryRun: false` and `applyToken` alone: `files`, `ai`, and `allowEmpty` must be absent. A preview must omit `applyToken`. An invalid combination is an SDK input validation error. Apply is synchronous and does not create a job. A token is a 128-bit random value rendered as 32 hexadecimal characters; a newer preview supersedes pending tokens. Pending tokens expire 600000 ms after their first token-bearing response is assembled. A consumed token replays its saved result for 600000 ms after settlement.

If the client supports form elicitation, it asks for confirmation with a 600000 ms timeout. Accepting and confirming applies the repair; declining leaves it unapplied; cancellation interrupts it. If the client lacks form elicitation, the server authorizes apply. The token identifies a preview; requesting apply is a separate step, and client hints alone are not authorization.

## Results and jobs {#results-and-jobs}

Every tool omits `outputSchema`: the report JSON Schema is 136 KB and would crowd `tools/list`; tools may also return either a report envelope or a Job record. A completed report uses the same `structuredContent` envelope as CLI JSON output, without adding an exit code to that envelope. Screenshots remain project-root-relative paths in it, never inline base64.

The single text item begins with `exitCode: <n>`. Only a heal preview with commits has a second line `applyToken: <token>`; the following line contains the envelope JSON. The response also has `_meta.exitCode` and, when present, `_meta.applyToken`. A completed job fetched by `ambercast_job_status` returns the same content, error classification, and metadata, plus `_meta.job` without the result.

Every generate, run, and heal preview call creates a Job. If it finishes within the synchronous wait bound, the caller receives the report response; otherwise it receives a job handle. A handle and a nonterminal status response contain a Job record in `structuredContent`; the text has three lines: `jobId: <id>`, `status: <status>`, and the status message. Their metadata contains `_meta.jobId`. `ambercast_check` and heal apply stay synchronous. `ambercast_job_status` with no ID lists jobs for this server process, newest first, as `structuredContent` with a `jobs` array; an empty list has text `no jobs`. This is a server-local job path, not the MCP Tasks extension. `ambercast_job_cancel` cancels a running or queued job and returns a record. Job records disappear 1800000 ms after termination or when the server exits.

| Job record field | Meaning |
| --- | --- |
| `jobId` | UUID v4 identifier |
| `tool` | Source tool |
| `status` | working, completed, failed, or cancelled |
| `statusMessage` | Nonempty progress or terminal status message |
| `progress` | Count of runtime events, even without progress notifications |
| `createdAt` | ISO 8601 UTC creation time |
| `lastUpdatedAt` | ISO 8601 UTC time of the latest status or progress change |
| `pollIntervalMs` | 2000 |
| `ttlMs` | 1800000 |

## MCP errors {#mcp-errors}

MCP-layer semantic failures have `isError: true`, one text item in the form `"<CODE>: <message>"`, and no `structuredContent`. The codes are `HEAL_APPLY_TOKEN_INVALID` (reason `missing`, `unknown-token`, `superseded`, or `expired`), `HEAL_APPLY_FAILED`, `JOB_NOT_FOUND`, and `JOB_FAILED`. Invalid inputs instead use the SDK validation error. Domain and environment failures remain in report envelopes.

## Changes from the planned design {#changes-from-the-planned-design}

| Earlier planned page | Implemented contract |
| --- | --- |
| Five tools including review | Six tools: four workflows plus status and cancellation; review is not exposed |
| Report `outputSchema` published | `outputSchema` omitted for every tool |
| Heal preview only | Two-stage heal with `applyToken` and synchronous apply |
| Synchronous workflows only | Long generate, run, and heal previews return jobs; status without ID lists them |
| Server flags unspecified | `ambercast mcp` supports `--dir` and `--sync-wait-ms` |
| Only report exit classification | MCP error codes and SDK validation errors are distinct from report envelopes |
| CLI flag mapping unspecified | Inputs exclude `headed`, `list`, `stale`, `json`, `yes`, and `configPath` |
| Exit code only inferred from report | `_meta.exitCode` and the first text line carry the exit code |
| `target` specified as common to all four tools | `target` is accepted only by `ambercast_generate`; `ambercast_run`, `ambercast_check`, and `ambercast_heal` select Targets from the Plan itself, matching the CLI's own Plan IR v4 migration |

Links: [ambercast mcp](/ambercast/reference/cli/mcp/#usage), [MCP server](/ambercast/agents/mcp-server/#connection-boundary), [Reports](/ambercast/reference/reports/#envelope), [Exit codes](/ambercast/reference/exit-codes/#exit-code-table).
