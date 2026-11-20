---
title: 报告
description: ambercast 结构化 JSON 报告的信封、各命令的结果形状、错误详情和持久化规则。
---

每个命令都可以输出一份 JSON 报告，其中包含运行元数据、汇总、错误和各命令专属的结果。

## 信封 {#envelope}

公开报告 schema 中的所有对象都是严格的，会拒绝未知字段。schema 定义了 `review` 分支，但 CLI 中没有 `review` 命令。

| 字段 | 类型与约定 |
| --- | --- |
| `schemaVersion` | 字面量 `3.12` |
| `command` | `generate`、`run`、`check`、`heal` 或 `review` |
| `startedAt` | 格式为 `YYYY-MM-DDTHH:mm:ssZ` 的 UTC 字符串 |
| `durationMs` | 非负整数 |
| `summary` | 严格对象，包含非负整数 `total`、`passed`、`failed`、`errored`、`skipped` |
| `errors` | `ReportError` 数组 |
| `results` | 各命令专属的结果数组 |
| `reportPersistence` | 仅 `run`：`persisted`、`failed` 或 `not-attempted` |

## 结果形状 {#result-shapes}

`results` 数组取决于命令。接下来的各节列出每个分支，包括只在 schema 中定义的分支。

## generate 的结果 {#generate-results}

`GenerateResult` 的每个分支都是严格的。所列的可选字段是该分支允许的仅有的额外字段。

| 状态 | 必需字段 | 可选字段 | 禁止字段 |
| --- | --- | --- | --- |
| `generated` | `id`, `file`, `planFile`, `dryRun: false`, `ambiguities: JSON[]`, `secrets` | `durationMs`, `aiCalls`, `warnings` | — |
| `would-generate` | `id`, `file`, `planFile`, `dryRun: true`, `ambiguities: JSON[]`, `secrets` | `durationMs`, `aiCalls`, `warnings` | — |
| `skipped-fresh` (`dryRun: true`) | `id`, `file`, `planFile`, `dryRun: true`, `secrets` | `durationMs`, `aiCalls`, `warnings` | `ambiguities` |
| `skipped-fresh` (`dryRun: false`) | `id`, `file`, `planFile`, `dryRun: false` | `durationMs`, `aiCalls` | `ambiguities`, `secrets`, `warnings` |
| `listed` | `id`, `file`, `dryRun: false` | — | `planFile`, `ambiguities`, `durationMs`, `aiCalls` |
| `failed` | `id`, `file`, `dryRun: boolean` | `durationMs`, `aiCalls` | `planFile`, `ambiguities` |
| `skipped` | `id`, `file` | — | `planFile`, `dryRun`, `ambiguities`, `durationMs`, `aiCalls` |

AI 提供方可以在可选的字符串数组 `assumptions` 中列出提示词没有写明的假设。在 `generated` 和 `would-generate` 的结果中，`generate` 会把每条非空白的假设作为 `{ kind: 'generator-assumption', message }` 加入 `warnings`。假设不会让 `generate` 或 `heal` 停止。

面向人的输出会在结果行之后立即打印 `warning: <message>`，前面有两个空格的缩进。假设命中机密检测时，ambercast 会把它替换为 `An assumption was omitted because it looked like a secret.`。

ambercast 不会把假设存入执行计划。对仍然新鲜的执行计划再次运行，会返回不带假设警告的 `skipped-fresh`。传入 `--force` 可以重新生成并再次看到假设。重新生成具有不确定性。

在 `generated` 和 `would-generate` 的结果中，`ambiguities` 始终为 `[]`。提供方返回的 `ambiguities` 只表示某个步骤的目标无法确定。

只有一个目标时，ambercast 会把带非空 `ambiguities` 的响应按 `AI_RESPONSE_INVALID` 重试，重试用尽后退出码为 3。涉及多个目标的分配仍未解决时，仍会产生 `PROMPT_AMBIGUOUS`，退出码为 2。

把警告类别当作封闭联合类型来校验的使用方，需要使用报告 3.11 的 schema。

## run 的结果 {#run-results}

`RunResult` 的每个分支都是严格的。

