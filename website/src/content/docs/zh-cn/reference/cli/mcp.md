---
title: ambercast mcp
description: 从主包启动基于 stdio 传输协议的 v2 MCP 服务器。
status: planned
sidebar:
  badge:
    text: Planned
    variant: caution
---

:::caution
`ambercast mcp` 是一项计划中的功能，在 0.3.1 版本中尚未实现。本文档描述的是预期设计行为，而非当前版本的实际行为。
:::

`ambercast mcp` 命令用于从主包启动 v2 MCP 服务器，并规范其传输层行为。

## 状态 {#status}

`ambercast mcp` 在 0.3.1 版本中尚未实现；命令行解析器仅接受 `generate`、`run`、`check` 以及 `heal`，并会拒绝任何其他命令。其计划中的 v2 服务器接口由 MCP 设计所定义。

相关链接：[CLI 概览](/ambercast/zh-cn/reference/cli/overview/#command-surface)，[MCP 服务器](/ambercast/zh-cn/agents/mcp-server/)。

## 规划接口 {#planned-interface}

| 方面 | 规划契约 |
| --- | --- |
| 调用 | `ambercast mcp` 从主包启动 v2 MCP 服务器。 |
| 传输方式 | 使用 `stdio`；服务器为无端口（portless）设计。 |
| `stdout` | 仅写入 JSON-RPC；CI 必须验证此不变性约束。 |
| `stderr` | 在此处写入进度与日志，绝不通过 JSON-RPC 流输出。 |
| 工具边界 | 不将 `init` 或 `view` 作为 MCP 工具暴露。 |
| 服务器指令 | 开篇即声明该服务器用于按键级 E2E 执行与修复。 |
| 发现文本预算 | 将重要的描述/指令内容置于最前，因为客户端可能会在 2 KB 处将其截断。 |

该设计未为 `ambercast mcp` 定义任何命令行标志或输入选项模式（input-options schema）。

## 未决事项 {#undecided-items}

| 状态 | 事项 |
| --- | --- |
| 明确未决 | 无；包命令、`stdio` 传输以及无端口交付方式均已记录为确定项。 |
| 未规定 | [UNVERIFIED] 精确的服务器标志、启动错误、生命周期以及客户端配置均未由这些参考来源定义。 |

相关链接：[MCP 工具](/ambercast/zh-cn/reference/mcp-tools/#planned-tool-contract)，[MCP 工具](/ambercast/zh-cn/reference/mcp-tools/#tool-table)。
