---
title: 状态与路线图
description: 说明当前版本已实现的内容、计划中的内容，以及 1.0 之前版本的演进方式。
---

当前 CLI 有七个子命令：`init`、`generate`、`run`、`check`、`heal`、`view` 和 `mcp`。`review` 和 baseline/restore 仍在计划中。1.0 之前，模式和生成器的变更可能要求你重新生成执行计划。

## 当前版本已实现 {#implemented}

CLI 解析器公开 `init`、`generate`、`run`、`check`、`heal`、`view` 和 `mcp` 七个子命令。`ambercast mcp` 通过 stdio 提供六个工具。

Chromium 是目前唯一支持的浏览器。

1.0 之前，次版本也可能包含破坏性变更。模式或生成器的变更会迫使你重新生成现有的执行计划。例如在 0.2.0 中，生成器契约的变更使 0.1.0 的执行计划变为 `stale`。哪些版本需要重新生成，可查看[再生成边界](/ambercast/zh-cn/reference/compatibility/#regeneration-boundary)和 [0.2.0 变更日志](/ambercast/zh-cn/reference/changelog/#release-020)。

相关链接：[CLI 概览](/ambercast/zh-cn/reference/cli/overview/)、[兼容性](/ambercast/zh-cn/reference/compatibility/)、[变更日志](/ambercast/zh-cn/reference/changelog/)

## 当前边界之后的计划 {#planned-after-current-boundary}

`review` 和 baseline/restore 仍在计划中。Firefox 和 WebKit 支持在计划中，云版本也在计划中。MCP 工具已经可以使用。

相关链接：[ambercast review](/ambercast/zh-cn/reference/cli/review/)、[MCP 服务器](/ambercast/zh-cn/agents/mcp-server/)

## 版本策略 {#version-policy}

[兼容性表](/ambercast/zh-cn/reference/compatibility/#compatibility-table)列出了已发布的软件包版本。在 MVP 之前，产品保持在 0.x 版本。

相关链接：[变更日志](/ambercast/zh-cn/reference/changelog/)、[设计哲学](/ambercast/zh-cn/philosophy/)
