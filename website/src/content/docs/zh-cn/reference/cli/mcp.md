---
title: ambercast mcp
description: MCP 服务器的启动、传输、关闭和客户端注册参考。
---

`ambercast mcp` 通过 `stdio` 启动不占用端口的 MCP 服务器。每个进程只服务一个会话根目录。

## 用法 {#usage}

```text
ambercast mcp [--dir <path>] [--sync-wait-ms <n>] [--help]
```

## 标志 {#flags}

| 标志 | 取值 | 作用 | 默认值 |
| --- | --- | --- | --- |
| --dir | path | 要服务的会话根目录 | cwd |
| --sync-wait-ms | n | 同步响应的等待上限，单位毫秒 | 45000 |

`--dir` 选择会话根目录。省略时使用进程的当前工作目录，相对路径以该目录为基准解析。`--sync-wait-ms` 是正整数，限定长工作流返回任务句柄之前的同步等待时间。`--help` 优先于其他参数，把用法打印到 stdout，退出码为 0。

如果解析出的目录不存在或不是目录，stderr 会输出 `ambercast mcp: --dir <path> is not a directory.`，进程不启动，退出码为 2。启动失败时输出 `ambercast mcp: failed to start (<error name>)`，退出码为 3。选项无效、出现位置参数或等待上限无效时，stderr 输出 CLI 用法错误，退出码为 2。

## 传输与关闭 {#transport-and-shutdown}

stdout 只输出 JSON-RPC 行。stderr 输出进度信息和一行启动提示 `ambercast mcp: serving <session root>`。

stdin 结束、收到 SIGTERM 或 SIGINT 时，服务器开始排空。它中止进行中的调用，最多等待 10000 ms，然后关闭服务器；全部结算后以退出码 0 结束。到期限时若仍有调用未结算，则以退出码 3 结束。排空期间，新的工具调用会被拒绝。

## 客户端注册 {#client-registration}

在已安装 ambercast 的项目中运行 `npx --no-install ambercast mcp`。Claude Code 读取项目中的 `.mcp.json`：

```json
{"mcpServers":{"ambercast":{"command":"npx","args":["--no-install","ambercast","mcp"]}}}
```

Codex CLI 读取 `config.toml`：

```toml
[mcp_servers.ambercast]
command = "npx"
args = ["--no-install", "ambercast", "mcp"]
```

Claude Desktop 在其配置中接受同样的服务器条目：

```json
{"mcpServers":{"ambercast":{"command":"npx","args":["--no-install","ambercast","mcp"]}}}
```

请从已安装 ambercast 的项目中启动客户端，这样 `npx --no-install` 才能解析到该包。`--dir <path>` 只在服务器启动之后选择另一个会话根目录，不影响包的解析。服务器提供 `ambercast_generate`、`ambercast_run`、`ambercast_check`、`ambercast_heal`、`ambercast_job_status` 和 `ambercast_job_cancel` 六个工具。

## 相对规划设计的变化 {#changes-from-the-planned-design}

| 此前规划的页面 | 已实现的约定 |
| --- | --- |
| 服务器标志未规定 | `ambercast mcp` 支持 `--dir` 和 `--sync-wait-ms` |
| 规划了五个工具 | 六个工具，包括任务状态查询和取消 |
| 发布报告的 `outputSchema` | 省略 `outputSchema` |
| heal 只有预览 | 两阶段 heal 使用 `applyToken` |
| 只有同步调用 | 长调用返回任务；不带 ID 的状态查询列出任务 |
| MCP 错误未规定 | `HEAL_APPLY_TOKEN_INVALID`、`HEAL_APPLY_FAILED`、`JOB_NOT_FOUND` 和 `JOB_FAILED` 有单独的错误响应 |
| CLI 输入标志未规定 | 工具输入不含 `headed`、`list`、`stale`、`json`、`yes` 和 `configPath` |
| 退出码从报告推断 | `_meta.exitCode` 明确携带退出码 |

相关页面：[MCP 工具](/ambercast/zh-cn/reference/mcp-tools/#tool-table)、[MCP 服务器](/ambercast/zh-cn/agents/mcp-server/#connection-boundary)、[CLI 概览](/ambercast/zh-cn/reference/cli/overview/#command-surface)
