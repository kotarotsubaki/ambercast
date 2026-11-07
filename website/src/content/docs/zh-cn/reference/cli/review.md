---
title: ambercast review
description: 尚未实现的 ambercast review 的规划接口与未决事项，该命令让独立的 AI 判断执行计划是否符合意图。
status: planned
sidebar:
  badge:
    text: Planned
    variant: caution
---

:::caution
`ambercast review` 在当前版本中尚未实现。本页描述的接口和约定是规划中的 v2 行为，而不是当前 CLI 的能力。
:::

本页记录 `ambercast review` 计划检查什么、计划返回什么，以及哪些问题仍未决定。

## 状态 {#status}

`ambercast review` 在当前版本中尚未实现，也不是可用的 CLI 命令。它计划在 v2 中提供。可用的命令见 [CLI 概览](/ambercast/zh-cn/reference/cli/overview/#command-surface)，目前已有的结果形态见[报告](/ambercast/zh-cn/reference/reports/#result-shapes)。

## 规划的接口 {#planned-interface}

| 语法 / 行为 | 规划的约定 |
| --- | --- |
| `review [files...] [--target <name>] [--json]` | 在与生成器分离的上下文中，请 AI 判断执行计划是否符合意图、验证是否充分。 |
| `--target` | 目标按显式指定的目标、配置的默认值、唯一的自有目标键的顺序解析，都没有则以退出码 `2` 结束。显式给出的名称无效时，不会回退到其他目标。 |
| `--json` | 在参数解析之后的每一种退出路径上，输出通用的结构化封套。 |
| 审查关注项 | 关注项是该命令正当的红色结果，对应退出码 `1`。 |

- 该命令划归 v2，名称已于 2026-08-01 确定。
- 规划的聚合退出码优先级为 `2 > 3 > 4 > 1 > 5 > 0`。

## 未决事项 {#undecided-items}

| 状态 | 事项 | 仍未决定的原因 |
| --- | --- | --- |
| 缺口 | `--allow-empty` 和 `--list` | 规划中的设计把这两个标志都分配给 `review`，但它的语法中没有列出。 |
| 未规定 | 审查提供商与详细的结果约定 | 设计只说明由独立上下文中的 AI 判断意图和验证是否充分。 |
| 明确未决 | `review` 没有此类事项 | 只有 `baseline` 和 `restore` 带有这个标签。 |

当前可用的工具见 [MCP 工具](/ambercast/zh-cn/reference/mcp-tools/#tool-table)，审查要读取的执行计划格式见[执行计划文档](/ambercast/zh-cn/spec/plan-document/)。
