---
title: MCP 服务器
description: 介绍 ambercast 规划中的 MCP 服务器连接边界与传输方式。
status: planned
sidebar:
  badge:
    text: Planned
    variant: caution
---

:::caution
此页面描述了一项规划中的功能，尚未在 0.3.1 中实现。本文档描述的是预期设计行为，而非当前已实现的行为。
:::

本文档说明 ambercast 规划中的 MCP 服务器连接边界与传输方式。该功能属于规划中的特性，尚未在 0.3.1 中实现。

## 状态 {#status}

本文档所描述的功能属于规划中的特性，尚未在 0.3.1 中实现。在 0.3.1 版本中，没有可用的 MCP 连接。

## 规划的连接边界 {#planned-connection-boundary}

- MCP 规划为使用 stdio 的 `ambercast mcp` 子命令，每个实例的作用域限制在其自身的当前工作目录中。
- MCP 设计是工具模式（tool schemas）、注解（annotations）、`isError` 以及默认 `dryRun` 行为的来源。

## 相关链接

- [MCP 工具](/ambercast/zh-cn/reference/mcp-tools/)
- [读取结构化输出](/ambercast/zh-cn/agents/reading-structured-output/)
- [状态与路线图](/ambercast/zh-cn/explanation/status-and-roadmap/)
