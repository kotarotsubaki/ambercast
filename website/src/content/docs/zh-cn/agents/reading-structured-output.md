---
title: 读取结构化输出
description: 按固定顺序读取 JSON 报告：先看 `command`，再看 `run` 的 `reportPersistence`，然后是 `errors[].code`，最后是每个 `results[].status`，遇到第一个需要处理的项就行动。
---

本页帮助 Agent 决定从报告的哪里开始读、在哪里停下、什么结果可以继续。报告由 `command` 决定属于 `generate`、`run`、`check`、`heal` 或 `review` 分支。

## 决策树 {#decision-tree}

按 `command`、`reportPersistence`、`errors[].code`、`results[].status` 的顺序读取。只有 `run` 有 `reportPersistence`，取值为 `persisted`、`failed` 或 `not-attempted`。schema 定义了 `review` 分支，但 CLI 没有 `review` 命令。

只要 `errors[].code` 里有错误码，就先按操作契约的报告错误表处理，再改动文件。没有错误码时，按该命令的规则逐行归类 `results[].status`。

~~~
Read command.
├─ run: read reportPersistence first.
│  ├─ failed → keep the stdout report; treat persistence as an environment problem.
│  └─ persisted/not-attempted → continue to errors.
├─ generate/check/heal/review → continue to errors.
Read every errors[].code.
├─ any code → use the operating contract's report-error table before changing files.
└─ none → classify every results[].status for this command.
   ├─ listed/skipped → discovery-only or incomplete, not success.
   ├─ generate failed, run failed/error → read the evidence; do not heal or regenerate automatically.
   ├─ check other than fresh/fresh-without-grounding → artifacts are untrustworthy; use stale-artifact recovery.
   ├─ heal unresolved/partially-healed → report it; do not retry automatically.
   └─ any other status → continue only within approved scope.
~~~

相关链接：[报告](/ambercast/zh-cn/reference/reports/)、[操作契约](/ambercast/zh-cn/agents/operating-contract/#next-action-by-report-error)

## 状态代表各命令自己的证据 {#status-by-command}

每个命令的 `results[].status` 词汇各不相同。`listed` 只表示发现了测试，`skipped` 不带任何执行证据，两者都不是成功。

- `generate` 使用 `generated`、`would-generate`、`skipped-fresh`、`listed`、`failed` 和 `skipped`。
- `run` 使用 `passed`、`failed`、`error`、`listed` 和 `skipped`。
- `check` 使用 `fresh`、`stale`、`missing-plan`、`missing-grounding`、`stale-grounding`、`invalid-grounding`、`fresh-without-grounding`、`orphaned-plan`、`orphaned-grounding`、`invalid-artifact-name`、`listed` 和 `skipped`。
- 已完成的 `heal` 行带有 `status: completed`，`repairOutcome` 为 `healed`、`partially-healed`、`unresolved` 或 `no-changes-needed`。`listed` 和 `skipped` 行只带标识信息。

相关链接：[generate 结果](/ambercast/zh-cn/reference/reports/#generate-results)、[run 结果](/ambercast/zh-cn/reference/reports/#run-results)、[check 结果](/ambercast/zh-cn/reference/reports/#check-results)、[heal 结果](/ambercast/zh-cn/reference/reports/#heal-results)、[执行计划的生命周期与新鲜度](/ambercast/zh-cn/explanation/plan-lifecycle/#grounding-binding)

## 退出码是整批的信号 {#exit-code-signal}

先读各行和错误，再把退出码当作整批的信号。每个报告错误还会在 `errors[]` 中记录它的范围和类别。

相关链接：[退出码](/ambercast/zh-cn/reference/exit-codes/#aggregation-priority)、[操作契约](/ambercast/zh-cn/agents/operating-contract/#next-action-by-exit-code)
