---
title: 报告
description: ambercast 结构化输出字段与结果 Schema 的完整规范参考。
---

ambercast 的所有结构化输出均通过统一的信封（Envelope）与命令专属的结果结构呈现。公开报告 Schema 中的所有对象均采用严格模式，拒绝任何未知字段。

## 信封 {#envelope}

| 字段 | 类型与约定 |
| --- | --- |
| `schemaVersion` | 字面量 `3.2` |
| `command` | `generate`、`run`、`check`、`heal` 或 `review` |
| `startedAt` | UTC 格式字符串（`YYYY-MM-DDTHH:mm:ssZ`） |
| `durationMs` | 非负整数 |
| `summary` | 严格由 `total`、`passed`、`failed`、`errored`、`skipped` 组成的非负整数对象 |
| `errors` | `ReportError` 数组 |
| `results` | 特定命令的结果数组 |
| `reportPersistence` | 仅限 `run`：`persisted`、`failed` 或 `not-attempted` |

公开报告 Schema 中的对象均为严格模式，拒绝任何未知字段。`review` 分支已在 Schema 中定义，但当前已实现的 CLI 中尚未提供 `review` 命令。

## 结果形态 {#result-shapes}

信封中的 `results` 数组根据具体命令而异；下文列出了已实现以及仅在 Schema 中定义的各个分支。

## Generate 结果 {#generate-results}

`GenerateResult` 的每个分支均为严格模式，未列出的字段均被禁止。

| 状态 | 必需字段 | 禁止出现的分支字段 |
| --- | --- | --- |
| `generated` | `id`, `file`, `planFile`, `dryRun: false`, `ambiguities: JSON[]` | — |
| `would-generate` | `id`, `file`, `planFile`, `dryRun: true`, `ambiguities: JSON[]` | — |
| `skipped-fresh` | `id`, `file`, `planFile`, `dryRun: boolean` | `ambiguities` |
| `listed` | `id`, `file`, `dryRun: false` | `planFile`, `ambiguities` |
| `failed` | `id`, `file`, `dryRun: boolean` | `planFile`, `ambiguities` |
| `skipped` | `id`, `file` | `planFile`, `dryRun`, `ambiguities` |

## Run 结果 {#run-results}

`RunResult` 的每个分支均为严格模式。

| 状态 | 必需字段 | 禁止出现的分支字段 |
| --- | --- | --- |
| `passed` / `failed` / `error` | `id`, `file`, `planFile`, `durationMs`, `steps`, `explanation` | — |
| `listed` | `id`, `file` | `planFile`, `durationMs`, `steps`, `explanation` |
| `skipped` | `id`, `file` | `planFile`, `durationMs`, `steps`, `explanation` |

## Check 结果 {#check-results}

`CheckResult` 的每个分支均为严格模式。

| 状态 | 必需字段 | 可选字段 | 禁止出现的分支字段 |
| --- | --- | --- | --- |
| `fresh`, `stale`（已过期）, `orphaned-plan`, `orphaned-grounding`, `missing-plan`, `missing-grounding`, `stale-grounding`, `invalid-grounding`, `fresh-without-grounding` | `id`, `file`, `planFile`, `reason` | `groundingFile`, `artifactFile` | — |
| `invalid-artifact-name` | `id`, `file`, `artifactFile`, `reason` | — | `planFile`, `groundingFile` |
| `listed` | `id`, `file` | — | `planFile`, `reason`, `groundingFile`, `artifactFile` |
| `skipped` | `id`, `file` | — | `planFile`, `reason`, `groundingFile`, `artifactFile` |

## Heal 结果 {#heal-results}

`HealResult` 的每个已完成分支均要求具备 `id`、`file`、`planFile`、`status: completed`、`durationMs`、`steps` 和 `explanation`。

| `repairOutcome` | 允许的 application | 允许的 stopReason |
| --- | --- | --- |
| `healed` | `applied`, `preview-only`, `declined`, `not-applied-interrupted`, `apply-failed`, `partially-applied` | `settled`, `attempt-limit`, `deadline` |
| `partially-healed` | `applied`, `preview-only`, `declined`, `not-applied-interrupted`, `apply-failed`, `partially-applied` | `settled`, `attempt-limit`, `deadline` |
| `unresolved` | `no-artifact-change`, `not-eligible` | `settled`, `attempt-limit`, `deadline` |
| `no-changes-needed` | `no-artifact-change` | `settled` |
| `listed` | 仅限标识字段：`id`, `file`, `status` | 禁止字段：`application`, `stopReason`, `planFile`, `durationMs`, `steps`, `explanation` |
| `skipped` | 仅限标识字段：`id`, `file`, `status` | 禁止字段：`application`, `stopReason`, `planFile`, `durationMs`, `steps`, `explanation` |

## 结果状态 {#result-statuses}

共享的步骤（step）与审查（review）结果结构。

