---
title: 错误代码
description: ambercast 稳定错误代码词汇表、作用域、退出码及触发条件的完整参考。
---

ambercast 拥有统一且稳定的错误代码体系。本文档定义了完整的错误代码参考规范，明确列出各错误代码对应的类别、作用域、进程退出码以及具体的触发条件，供您在排查测试运行与分析报告时查阅。

## 错误代码词汇表 {#code-vocabulary}

| 错误代码 | 类别 | 作用域 | 退出码 | 触发条件 |
| --- | --- | --- | --- | --- |
| CONFIG_INVALID | usage | run/case | 2 | 配置无效 |
| PROMPT_PATH_INVALID | usage | run only | 2 | 所选 prompt 路径不符合资格 |
| SECRET_UNRESOLVED | usage | run/case | 2 | 未解析的 secret |
| TARGET_UNRESOLVED | usage | run/case | 2 | 目标无法解析 |
| MISSING_PLAN | usage | run/case | 4 | 缺失 plan |
| STALE_PLAN | usage | run/case | 4 | plan 已过期（`stale`） |
| INTEGRITY_VIOLATION | usage | run/case | 4 | 制品完整性校验失败 |
| GROUNDING_UNRESOLVED | usage | case | 4 | 未传入 `--resolve` 的 grounding 未命中 |
| SECRET_LITERAL_REJECTED | usage | run/case | 2 | 字面量 secret 被拒绝 |
| SECRET_GRANT_UNATTRIBUTABLE | legacy | 不会生成 | — | 为与早期工具版本生成的报告保持向后兼容而保留在报告 schema 中；当前的 `generate`、`run`、`heal` 或 `check` 不会生成该代码 |
| SECRET_ENV_VAR_COLLISION | usage | case | 2 | 两个 secret 投影到同一个环境变量名 |
| SECRET_CONSENT_REQUIRED | usage | case | 2 | secret 名称不在允许列表中 |
| SECRET_SYNTAX_REJECTED | usage | case | 2 | 发现旧版 grant 行或 `{{secrets.*}}` 引用 |
| BROWSER_LAUNCH_FAILED | environment | run/case | 3 | 浏览器启动失败 |
| AI_EXECUTOR_UNAVAILABLE | environment | run/case | 3 | 提供商不可用 |
| AI_RESPONSE_INVALID | environment | run/case | 3 | 提供商响应无效 |
| FS_IO_ERROR | environment | run/case | 3 | 文件系统操作失败 |
| UNEXPECTED_CRASH | environment | run/case | 3 | 未分类的崩溃 |
| INTERRUPTED | environment | 仅限 run | 3 | 批处理取消 |

使用错误（usage）与环境错误（environment）拥有相互独立的报告词汇表。`SECRET_GRANT_UNATTRIBUTABLE` 是一个旧版例外：它仅为与早期工具版本生成的报告保持向后兼容而保留在报告代码 schema 中，但没有当前的 `ErrorKind` 或报告错误分支。

在 case 作用域下，`FS_IO_ERROR` 可包含 `details.partiallyWritten`，用于记录 `plan` 和/或 `grounding`。存在时，`AI_RESPONSE_INVALID` 的 details 包含规范化 issue 及可选重试记录；`SECRET_LITERAL_REJECTED` 的 details 包含检测器、路径及可选尝试记录；`SECRET_ENV_VAR_COLLISION` 的 details 包含发生冲突的 `envVar` 以及冲突的 secret 引用列表；`SECRET_CONSENT_REQUIRED` 的 details 包含原因（`consent-required`、`declined` 或 `not-interactive`）以及每个未解决 secret 的名称、step id、env var 和原因；`SECRET_SYNTAX_REJECTED` 的 details 包含旧版语法出现位置的列表（行号、列号，以及是 grant 行还是引用）；`AI_EXECUTOR_UNAVAILABLE` 的 details 包含可选尝试记录；`BROWSER_LAUNCH_FAILED` 的 details 包含一个封闭的补救原因（`executable-missing`、`engine-unregistered` 或 `launch-failed`）与已解析的引擎名称（固定的补救提示是报告顶层的 `hint` 字段，不包含在 details 中）；`UNEXPECTED_CRASH` 的 details 包含白名单内的 cause 名称。完整的按代码契约请参阅 [报告](/ambercast/zh-cn/reference/reports/#errors)。

## 相关链接

- [报告](/ambercast/zh-cn/reference/reports/#errors)
- [退出码](/ambercast/zh-cn/reference/exit-codes/#exit-code-table)
- [常见故障排查](/ambercast/zh-cn/how-to/troubleshoot/)
