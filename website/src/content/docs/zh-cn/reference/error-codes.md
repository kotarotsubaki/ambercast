---
title: 错误代码
description: 稳定的错误代码及其类别、作用域和退出码，以及每个代码的 details 包含的内容。
---

ambercast 用一组固定的错误代码报告运行级和用例级的失败。在这里可以查到某个代码的含义，以及它对应的退出码。

## 错误代码词汇表 {#code-vocabulary}

使用错误和环境错误各有独立的词汇表。`SECRET_GRANT_UNATTRIBUTABLE` 是旧版的例外。它只为兼容早期版本的报告而留在报告代码 schema 中，当前没有任何错误类别或报告分支会产生它。

| 错误代码 | 类别 | 作用域 | 退出码 | 触发条件 |
| --- | --- | --- | --- | --- |
| CONFIG_INVALID | usage | run/case | 2 | 配置无效 |
| PROMPT_PATH_INVALID | usage | run only | 2 | 所选提示词路径不符合要求 |
| SECRET_UNRESOLVED | usage | run/case | 2 | 机密未解析 |
| TARGET_UNRESOLVED | usage | run/case | 2 | 目标无法解析 |
| EXECUTOR_UNSUPPORTED | usage | case | 2 | 执行器缺少执行计划所需的能力或界面 |
| PROMPT_AMBIGUOUS | usage | case | 2 | 生成的响应仍有未解决的目标歧义 |
| MISSING_PLAN | usage | run/case | 4 | 缺少执行计划 |
| STALE_PLAN | usage | run/case | 4 | 执行计划已过期 |
| INTEGRITY_VIOLATION | usage | run/case | 4 | 产物完整性校验失败 |
| GROUNDING_UNRESOLVED | usage | case | 4 | 未传入 `--resolve` 时，ai 步骤或元素步骤的定位缓存未命中；另有四种原因即使传入 `--resolve` 也会出现 |
| SECRET_LITERAL_REJECTED | usage | run/case | 2 | 字面量机密被拒绝 |
| SECRET_GRANT_UNATTRIBUTABLE | legacy | not producible | — | 为兼容早期工具版本生成的报告而保留在报告 schema 中；当前的 `generate`、`run`、`heal` 和 `check` 不会产生它 |
| SECRET_ENV_VAR_COLLISION | usage | case | 2 | 两个机密对应到同一个环境变量名 |
| SECRET_CONSENT_REQUIRED | usage | case | 2 | 需要对机密给出同意 |
| SECRET_SYNTAX_REJECTED | usage | case | 2 | 旧版机密语法被拒绝 |
| BROWSER_LAUNCH_FAILED | environment | run/case | 3 | 浏览器启动失败 |
| AI_EXECUTOR_UNAVAILABLE | environment | run/case | 3 | AI 提供方不可用 |
| AI_RESPONSE_INVALID | environment | run/case | 3 | AI 提供方的响应无效 |
| AGENTIC_STEP_FAILED | environment | case | 3 | AI 主导的交互宣告失败 |
| CASE_ABORTED | environment | case | 3 | 用例因调用方可纠正或环境方面的原因在步骤中途终止 |
| FS_IO_ERROR | environment | run/case | 3 | 文件系统操作失败 |
| UNEXPECTED_CRASH | environment | run/case | 3 | 未分类的崩溃 |
| INTERRUPTED | environment | run only | 3 | 批量任务被取消 |

### AI 响应问题代码 {#ai-response-issue-codes}

生成的 `confirms` 引用未通过校验时，下列 `AiResponseIssueCode` 值可能出现在 `AI_RESPONSE_INVALID` 的重试和报告问题中。`confirms-unsorted` 仅供内部使用，不会出现在重试反馈中。

| 错误代码 | 条件 |
| --- | --- |
| `confirms-unknown-step` | 引用的步骤 ID 未知 |
| `confirms-not-earlier` | 引用的是当前步骤或之后的步骤 |
| `confirms-not-action` | 引用的步骤不是符合条件的操作或捕获 |
| `confirms-duplicate` | 引用的步骤 ID 重复 |

## 各代码的 details {#details}

只有下列代码带有 `details`。每个代码的完整契约见[报告](/ambercast/zh-cn/reference/reports/#errors)。

| 错误代码 | `details` 内容 |
| --- | --- |
| `FS_IO_ERROR` | 在用例作用域下，可包含 `details.partiallyWritten`，其中有 `plan` 和（或）`grounding`。 |
| `AI_RESPONSE_INVALID` | 规范化后的问题，以及可选的重试记录。 |
| `SECRET_LITERAL_REJECTED` | 检测器、路径，以及可选的尝试记录。 |
| `SECRET_ENV_VAR_COLLISION` | 发生冲突的 `envVar`，以及冲突的机密引用列表。 |
| `SECRET_CONSENT_REQUIRED` | 原因（`consent-required`、`declined` 或 `not-interactive`），以及未解决的机密列表，每项包含名称、步骤 ID、环境变量和原因。 |
| `SECRET_SYNTAX_REJECTED` | 每处被拒绝的旧版语法：行号、列号，以及它是授权行还是引用。 |
| `AI_EXECUTOR_UNAVAILABLE` | 可选的尝试记录。 |
| `BROWSER_LAUNCH_FAILED` | 封闭的补救原因（`executable-missing` 或 `launch-failed`），以及解析出的引擎名称。固定的补救提示在报告顶层的 `hint` 字段中，不属于 `details`。 |
| `AGENTIC_STEP_FAILED` | 步骤 ID、已完成的工具调用计数，以及可选的最后一次失败的断言。 |
| `CASE_ABORTED` | 封闭的终止原因和步骤 ID。 |
| `PROMPT_AMBIGUOUS` | 未解决歧义的数量。 |
| `UNEXPECTED_CRASH` | 白名单内的原因名称。 |
| `EXECUTOR_UNSUPPORTED` | 目标、执行器、原因（`surface-mismatch` 或 `capability-missing`）、缺少的能力，以及可选的界面。 |
| `PROMPT_PATH_INVALID` | 路径和原因（`outside-test-dir`、`not-test-md` 或 `no-name`）。 |
| `GROUNDING_UNRESOLVED` | 步骤 ID 和原因（`missing`、`recoverable-miss`、`no-candidate`、`ambiguous`、`proposal-rejected` 或 `candidate-changed`）。 |

## 另请参阅 {#see-also}

- [报告](/ambercast/zh-cn/reference/reports/#errors)
- [退出码](/ambercast/zh-cn/reference/exit-codes/#exit-code-table)
- [常见故障排查](/ambercast/zh-cn/how-to/troubleshoot/)
