---
title: ambercast baseline 与 restore
description: ambercast baseline 与 restore 命令规划的外部边界、存储位置、新鲜度验证规则与未决事项参考。
status: planned
sidebar:
  badge:
    text: Planned
    variant: caution
---

:::caution
`ambercast baseline` 与 `ambercast restore` 属于规划中的功能，在 0.3.1 版本中尚未实现。本文档描述的是预期设计行为，而非当前的实现行为。
:::

本文档记录 `ambercast baseline` 与 `ambercast restore` 规划的外部数据库边界、存储规范、新鲜度检验规则以及未决设计事项。

## 状态 {#status}

`ambercast baseline` 与 `ambercast restore` 在 0.3.1 版本中尚未实现；解析器目前仅接受 `generate`、`run`、`check` 和 `heal`，并会拒绝任何其他命令。两者规划的数据库边界由数据库重置设计所定义。

相关链接：[CLI 概览](/ambercast/zh-cn/reference/cli/overview/#command-surface)、[配置](/ambercast/zh-cn/reference/configuration/#key-table)。

## 规划的外部边界 {#planned-boundary}

| 命令 / 选项 | 规划契约 |
| --- | --- |
| `baseline [--target <name>] [--list] [--clear] [--force] [--json]` | 将当前数据库捕获为所选目标的基线。 |
| `baseline --force` | 允许覆盖已存在的基线；无论是否处于 TTY 环境均须指定，且不会绕过无主键检查器。 |
| `baseline --list` | 仅显示基线元数据。 |
| `baseline --clear` | 删除所选基线；若基线不存在则幂等成功。 |
| `restore [--target <name>] [--json]` | 将所选目标恢复为其基线，用于手动调试或 QA。 |
| `run --no-reset` | 在该次调用中跳过重置与钩子；主要用于调试，不建议在 CI 中使用。 |
| `check` 集成 | 在不建立数据库连接的情况下，验证数据库配置结构、可解析的密钥、基线是否存在以及 `configDigest`。 |

捕获与恢复设计为独立的扁平动词，因为它们具有相反的效果；引入 `reset` 加模式标志的设计方案因更容易被误用而被否决。

## 规划的存储与新鲜度 {#planned-storage-and-freshness}

| 概念 | 规划契约 |
| --- | --- |
| 位置 | `.baseline/<target>/`，相对于解析后的配置目录，不可配置，独立于 `runsDir`，应加入 gitignore。 |
| 元数据 | `meta.json` 记录 target、driver、capturedAt、capabilities、configDigest、sourceFingerprint 以及 artifactRef。 |
| `configDigest` | 对未解析的 driver/connection/driverOptions 占位符进行哈希；不匹配即判定为配置漂移，退出码为 2，不会自动重新捕获。 |
| `sourceFingerprint` | 对非机密的远程身份信息进行哈希；密钥解析后若不匹配，退出码为 3。 |
| Plan 新鲜度 | 两个数据库新鲜度数值均不计入 Plan 的 `inputsDigest`。 |

当 `resetPerCase: true` 时，重置会在首个用例之前以及每个用例之后运行，随后按顺序运行边界钩子，且在进入下一个用例前屏障探测必须成功。

重置或屏障失败默认将受影响的用例标记为错误并继续运行；配置 `onResetFailure: "abort"` 会中止运行，两种路径的退出码均为 3。钩子失败仅将该用例标记为错误并继续运行。

规划的配置失败（`baseline-missing`、未解析的 target/driver、配置漂移、基线冲突以及无效标志组合）退出码为 2；数据库连接/重置/钩子失败以及 source-fingerprint 不匹配退出码为 3；综合退出码优先级仍为 `2 > 3 > 4 > 1 > 5 > 0`。

人类可读输出与 JSON 输出必须将 `mode` 标明为 `captured` 或 `restored`。

## 未决事项 {#undecided-items}

| 状态 | 事项 |
| --- | --- |
| 明确未决 | 引入 `baseline` 与 `restore` 的具体发布版本；两者均与 fixture 功能绑定。 |
| 保留项而非未决 | `--all-targets`、`--list --live`、额外的钩子阶段以及并行 worker 的 `db.<target>` 子键均属于 v2 保留项，不属于当前规划的接口范围。 |

相关链接：[报告](/ambercast/zh-cn/reference/reports/#envelope)、[MCP 工具](/ambercast/zh-cn/reference/mcp-tools/#planned-tool-contract)、[新鲜度与摘要](/ambercast/zh-cn/spec/freshness/)。
