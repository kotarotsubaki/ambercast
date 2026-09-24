---
title: MCP 服务器
description: 使用 ambercast MCP 服务器的 Agent 连接边界。
---

`ambercast mcp` 子命令通过无端口的 `stdio` 连接供 Agent 执行及修复按键级 E2E 测试。一个服务器进程服务于一个 session root，由 `--dir` 指定；省略时使用进程当前工作目录。工具中的文件路径以该 root 为基准解析。`--sync-wait-ms` 设置同步响应等待界限，默认值为 45000 ms。

## 连接边界 {#connection-boundary}

连接提供 `ambercast_generate`、`ambercast_run`、`ambercast_check`、`ambercast_heal`、`ambercast_job_status` 和 `ambercast_job_cancel`。前四项是工作流，后两项观察及取消服务器本地作业。输入、注解、Job record、`isError` 及 MCP 错误界面详见 [MCP 工具](/ambercast/zh-cn/reference/mcp-tools/#tool-table)。客户端进程注册示例见 [ambercast mcp](/ambercast/zh-cn/reference/cli/mcp/#client-registration)。

## 与原计划设计的变化 {#changes-from-the-planned-design}

| 原 planned 页面 | 已实现连接 |
| --- | --- |
| 原计划五个工具 | 六个工具，包含作业状态与取消 |
| 发布报告 `outputSchema` | 省略 `outputSchema` |
| heal 只有预览 | 通过 `applyToken` 两阶段应用 |
| 只有同步工作流 | 较长调用变成作业，无 ID 的状态请求返回列表 |
| 未规定服务器标志 | `ambercast mcp` 支持 `--dir` 和 `--sync-wait-ms` |
| 未规定 MCP 错误 | `HEAL_APPLY_TOKEN_INVALID`、`HEAL_APPLY_FAILED`、`JOB_NOT_FOUND`、`JOB_FAILED` 使用独立错误界面 |
| 未规定 CLI 输入 | 输入排除 `headed`、`list`、`stale`、`json`、`yes`、`configPath` |
| 从报告推断退出码 | `_meta.exitCode` 明确携带退出码 |

相关链接：[MCP 工具](/ambercast/zh-cn/reference/mcp-tools/#tool-table)、[ambercast mcp](/ambercast/zh-cn/reference/cli/mcp/#usage)、[读取结构化输出](/ambercast/zh-cn/agents/reading-structured-output/)。