| 分支 | 必需字段 | 可选字段 |
| --- | --- | --- |
| `step` | `id`, `type: action/assert/capture/ai`, `status: passed/failed/error/skipped` | `kind: assertion/environment`, `expected`, `actual`, `screenshot`, `screenshotOmitted: secret-detected`, `observed` |
| `observed` | `note`: 固定为 `OBSERVED_NOTE`, `accessibilitySnapshot` | — |
| `review sufficient / insufficient` | `id`, `file`, `planFile`, `concerns[]` | — |
| `review skipped` | `id`, `file`, `status: skipped` | `concerns`, `planFile` |

## Review 关注事项 {#review-concerns}

`ReviewConcern` 结构包含以下字段：

| 字段 | 类型 |
| --- | --- |
| `stepId` | `string` |
| `concern` | `string` |
| `suggestion` | `string` |

## 错误 {#errors}

报告错误是严格对象，其作用域为整个命令运行或特定测试用例。每个条目均包含 `scope`、`kind`、`code` 和 `message`；每个代码均可选 `hint`，case 作用域的条目还包含非空白的 `caseId`。`details` 可选，且仅可用于以下七个代码。凡显示 `attempts`，其类型均为 `Array<{ attempt: 1–5 的整数, code: ReportErrorCode }>`；`SecretRef` 使用 `{{secrets.<identifier>(.<identifier>)*}}` 语法。

| 代码 | 可选的 `details` 形状 |
| --- | --- |
| `AI_RESPONSE_INVALID` | `{ issues: Array<{ code: 任一 instruction-coverage issue code、"invalid-json" 或 "schema-mismatch"; path: Array<string 或非负整数>; stepId?: StepId }>, attempts?: ... }` |
| `SECRET_LITERAL_REJECTED` | `{ detector: credential-prefix-sk、credential-prefix-ghp、credential-prefix-aws-access-key、high-entropy-token 或 embedded-secret-reference; path: 非空白字符串; attempts?: ... }` |
| `SECRET_GRANT_UNATTRIBUTABLE` | `{ reason: "uncovered-grant", secretRef: SecretRef, sourceSpan: { startLine: 正整数, endLine: 不小于 startLine 的正整数 }, attempts?: ... }`，或 `{ reason: citation-not-found、citation-not-unique、citation-missing-ref、citation-unresolved、multiply-attributed-grant 或 stale-grant-span; secretRef: SecretRef; stepId?: StepId; attempts?: ... }` |
| `AI_EXECUTOR_UNAVAILABLE` | `{ attempts?: ... }` |
| `UNEXPECTED_CRASH` | `{ cause: { name: "Error"、"TypeError"、"RangeError"、"SyntaxError"、"ReferenceError"、"AbortError" 或 "TimeoutError" } }` |
| `FS_IO_ERROR` | 仅限 case 作用域：`{ partiallyWritten: Array<"plan" 或 "grounding"> }` |
| `PROMPT_PATH_INVALID` | `{ path: 非空白字符串, reason: "outside-test-dir"、"not-test-md" 或 "no-name" }` |

## 报告持久化 {#persistence}

仅 `run` 命令会尝试进行持久化。写入路径为 `runsDir/runId/report.json`，通过对最终确定的持久化信封执行 `JSON.stringify` 写入。

`reportPersistence` 字段记录持久化结果：
- `persisted`：成功写入，且磁盘中的 JSON 内容与返回的信封完全一致。
- `failed`：写入失败，且未留下可见的部分写入内容。
- `not-attempted`：从未尝试写入，包括在得出执行结果前命令即已失败的情况。

```json
{"schemaVersion":"3.2","command":"generate","startedAt":"2026-09-06T00:00:00Z","durationMs":0,"summary":{"total":0,"passed":0,"failed":0,"errored":0,"skipped":0},"results":[],"errors":[]}
```
```json
{"schemaVersion":"3.2","command":"run","startedAt":"2026-09-06T00:00:00Z","durationMs":0,"summary":{"total":0,"passed":0,"failed":0,"errored":0,"skipped":0},"results":[],"errors":[],"reportPersistence":"not-attempted"}
```
```json
{"schemaVersion":"3.2","command":"check","startedAt":"2026-09-06T00:00:00Z","durationMs":0,"summary":{"total":0,"passed":0,"failed":0,"errored":0,"skipped":0},"results":[],"errors":[]}
```
```json
{"schemaVersion":"3.2","command":"heal","startedAt":"2026-09-06T00:00:00Z","durationMs":0,"summary":{"total":0,"passed":0,"failed":0,"errored":0,"skipped":0},"results":[],"errors":[]}
```

## 持久化兼容性链接 {#report-persistence}

本节作为向后兼容保留的历史锚点，关于报告持久化的完整说明请参阅 [报告](/ambercast/zh-cn/reference/reports/#persistence)。

相关链接：[错误代码](/ambercast/zh-cn/reference/error-codes/#code-vocabulary)、[退出码](/ambercast/zh-cn/reference/exit-codes/#exit-code-table)、[文件布局](/ambercast/zh-cn/reference/file-layout/#run-artifacts)、[ambercast run](/ambercast/zh-cn/reference/cli/run/#report-and-exits)。
