---
title: ambercast view
description: 定义本地测试结果查看器的调用方式、端口选择以及非交互式环境下的拒绝策略。
status: planned
sidebar:
  badge:
    text: Planned
    variant: caution
---

:::caution
`ambercast view` 尚未在 0.3.1 中实现。本文档为您呈现规划中的预期设计，而非当前已实现的功能。
:::

`ambercast view` 用于启动本地测试结果查看器，涵盖查看器的调用方式、端口选择策略以及在非交互式环境下的拒绝行为。该命令在 0.3.1 中尚未实现；当前命令行解析器仅接受 `generate`、`run`、`check` 和 `heal`，并会拒绝任何其他命令。

## 状态 {#status}

`ambercast view` 目前尚未在 0.3.1 中实现。命令行解析器仅接受 `generate`、`run`、`check` 与 `heal`，传入任何其他命令均会被拒绝。该命令作为本地查看器的角色定位由查看器设计定义。

相关链接：[CLI 概览](/ambercast/zh-cn/reference/cli/overview/#command-surface)，[报告](/ambercast/zh-cn/reference/reports/#envelope)。

## 规划的接口 {#planned-interface}

| 语法 / 行为 | 规划约定 |
| --- | --- |
| `view [--port <n>] [--host <addr>] [--allow-headless]` | 启动本地结果查看器。 |
| 默认端口 | 从配置的或默认端口开始，逐次递增直至找到可用端口，并输出实际 URL。 |
| `--port` / 配置 | 允许指定固定端口，以支持 CI 环境或方便您保存稳定的书签。 |
| 非交互式默认行为 | 在 CI 或非交互式终端中默认拒绝运行，退出代码为 2。 |
| `--allow-headless` | 显式解除非交互式环境下的拒绝限制。 |
| 通用设计标志 | `--config <path>`、`--no-color`、`--version` 和 `--help` 被声明为所有规划命令的通用标志；命令矩阵未将 `--json` 分配给 view。 |

查看器规划为一个用于展示测试结果和屏幕截图的本地类 Storybook 服务器。

在呈现方式上，存储的 JSON 与屏幕截图决定渲染的结构；AI 的作用严格限定于生成测试摘要和失败解释等自然语言内容。

根据规划的通用退出代码约定，浏览器启动失败被归类为环境错误，退出代码为 3。

view 是 Ambercast 规划中唯一消耗网络端口的功能；规划中的 MCP 服务器采用无端口的 stdio。

## 未决事项 {#undecided-items}

| 状态 | 事项 |
| --- | --- |
| 未规定 | 规划中虽然命名了 `--host`，但其绑定地址、网络接口及公网暴露等语义尚未定义。 |
| 未规定 | 默认端口号、递增上限、服务器生命周期、路由以及 UI 均尚未在查看器设计中固定。 |
| 明确未决 | `view` 无明确未决事项；设计中仅将 `baseline` 和 `restore` 标记为未决。 |

相关链接：[配置](/ambercast/zh-cn/reference/configuration/#key-table)，[报告](/ambercast/zh-cn/reference/reports/#result-shapes)，[ambercast mcp](/ambercast/zh-cn/reference/cli/mcp/#planned-interface)。
