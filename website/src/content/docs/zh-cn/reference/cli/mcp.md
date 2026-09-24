---
title: ambercast mcp
description: MCP 服务器的启动、传输、关闭和客户端注册参考。
---

`ambercast mcp` 通过 `stdio` 启动无端口的 MCP 服务器。每个进程服务于一个 session root。

## 用法 {#usage}

```sh
ambercast mcp [--dir <path>] [--sync-wait-ms <n>] [--help]
```

## 标志 {#flags}

| 标志 | 取值 | 效果 | 默认值 |
| --- | --- | --- | --- |
| `--dir` | path | 服务的 session root | cwd |
| `--sync-wait-ms` | n | 同步响应等待界限（毫秒） | 45000 |

`--dir` 选择 session root；省略时使用进程当前工作目录。相对路径也以该目录为基准解析。`--sync-wait-ms` 是正整数，默认值 45000，限定较长工作流返回作业句柄之前的同步等待时间。`--help` 优先于其他参数，向 stdout 输出用法并以退出码 0 结束。

如果解析后的路径不存在或不是目录，stderr 输出 `ambercast mcp: --dir <path> is not a directory.`，服务器不会启动，退出码为 2。启动失败输出 `ambercast mcp: failed to start (<error name>)`，退出码为 3。非法选项、位置参数和等待界限通过 stderr 输出 CLI 用法错误，退出码为 2。

## 传输与关闭 {#transport-and-shutdown}

stdout 仅包含 JSON-RPC 行。stderr 接收进度与一行启动日志 `ambercast mcp: serving <session root>`。stdin 结束、SIGTERM 或 SIGINT 均会启动 draining。服务器中止运行中的调用，最多等待 10000 ms；全部结算后关闭服务器并以退出码 0 结束，超时未结算则以退出码 3 结束。draining 期间拒绝新工具调用。

## 客户端注册 {#client-registration}

在已安装 ambercast 的项目中使用 `npx --no-install ambercast mcp`。Claude Code 读取项目的 `.mcp.json`：

```json
{"mcpServers":{"ambercast":{"command":"npx","args":["--no-install","ambercast","mcp"]}}}
```

Codex CLI 读取 `config.toml`：

```toml
[mcp_servers.ambercast]
command = "npx"
args = ["--no-install", "ambercast", "mcp"]
```

Claude Desktop 配置中可使用相同的服务器条目：

```json
{"mcpServers":{"ambercast":{"command":"npx","args":["--no-install","ambercast","mcp"]}}}
```

将客户端工作目录设为所需 session root，或追加 `--dir` 参数。服务器提供 `ambercast_generate`、`ambercast_run`、`ambercast_check`、`ambercast_heal`、`ambercast_job_status` 和 `ambercast_job_cancel`。

## 与原计划设计的变化 {#changes-from-the-planned-design}

| 原 planned 页面 | 已实现契约 |
| --- | --- |
| 未规定服务器标志 | `ambercast mcp` 支持 `--dir` 和 `--sync-wait-ms` |
| 原计划五个工具 | 六个工具，包含作业状态与取消 |
| 发布报告 `outputSchema` | 省略 `outputSchema` |
| heal 只有预览 | 通过 `applyToken` 两阶段应用 |
| 只有同步调用 | 较长调用返回作业，无 ID 的状态请求返回列表 |
| 未规定 MCP 错误 | `HEAL_APPLY_TOKEN_INVALID`、`HEAL_APPLY_FAILED`、`JOB_NOT_FOUND`、`JOB_FAILED` 使用独立错误响应 |
| 未规定 CLI 输入标志 | 工具输入排除 `headed`、`list`、`stale`、`json`、`yes`、`configPath` |
| 从报告推断退出码 | `_meta.exitCode` 明确携带退出码 |

相关链接：[MCP 工具](/ambercast/zh-cn/reference/mcp-tools/#tool-table)、[MCP 服务器](/ambercast/zh-cn/agents/mcp-server/#connection-boundary)、[CLI 概览](/ambercast/zh-cn/reference/cli/overview/#command-surface)。
