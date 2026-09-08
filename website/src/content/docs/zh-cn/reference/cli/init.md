---
title: ambercast init
description: 记录 ambercast init 规划中的脚手架接口与尚未确定的设计选项。
status: planned
sidebar:
  badge:
    text: Planned
    variant: caution
---

:::caution
`ambercast init` 为规划中的功能，在 0.3.1 版本中尚未实现。本文档描述的是预期的设计行为，而非当前已实现的行为。
:::

`ambercast init` 规划用于初始化项目脚手架。本文档记录该命令规划中的脚手架接口规范及其尚未确定的设计选项。

## 状态 {#status}

`ambercast init` 在 0.3.1 版本中尚未实现；解析器目前仅接受 `generate`、`run`、`check` 与 `heal`，并会拒绝任何其他命令。其规划中的脚手架接口由 CLI 设计定义。

相关链接：[CLI 概览](/ambercast/zh-cn/reference/cli/overview/#command-surface)、[5 分钟完成您的首个测试](/ambercast/zh-cn/tutorials/quick-start/)。

## 规划的接口 {#planned-interface}

| 语法 / 行为 | 规划约定 |
| --- | --- |
| `init [--dir <path>] [--yes]` | 准备 `ambercast.config.json` 与示例 `test.md`。 |
| `--yes`, `-y` | 以非交互方式完成脚手架生成。 |
| 现有配置文件 | 发出警告并停止；说明文本指出 `--force` 会覆盖它。 |
| CI 工作流 | 不生成 CI 工作流。 |
| 全局设计标志 | `--config <path>`、`--no-color`、`--version` 与 `--help` 声明为所有规划命令的通用标志。 |

规划中的该命令用于准备配置与示例测试，而非生成 Plan 或运行测试。

通用的非交互模式判断规则为 `!process.stdout.isTTY || CI`；当 `CI` 环境变量已定义且既非空也非 `"false"` 时即处于激活状态。

## 未决事项 {#undecided-items}

| 状态 | 事项 | 尚未确定的原因 |
| --- | --- | --- |
| 缺口 | `--force` 的确切参数形式 | 命令概要与命令标志矩阵中未列出 `--force`，而在同一命令的描述中却赋予了它覆盖行为；该接口目前尚未得到确认。 |
| 未规定 | 非交互模式下的拒绝行为 | 设计中将 `init` 标为通用非交互规则的使用方，但未规定在缺失 `--yes` 时是否拒绝，亦未规定会产生何种结果或退出状态；该行为目前尚未确认。 |
| 明确未决 | `init` 无此类事项 | 设计中仅将 `baseline` 与 `restore` 标注为 `未決`；并未对 `init` 的任何事项作此标注。 |

相关链接：[配置](/ambercast/zh-cn/reference/configuration/#file-selection)、[配置目标环境](/ambercast/zh-cn/how-to/configure-targets/)。
