---
title: 错误代码
description: ambercast 稳定错误代码词汇表、作用域、退出码及触发条件的完整参考。
---

ambercast 拥有统一且稳定的错误代码体系。本文档定义了完整的错误代码参考规范，明确列出各错误代码对应的类别、作用域、进程退出码以及具体的触发条件，供您在排查测试运行与分析报告时查阅。

## 错误代码词汇表 {#code-vocabulary}

| 错误代码 | 类别 | 作用域 | 退出码 | 触发条件 |
| --- | --- | --- | --- | --- |
| CONFIG_INVALID | usage | run/case | 2 | 配置无效 |
| SECRET_UNRESOLVED | usage | run/case | 2 | 未解析的 secret |
| TARGET_UNRESOLVED | usage | run/case | 2 | 目标无法解析 |
| MISSING_PLAN | usage | run/case | 4 | 缺失 plan |
| STALE_PLAN | usage | run/case | 4 | plan 已过期（`stale`） |
| INTEGRITY_VIOLATION | usage | run/case | 4 | 制品完整性校验失败 |
| SECRET_LITERAL_REJECTED | usage | run/case | 2 | 字面量 secret 被拒绝 |
| SECRET_GRANT_UNATTRIBUTABLE | usage | run/case | 2 | 授权无法归属 |
| BROWSER_LAUNCH_FAILED | environment | run/case | 3 | 浏览器启动失败 |
| AI_EXECUTOR_UNAVAILABLE | environment | run/case | 3 | 提供商不可用 |
| AI_RESPONSE_INVALID | environment | run/case | 3 | 提供商响应无效 |
| FS_IO_ERROR | environment | run/case | 3 | 文件系统操作失败 |
| UNEXPECTED_CRASH | environment | run/case | 3 | 未分类的崩溃 |
| INTERRUPTED | environment | 仅限 run | 3 | 批处理取消 |

使用错误（usage）与环境错误（environment）拥有相互独立的报告词汇表；每个错误代码到类别的映射关系均集中在 `REPORT_ERROR_DETAILS` 中定义。

在 case 作用域下，`FS_IO_ERROR` 可包含 `details.partiallyWritten`，用于记录 `plan` 和/或 `grounding`。存在时，`AI_RESPONSE_INVALID` 的 details 包含规范化 issue 及可选重试记录；`SECRET_LITERAL_REJECTED` 的 details 包含检测器、路径及可选尝试记录；`SECRET_GRANT_UNATTRIBUTABLE` 的 details 包含原因和安全的授权位置；`AI_EXECUTOR_UNAVAILABLE` 的 details 包含可选尝试记录；`UNEXPECTED_CRASH` 的 details 包含白名单内的 cause 名称。完整的按代码契约请参阅 [报告](/ambercast/zh-cn/reference/reports/#errors)。

## 相关链接

- [报告](/ambercast/zh-cn/reference/reports/#errors)
- [退出码](/ambercast/zh-cn/reference/exit-codes/#exit-code-table)
- [常见故障排查](/ambercast/zh-cn/how-to/troubleshoot/)