| 状态 | 必需字段 | 可选字段 | 禁止字段 |
| --- | --- | --- | --- |
| `passed` / `failed` / `error` | `id`, `file`, `planFile`, `durationMs`, `steps`, `sessions`, `explanation` | `aiCalls`, `replayReadiness`, `warnings` | — |
| `listed` | `id`, `file` | — | `planFile`, `durationMs`, `steps`, `explanation`, `aiCalls` |
| `skipped` | `id`, `file` | — | `planFile`, `durationMs`, `steps`, `explanation`, `aiCalls` |

`run` 会为取得有效且未过期执行计划的每个用例输出 `replayReadiness`，包括 `failed` 和 `error` 用例。取得执行计划前就结束的用例和 `heal` 行不含此字段。

`ready` 表示定位缓存文件已包含无需 AI 回放所需的条目。此判定不涵盖页面变化导致条目不再匹配的情况。检查范围是 click、press、fill、fill-secret、capture 和 ai 步骤；不含这些步骤的执行计划为 `ready`。

| `status` | 其他字段 |
| --- | --- |
| `ready` | 无 |
| `not-ready` | `reason`：`grounding-missing`、`grounding-invalid`、`grounding-stale` 或 `grounding-unreadable` |
| `not-ready` | `reason: 'steps-unresolved'`，以及按执行计划顺序排列的非空 `steps` 数组 |

`steps` 中的每项为 `{ id, reason }`。缺少条目时，理由为 `no-entry`；类型或意图不匹配时为 `entry-mismatch`；AI 步骤的记录缺少回放所需验证时为 `trace-uncovered`。

判定依据是回写处理结束后重新读取的文件。只有在 `not-ready` 且存在待保存的更改，但回写权限不允许保存时，结果才带 `unsavedReason: 'write-back-not-allowed'`。写入失败时不加此字段，而是通过用例错误说明。

`replayReadiness` 在 schema 中是可选字段。3.11 及更早版本的报告即使没有此字段也仍可读取。准备状态不会改变用例的通过与否或退出码。

### 操作前已成立的断言警告 {#assertion-warnings}

`run` 结果中的 `warnings` 用 `{ kind: 'assert-held-before-actions', stepId }` 标记操作前已成立的断言。`stepId` 指向执行时也通过的 assert。这个断言可能没有验证从上一次检查到本次检查之间一系列操作的效果。

