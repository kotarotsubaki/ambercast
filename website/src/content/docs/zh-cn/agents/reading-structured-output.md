---
title: 读取结构化输出
description: 指导 Agent 根据报告信封进行逻辑分支，按固定安全顺序处理命令、结果状态、错误代码与报告持久化。
---

本页指导 Agent 如何根据报告信封进行逻辑分支，而不是重现完整的数据模式。报告信封通过 `command` 区分不同的命令分支，并且只有 `run` 分支包含 `reportPersistence`。在处理输出时，您需要按照固定的安全顺序依次处理 `command`、`errors[].code`、`results[].status` 以及 `reportPersistence`。

## 信封决策树 {#decision-tree}

处理报告信封时，请遵循以下规则：

- 报告信封通过 `command` 区分出 `generate`、`run`、`check`、`heal` 和 `review` 分支。
- 只有 `run` 分支包含 `reportPersistence`，其取值为 `persisted`、`failed` 以及 `not-attempted`。
- 报告模式提供了一套公开且稳定的 `errors[].code` 词汇表。

~~~
Read command.
├─ run: read reportPersistence first.
│  ├─ failed → retain stdout envelope; treat persistence as an environment problem.
│  └─ persisted/not-attempted → continue to results.
├─ generate/check/heal/review → continue to results.
Read every errors[].code.
├─ any code → use operating-contract's error-code table before changing files.
└─ none → classify every results[].status for this command.
   ├─ failed/error/stale/missing/orphaned → stop at the corresponding contract.
   ├─ skipped/listed → treat as incomplete or discovery-only, not success.
   └─ healthy status → continue only within approved scope.
~~~

相关链接：[报告](/ambercast/zh-cn/reference/reports/)、[操作契约](/ambercast/zh-cn/agents/operating-contract/#next-action-by-report-error)

## 状态代表特定命令的凭据 {#status-by-command}

各命令对应的 `results[].status` 代表各自特定的执行凭据，不能混淆解读：

- `run` 执行结果使用 `passed`、`failed` 或 `error`；`listed` 仅用于发现，而 `skipped` 不携带任何执行凭据。
- `generate` 区分 `generated`、`would-generate`、`skipped-fresh`、`listed`、`failed` 和 `skipped`。
- `check` 包括 `fresh`/`stale`（已过期）、`plan-missing`/`grounding-missing` 或 `orphaned` 结果，以及 `fresh-without-grounding`、`listed` 和 `skipped`。

相关链接：[报告](/ambercast/zh-cn/reference/reports/#result-statuses)、[计划生命周期与新鲜度](/ambercast/zh-cn/explanation/plan-lifecycle/#grounding-binding)

## 进程状态是批处理级别的信号 {#exit-code-signal}

报告错误在其 `code` 之外，同时记录了其 `scope` 与 `kind`。

相关链接：[退出码](/ambercast/zh-cn/reference/exit-codes/#priority)、[操作契约](/ambercast/zh-cn/agents/operating-contract/#next-action-by-exit-code)
