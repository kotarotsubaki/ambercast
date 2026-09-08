---
title: 状态与路线图
description: 明确 ambercast 0.3.1 的功能边界与后续设计规划。
---

理解 ambercast 的当前边界，有助于区分已实现的工程事实与后续的设计规划。在当前阶段，0.3.1 确立了明确的命令行能力范围，同时定义了计划（plans）在版本演进中的生命周期要求。

## 当前版本已实现 {#implemented}

在 0.3.1 中，CLI 解析器所暴露的子命令包括 `generate`、`run`、`check` 和 `heal`。当前已实现的解析器并未暴露 init、viewer 或 MCP 子命令。

对于在早期版本中生成的产物，0.3.1 要求重新生成 0.1.0 的计划。这是因为 producer-contract 的指纹发生了变更，致使既有的 producer bundle 以及 `inputsDigest` 处于 `stale`（已过期）状态。

相关链接：[CLI 概览](/ambercast/zh-cn/reference/cli/overview/)、[兼容性](/ambercast/zh-cn/reference/compatibility/)、[变更日志](/ambercast/zh-cn/reference/changelog/)

## 当前边界之后的规划 {#planned-after-current-boundary}

在当前实现的边界之外，项目规划中的文档涵盖了 `init`、`view`、`review`、`mcp`、baseline/restore、MCP 工具以及官方 skill。

在浏览器平台支持方面，Firefox 和 WebKit 计划在 1.0 达成。

相关链接：[ambercast init](/ambercast/zh-cn/reference/cli/init/)、[ambercast view](/ambercast/zh-cn/reference/cli/view/)、[official skill](/ambercast/zh-cn/agents/official-skill/)、[MCP 服务器](/ambercast/zh-cn/agents/mcp-server/)

## 版本策略 {#version-policy}

目前已发布的软件包版本为 0.3.1。关于工具演进的产品策略是：在整个 0.x 阶段仅保持 CLI 形式，并在迈向 1.0.0 时与云端版本一同交付。

相关链接：[变更日志](/ambercast/zh-cn/reference/changelog/)、[设计哲学](/ambercast/zh-cn/philosophy/)
