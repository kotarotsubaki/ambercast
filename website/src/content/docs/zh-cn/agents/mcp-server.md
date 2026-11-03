---
title: MCP 服务器
description: "`ambercast mcp` 通过 stdio 向 MCP 客户端提供一个会话根目录，本页说明 Agent 可以调用什么，以及每个调用的细节在哪里查。"
---

本页帮助 Agent 判断能从 MCP 客户端调用什么，以及去哪里查每个调用的细节。服务器运行的是 ambercast 的浏览器 E2E 工作流：generate、run、check 和 heal。

## 连接边界 {#connection-boundary}

`ambercast mcp` 提供不占用端口的 stdio 连接。一个服务器进程只服务一个会话根目录。用 `--dir` 指定，省略时使用进程的当前工作目录。

传给工具的文件相对于这个根目录解析。`--sync-wait-ms` 限定同步等待的上限，默认值为 45000 ms。

服务器公开六个工具：`ambercast_generate`、`ambercast_run`、`ambercast_check`、`ambercast_heal`、`ambercast_job_status` 和 `ambercast_job_cancel`。前四个是工作流，后两个用于查看和取消服务器内的作业。

如 [MCP 工具](/ambercast/zh-cn/reference/mcp-tools/#tool-table)所述，只有 `ambercast_generate` 接受 `target`。其他工作流工具从执行计划中选择目标。

输入、注解、作业记录、`isError` 和 MCP 错误面也在同一页。客户端的注册方式见 [ambercast mcp](/ambercast/zh-cn/reference/cli/mcp/#client-registration)。

## 与原计划设计的变化 {#changes-from-the-planned-design}

| 此前的计划页面 | 已实现的连接 |
| --- | --- |
| 包含 `review` 的五个计划中的工具 | 六个工具，包括作业状态与取消；不公开 `review` |
| 发布报告的 `outputSchema` | 省略 `outputSchema` |
| 只有 heal 预览 | 使用 `applyToken` 的两阶段 heal |
| 只有同步工作流 | 较长的 `generate`、`run` 和 heal 预览调用会返回作业；不带 ID 查询状态会列出作业 |
| 服务器参数未定 | `ambercast mcp` 支持 `--dir` 和 `--sync-wait-ms` |
| MCP 错误未定 | `HEAL_APPLY_TOKEN_INVALID`、`HEAL_APPLY_FAILED`、`JOB_NOT_FOUND` 和 `JOB_FAILED` 使用独立的错误面 |
| CLI 输入未定 | 输入不含 `headed`、`list`、`stale`、`json`、`yes` 和 `configPath` |
| 退出码由报告推断 | `_meta.exitCode` 明确给出 |

相关链接：[MCP 工具](/ambercast/zh-cn/reference/mcp-tools/#tool-table)、[ambercast mcp](/ambercast/zh-cn/reference/cli/mcp/#usage)、[读取结构化输出](/ambercast/zh-cn/agents/reading-structured-output/)
