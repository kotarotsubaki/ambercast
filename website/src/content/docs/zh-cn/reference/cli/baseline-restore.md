---
title: ambercast baseline 与 restore
description: 尚未实现的 ambercast baseline 与 ambercast restore 的规划接口、存储位置、新鲜度规则和未决事项。
status: planned
sidebar:
  badge:
    text: Planned
    variant: caution
---

:::caution
`ambercast baseline` 和 `ambercast restore` 是当前版本尚未实现的规划功能。本页描述的接口和行为是预期的设计，不是现有功能。
:::

本页记录 ambercast 规划中的数据库边界。捕获基线和恢复基线是两个相互独立的操作。

## 状态 {#status}

`ambercast baseline` 和 `ambercast restore` 在当前版本中尚未实现，也不是可用的 CLI 命令。两者效果相反，所以做成两个独立的扁平动词。把它们合并成 `reset` 命令，或用模式标志切换，都因为更容易误用而被否决。可用的命令见 [CLI 概览](/ambercast/zh-cn/reference/cli/overview/#command-surface)，当前已有的配置键见[配置](/ambercast/zh-cn/reference/configuration/#key-table)。

## 规划的边界 {#planned-boundary}

| 命令 / 选项 | 规划的约定 |
| --- | --- |
| `baseline [--target <name>] [--list] [--clear] [--force] [--json]` | 把当前数据库捕获为所选目标的基线。 |
| `baseline --force` | 允许覆盖已有的基线。无论是否有 TTY 都必须带上，并且不会绕过无主键检查。 |
| `baseline --list` | 只显示基线元数据。 |
| `baseline --clear` | 删除所选基线，基线已不存在时同样成功。 |
| `restore [--target <name>] [--json]` | 为手动调试或 QA，把所选目标恢复到其基线。 |
| `run --no-reset` | 本次调用跳过重置和钩子。用于调试，不建议在 CI 中使用。 |
| `check` 集成 | 在不打开数据库连接的前提下，校验数据库配置的形态、可解析的机密、基线是否存在以及 `configDigest`。 |

## 规划的存储与新鲜度 {#planned-storage-and-freshness}

| 概念 | 规划的约定 |
| --- | --- |
| 位置 | `.baseline/<target>/`，相对于解析后的配置目录。不可配置，与 `runsDir` 分开，打算加入 gitignore。 |
| 元数据 | `meta.json` 记录 target、driver、capturedAt、capabilities、configDigest、sourceFingerprint 和 artifactRef。 |
| `configDigest` | 未解析的 driver、connection 和 driverOptions 占位符的哈希。不一致属于配置漂移，退出码为 `2`，不会自动重新捕获。 |
| `sourceFingerprint` | 非机密的远端身份的哈希。机密解析后不一致，退出码为 `3`。 |
| 执行计划新鲜度 | 两个数据库新鲜度值都不会进入执行计划的 `inputsDigest`。 |

`resetPerCase: true` 时，第一个用例之前和每个用例之后都会重置。随后按顺序运行边界钩子，进入下一个用例之前，屏障探测必须成功。

重置或屏障探测失败，默认会让受影响的用例出错，运行继续。设置 `onResetFailure: "abort"` 则停止运行。两种情况的退出码都是 `3`。钩子失败只会让对应的用例出错，运行继续。

规划中的配置类失败退出码为 `2`，包括 `baseline-missing`、未解析的目标或驱动、配置漂移、基线冲突和无效的标志组合。数据库连接、重置、钩子失败，以及源指纹不一致，退出码为 `3`。聚合时的优先级仍为 `2 > 3 > 4 > 1 > 5 > 0`。

面向人的输出和 JSON 输出都必须把 `mode` 标明为 `captured` 或 `restored`。

## 未决事项 {#undecided-items}

| 状态 | 事项 |
| --- | --- |
| 明确未决 | 引入 `baseline` 和 `restore` 的版本；两者都与 fixture 功能绑定。 |
| 已预留，并非未决 | `--all-targets`、`--list --live`、额外的钩子阶段以及并行工作进程的 `db.<target>` 子键是 v2 的预留项，不属于这个规划的接口。 |

通用的报告封套见[报告](/ambercast/zh-cn/reference/reports/#envelope)，工具侧的行为见 [MCP 工具](/ambercast/zh-cn/reference/mcp-tools/#tool-table)，新鲜度的推导见[新鲜度与摘要](/ambercast/zh-cn/spec/freshness/)。
