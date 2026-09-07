---
title: ambercast review
description: 定义规划中的独立 AI 审查结果与已知命令行选项。
status: planned
sidebar:
  badge:
    text: Planned
    variant: caution
---

:::caution
`ambercast review` 属于规划中的功能，尚未在 0.3.1 中实现。当前命令行解析器仅接受 `generate`、`run`、`check` 和 `heal`，并会拒绝任何其他命令。本文档描述的是预期设计行为，而非当前版本的实际行为。
:::

本文档定义了规划中由独立 AI 审查测试计划（Plan）的结果与已知命令行选项。

## 状态 {#status}

`ambercast review` 在 0.3.1 中尚未实现；命令行解析器仅接受 `generate`、`run`、`check` 和 `heal`，并会拒绝任何其他命令。其作为 v2 命令的角色由命令行设计所定义。

相关链接：[CLI 概览](/ambercast/zh-cn/reference/cli/overview/#command-surface)、[报告](/ambercast/zh-cn/reference/reports/#result-shapes)。

## 规划的接口 {#planned-interface}

| 语法 / 行为 | 规划契约 |
| --- | --- |
| `review [files...] [--target <name>] [--json]` | 在与生成器相互独立的上下文中请求 AI 评估 Plan 是否符合意图且验证是否充分。 |
| `--target` | 规划的目标解析顺序依次为：显式指定的 target、配置的默认值、自身唯一的 target 键，若均未匹配则以退出码 2 退出；若显式给出的 target 名称无效，绝不回退。 |
| `--json` | 在完成命令行参数解析后的每次退出时，输出通用的结构化外层封装。 |
| 审查关注项 | 审查关注项属于该命令正规的红色失败（red result）结果，映射为退出码 1。 |

该命令归属于 v2，其名称已于 2026-08-01 正式确定。

规划的多任务综合退出码判定优先级为 `2 > 3 > 4 > 1 > 5 > 0`。

## 未决事项 {#undecided-items}

| 状态 | 事项 | 保持未决的原因 |
| --- | --- | --- |
| 缺口 | `--allow-empty` 与 `--list` | 命令概要中省略了它们，而命令与选项矩阵则将两者均分配给了 review 并定义了其行为。 |
| 未规定 | 审查提供商与详细结果契约 | 设计中仅声明由独立上下文中的 AI 评判意图与验证充分性。 |
| 明确未决 | `review` 无此类事项 | 仅 `baseline` 和 `restore` 带有此标记。 |

相关链接：[MCP 工具](/ambercast/zh-cn/reference/mcp-tools/#planned-tool-contract)、[计划文档](/ambercast/zh-cn/spec/plan-document/)。