警告本身不改变判定或退出码，通过的断言仍然通过。要提高断言质量，应检查操作生效后才成立的条件，例如只在操作后出现的文字。参见[提示词示例](/ambercast/zh-cn/how-to/write-effective-prompts/#quote-new-text)。

确认块由连续的 assert 组成。区间从前一个确认块结束后开始，到下一个确认块结束时为止；第一个区间从用例开头开始。capture 会分隔确认块，但不算操作。

这里的操作包括 click、press、fill、fill-secret、navigate 和 ai 步骤。如果区间包含操作，ambercast 会在第一个操作之前，对末尾确认块中的每个 assert 求值一次。

支持的检查类型如下：

- text-visible
- element-visible
- text-equals
- url-matches
- element-count

AI 步骤内部的检查和不含操作的区间不在观测范围内。

观测只读取页面，不增加或改变操作、AI 调用、event 或保存的文件。如果目标的 session 尚未启动，ambercast 会跳过观测，不会为观测启动它。无法观测时，或执行时变量展开后的期望值与观测时不同，都不会产生警告。

是否使用 `--resolve` 不影响这一行为。heal 内部的回放不进行观测，heal 行也不包含此类警告。`healed` 行中的 `generator-assumption` 警告与此不同。

取得有效且最新执行计划的用例会包含 `warnings`，没有警告时为空数组。随后失败或出错的用例仍会保留此前已通过断言的警告，顺序与执行计划一致。取得执行计划前就停止的用例省略该字段。

schema 将 `warnings` 定义为可选字段。不含此字段的旧版报告仍可读取。面向人的输出在用例行下方逐条显示警告，每条一行，位置在回放准备状态的提示之前。

```text
  warning: <stepId>: this assertion already held before the preceding actions ran, so it may not verify their effect
```

此警告有以下局限：

- 检查状态保持不变的有效断言也可能触发警告，例如再次导航到同一页面。
- 观测只发生在区间的第一个操作之前。如果断言在区间中途才成立，即使未验证后续操作的效果，也不会触发警告。
- 如果前一个操作引起的渲染尚未完成，观测可能漏掉警告。
- 观测耗时可能推迟后续步骤的开始。在页面随时间变化的应用中，这种延迟可能导致针对短暂出现目标的操作失败。

## check 的结果 {#check-results}

`CheckResult` 的每个分支都是严格的。

| 状态 | 必需字段 | 可选字段 | 禁止字段 |
| --- | --- | --- | --- |
| `fresh` | `id`, `file`, `planFile`, `reason` | `groundingFile`, `artifactFile`, `replayReadiness` | — |
| `stale`, `orphaned-plan`, `orphaned-grounding`, `missing-plan`, `missing-grounding`, `stale-grounding`, `invalid-grounding`, `fresh-without-grounding` | `id`, `file`, `planFile`, `reason` | `groundingFile`, `artifactFile` | — |
| `invalid-artifact-name` | `id`, `file`, `artifactFile`, `reason` | — | `planFile`, `groundingFile` |
| `listed` | `id`, `file` | — | `planFile`, `reason`, `groundingFile`, `artifactFile` |
| `skipped` | `id`, `file` | — | `planFile`, `reason`, `groundingFile`, `artifactFile` |

只有 `fresh` 行带 `replayReadiness`。其值为 `{ status: 'ready' }`，或包含 `status: 'not-ready'`、`reason: 'steps-unresolved'` 和 `steps` 的对象。`steps` 的结构与 [run 的结果](#run-results)相同。

`check` 不输出 `unsavedReason`。包括 `fresh-without-grounding` 在内的其他状态行均不含 `replayReadiness`。

## heal 的结果 {#heal-results}

`HealResult` 中每个已完成的分支都必须包含 `id`、`file`、`planFile`、`status: completed`、`durationMs`、`steps`、`sessions` 和 `explanation`。`aiCalls` 是可选的。

只有 `healed` 行可以带可选的 `warnings`，其中是被接受的第 3 阶段候选的 `assumptions` 所产生的 `generator-assumption` 条目。其他 heal 结果禁止出现 `warnings`。假设不会让第 3 阶段失败。

| repairOutcome | 允许的 application | 允许的 stopReason |
| --- | --- | --- |
| `healed` | `applied`, `preview-only`, `declined`, `not-applied-interrupted`, `apply-failed`, `partially-applied` | `settled`, `attempt-limit`, `deadline` |
| `partially-healed` | `applied`, `preview-only`, `declined`, `not-applied-interrupted`, `apply-failed`, `partially-applied` | `settled`, `attempt-limit`, `deadline` |
| `unresolved` | `no-artifact-change`, `not-eligible` | `settled`, `attempt-limit`, `deadline` |
| `no-changes-needed` | `no-artifact-change` | `settled` |
| `listed` | 仅标识：`id`、`file`、`status` | 禁止：`application`, `stopReason`, `planFile`, `durationMs`, `steps`, `explanation` |
| `skipped` | 仅标识：`id`、`file`、`status` | 禁止：`application`, `stopReason`, `planFile`, `durationMs`, `steps`, `explanation` |

第 3 阶段因逻辑机密名称集合发生变化而拒绝整份执行计划候选时，已完成的结果带有 `stage3Rejection: { reason: "secret-set-changed", added: SecretName[], removed: SecretName[] }`。这是硬性拒绝。不会提交任何产物，你必须经同意重新生成，而不是悄悄重新归属候选。

每个已完成的分支还可以带有 `repairTrace`，它是按顺序排列的诊断数组，记录该用例第 1、2、3 阶段的尝试。每个条目都是严格的，不允许出现其他阶段或其他结果的字段。

| 阶段 | 结果 | 其他字段 |
| --- | --- | --- |
| `stage1` | `accepted`, `no-advance` | `stepId` |
| `stage1` | `not-eligible` | `stepId`, `reason`，取值为 `frontier-out-of-range`, `mode-none`, `trace-current`, `no-confirming-step`, `no-confirms` 之一 |
| `stage2` | `accepted` | `stepId` |
| `stage2` | `rejected` | `stepId`, `reason`，取值为 `provider-error`, `response-shape`, `id-mismatch`, `secret-name-invalid`, `coverage-invalid`, `obligation-mismatch`, `literal-secret`, `no-advance`, `intent-invalid` 之一 |
| `stage3` | `accepted` | — |
| `stage3` | `not-passing` | `firstFailureIndex` |
| `stage3` | `failed` | 可选的 `code` |
| `stage3` | `secret-set-rejected` | — |

被准入拒绝的阶段不会添加 `repairTrace` 条目，只会通过该用例的 `stopReason: "attempt-limit"` 或 `"deadline"` 体现。被中断的工作不会产生已完成的结果，而是报告为 `skipped`，因此既没有 `repairTrace` 条目，也没有 `stopReason`。

## 结果状态 {#result-statuses}

步骤结果和评审结果共用下面这些分支。

| 分支 | 必需字段 | 可选字段 |
| --- | --- | --- |
| `step` | `id`, `type: action/assert/capture/ai`, `target`, `status: passed/failed/error/skipped` | `variable`（仅 capture）、`kind: assertion/environment`、`expected`、`actual`、`screenshot`、`screenshotOmitted: secret-detected`、`observed`、`binding` |
| `observed` | `note`：固定的 `OBSERVED_NOTE`，以及 `accessibilitySnapshot` | — |
| `review sufficient / insufficient` | `id`, `file`, `planFile`, `concerns[]` | — |
| `review skipped` | `id`, `file`, `status: skipped` | — |

经过本地验证后，操作步骤或捕获步骤可以带有 `binding: { provenance: "grounding" | "quoted-match" | "ai-proposed", confirmed: boolean, quoteWaitMs?: non-negative integer, aiProposalMs?: non-negative integer }`。对于 `grounding`，`confirmed` 始终为 `true`，因为这个绑定来自早先某次运行中已确认的条目，并不表示该条目是在本次运行中写入的。对于 `quoted-match` 和 `ai-proposed`，它是用例结束时的值。只有对应的阶段运行过，才会出现耗时字段。更早发生的绑定失败会改为报告用例错误。

用例的所有步骤都通过后，剩余操作和捕获步骤的绑定也会将 `confirmed` 设为 `true`。即使回写未获允许或写入失败，该值仍为 `true`，因此它不保证定位缓存文件已更新。

每个已执行的 run 结果和每个已完成的 heal 结果，都为执行计划中的每个目标提供一个 `sessions` 条目。每个值为 `{ surface: "web", executor: { kind: "playwright", browser: "chromium" }, state }`，其中 `state` 为 `not-opened`、`closed` 或 `close-failed`。`not-opened` 表示该目标的启动没有返回会话，包括执行在其第一个步骤之前就停止的情况。关闭失败不会改变用例状态。

## 评审关注点 {#review-concerns}

评审把发现的问题作为针对执行计划的关注点报告出来。

| 字段 | 类型 |
| --- | --- |
| `stepId` | string |
| `concern` | string |
| `suggestion` | string |

## 错误 {#errors}

报告错误是一个严格对象，作用域为整个运行或单个用例。每个条目都有 `scope`、`kind`、`code` 和 `message`。`hint` 对所有代码都是可选的，用例作用域的条目还有一个非空白的 `caseId`。`details` 是可选的，只存在于下面的十五个代码上。

出现 `attempts` 时，其类型为 `Array<{ attempt: integer 1–5, code: ReportErrorCode }>`。`SecretRef` 的语法为 `{{secrets.<identifier>(.<identifier>)*}}`。

| 错误代码 | 可选的 `details` 形状 |
| --- | --- |
| `AGENTIC_STEP_FAILED` | `{ stepId: non-whitespace string, actions: non-negative integer, assertions: non-negative integer, passedAssertions: non-negative integer, failedAssertions: non-negative integer, targetRejections: non-negative integer, lastFailedAssertion?: { check: "text-visible" \| "element-visible" \| "text-equals" \| "url-matches" \| "element-count", expected: string } }` 仅用例作用域。计数描述已完成的工具调用。 |
| `CASE_ABORTED` | `{ reason: "run-reference-invalid" \| "run-value-missing" \| "secret-fill-incomplete" \| "agentic-no-terminal-evidence" \| "agentic-coverage-inexact" \| "agentic-proof-invalid" \| "grounding-secret-contaminated" \| "grounding-snapshot-invalid", stepId: string }` 仅用例作用域。`reason` 有八个已定义的取值。 |
| `AI_RESPONSE_INVALID` | `{ issues: Array<{ code: instruction-coverage, element-intent, or confirms issue code \| "text-equals-self-quote" \| "invalid-json" \| "schema-mismatch" \| "secret-allowed-name-not-projected" \| "secret-conflicting-target-names", path: Array<string or non-negative integer>, stepId?: StepId }>, attempts?: ... }` `confirms` 类问题代码为 `confirms-unknown-step`、`confirms-not-earlier`、`confirms-not-action` 和 `confirms-duplicate`。最后两个非 `confirms` 问题代码始终带有 `stepId`。 |
| `SECRET_LITERAL_REJECTED` | `{ detector: credential-prefix-sk \| credential-prefix-ghp \| credential-prefix-aws-access-key \| high-entropy-token \| embedded-secret-reference, path: non-whitespace string, attempts?: ... }` |
| `SECRET_ENV_VAR_COLLISION` | `{ envVar: non-whitespace string, refs: SecretRef[] }` `refs` 至少有两个条目。 |
| `SECRET_CONSENT_REQUIRED` | `{ reason: "consent-required" \| "declined" \| "not-interactive", secrets: Array<{ name: SecretName, stepId: StepId, envVar: non-whitespace string, reason: string }> }` 内层的 `reason` 可以是任意字符串。 |
| `SECRET_SYNTAX_REJECTED` | `{ occurrences: Array<{ line: positive integer, column: positive integer, kind: "grant-line" \| "reference" }> }` |
| `BROWSER_LAUNCH_FAILED` | `{ reason: "executable-missing" \| "launch-failed", engine: non-whitespace string }` |
| `EXECUTOR_UNSUPPORTED` | `{ target: non-whitespace string, executor: non-whitespace string, reason: "surface-mismatch" \| "capability-missing", missing: UiCapability[], surface?: { target: "web", executor: non-whitespace string } }` |
| `PROMPT_AMBIGUOUS` | `{ ambiguities: integer at least 1 }` 仅用例作用域。 |
| `AI_EXECUTOR_UNAVAILABLE` | `{ attempts?: ... }` |
| `UNEXPECTED_CRASH` | `{ cause: { name: "Error" \| "TypeError" \| "RangeError" \| "SyntaxError" \| "ReferenceError" \| "AbortError" \| "TimeoutError" } }` |
| `FS_IO_ERROR` | `{ partiallyWritten: Array<"plan" \| "grounding"> }` 仅用例作用域。 |
| `PROMPT_PATH_INVALID` | `{ path: non-whitespace string, reason: "outside-test-dir" \| "not-test-md" \| "no-name" }` |
| `GROUNDING_UNRESOLVED` | `{ stepId: string, reason: "missing" \| "recoverable-miss" \| "no-candidate" \| "ambiguous" \| "proposal-rejected" \| "candidate-changed" }` 对于元素步骤，`missing` 表示不存在定位条目，`recoverable-miss` 表示已有条目与当前页面不匹配。 |

`AI_RESPONSE_INVALID` 的问题 `code` 可以是下列任一值：

| code | 类别 |
| --- | --- |
| `citation-whitespace-only` | 指令覆盖 |
| `anchor-invalid` | 指令覆盖 |
| `citation-checksum-mismatch` | 指令覆盖 |
| `criterion-id-duplicate` | 指令覆盖 |
| `criterion-range-duplicate` | 指令覆盖 |
| `criterion-order-invalid` | 指令覆盖 |
| `source-span-invalid` | 指令覆盖 |
| `source-span-whitespace-only` | 指令覆盖 |
| `success-criterion-missing` | 指令覆盖 |
| `intent-id-duplicate` | 指令覆盖 |
| `intent-id-missing` | 指令覆盖 |
| `intent-id-unknown` | 指令覆盖 |
| `intent-id-action` | 指令覆盖 |
| `intent-assertion-unsupported` | 指令覆盖 |
| `terminal-url-matches-forbidden` | 指令覆盖 |
| `verification-coverage-id-missing` | 指令覆盖 |
| `verification-coverage-id-unknown` | 指令覆盖 |
| `verification-coverage-id-action` | 指令覆盖 |
| `verification-coverage-index-duplicate` | 指令覆盖 |
| `verification-coverage-index-invalid` | 指令覆盖 |
| `verification-assertion-repeated` | 指令覆盖 |
| `intent-span-invalid` | 元素意图 |
| `intent-span-whitespace-only` | 元素意图 |
| `intent-citation-mismatch` | 元素意图 |
| `quote-span-invalid` | 元素意图 |
| `quote-text-mismatch` | 元素意图 |
| `quote-unpaired` | 元素意图 |
| `quote-outside-intent` | 元素意图 |
| `quote-whitespace-only` | 元素意图 |
| `confirms-unknown-step` | confirms |
| `confirms-not-earlier` | confirms |
| `confirms-not-action` | confirms |
| `confirms-duplicate` | confirms |
| `invalid-json` | 其他 |
| `schema-mismatch` | 其他 |
| `secret-allowed-name-not-projected` | 其他 |
| `secret-conflicting-target-names` | 其他 |
| `text-equals-self-quote` | 其他 |

在 `generated` 和 `would-generate` 的结果中，`secrets` 列出 ambercast 已解析的候选机密用途，dry-run 的 `skipped-fresh` 结果也包含它。可选的 `warnings` 记录五种非致命的策略警告：`secret-name-reused-across-targets`、`secret-target-changed`、`allowed-names-truncated`、`action-unconfirmed` 和 `generator-assumption`。其中 `action-unconfirmed` 带有 `stepId`。这些字段让与同意相关的输出可以被观察，同时不暴露机密值。高风险的 `"*"` 设置见[机密同意](/ambercast/zh-cn/reference/configuration/#secret-consent)。

## 报告持久化 {#persistence}

只有 `run` 会持久化报告。它用 `JSON.stringify` 序列化最终确定的信封，写入 `runsDir/runId/report.json`。

`reportPersistence` 属性记录写入的结果：

- `persisted`：写入成功，且磁盘上的 JSON 与返回的信封一致。
- `failed`：写入失败，且看不到部分内容。
- `not-attempted`：没有尝试写入，包括命令在得出结果之前就失败的情况。

只有写入方固定在当前的 schema 版本，查看器会宽松地读取任何 3.x 报告。下面的示例各展示一个命令的信封。

```json
{"schemaVersion":"3.12","command":"generate","startedAt":"2026-09-06T00:00:00Z","durationMs":120,"summary":{"total":1,"passed":1,"failed":0,"errored":0,"skipped":0},"results":[{"id":"checkout.test.md","file":"checkout.test.md","planFile":"checkout.ambercast.plan.json","status":"generated","dryRun":false,"ambiguities":[],"secrets":[{"name":"LOGIN_PASSWORD","stepId":"fill-password","envVar":"AMBERCAST_SECRET_LOGIN_PASSWORD","allowed":true,"selectionSource":"target-slug"}],"durationMs":120,"aiCalls":1}],"errors":[]}
```
```json
{"schemaVersion":"3.12","command":"run","startedAt":"2026-09-06T00:00:00Z","durationMs":0,"summary":{"total":0,"passed":0,"failed":0,"errored":0,"skipped":0},"results":[],"errors":[],"reportPersistence":"not-attempted"}
```
```json
{"schemaVersion":"3.12","command":"check","startedAt":"2026-09-06T00:00:00Z","durationMs":0,"summary":{"total":0,"passed":0,"failed":0,"errored":0,"skipped":0},"results":[],"errors":[]}
```
```json
{"schemaVersion":"3.12","command":"heal","startedAt":"2026-09-06T00:00:00Z","durationMs":0,"summary":{"total":0,"passed":0,"failed":0,"errored":0,"skipped":0},"results":[],"errors":[]}
```

## 持久化兼容锚点 {#report-persistence}

本节用于保留旧锚点。内容见[报告持久化](/ambercast/zh-cn/reference/reports/#persistence)。

## 另请参阅 {#see-also}

- [错误代码](/ambercast/zh-cn/reference/error-codes/#code-vocabulary)
- [退出码](/ambercast/zh-cn/reference/exit-codes/#exit-code-table)
- [文件布局](/ambercast/zh-cn/reference/file-layout/#run-artifacts)
- [ambercast run](/ambercast/zh-cn/reference/cli/run/#report-and-exits)
