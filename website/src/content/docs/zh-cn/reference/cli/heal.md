---
title: ambercast heal
description: 规定 ambercast heal 命令的授权机制与运行时副作用，并提供选项、修复模型、限制及运行时行为的完整参考。
---

`ambercast heal` 负责测试修复过程中的授权机制与运行时副作用。该命令支持对指定的测试提示词文件或通过自动发现选取的测试执行修复测量与变更提交，并提供非交互式授权、运行目标选择、AI 提供商覆盖以及输出格式等控制选项。

## 命令行选项 {#flags}

| 标志 | 取值 | 效果 | 默认值 |
| --- | --- | --- | --- |
| files | path[] | 字面提示词路径；缺省时执行自动发现 | discovery |
| --dry-run | boolean | 仅测量修复而不提交缓冲的 Plan 或 Grounding 变更 | false |
| --yes, -y | boolean | 授权非交互式提交 | false |
| --target | name | 选择目标 | omitted |
| --ai | claude\|codex | 覆盖提供商 | omitted |
| --allow-empty | boolean | 允许空选择集 | false |
| --list | boolean | 仅列出而不执行修复 | false |
| --json | boolean | 输出 JSON 封装格式 | false |
| --no-color | boolean | 禁用 ANSI 颜色 | false |

## 修复模型 {#repair-model}

完成的修复结果区分为 `healed`、`partially-healed`、`unresolved` 和 `no-changes-needed` 四种状态；每种状态都具有受约束的 `application` 与 `stopReason` 取值。

修复流程首先修复 Grounding，随后尝试单步修复或尾部修复，并在必要时执行全计划修复；Stage 3 会解析 AI 执行器并调用生成逻辑，因此能够调度真实的提供商。

## 限制 {#limits}

若设置了 `heal.maxStepRepairs`，该项是对真实增量修复提供商调度的正整数硬性限制，包含元素确认，但不包含仅使用缓存的基线与 Stage 3。

`heal.caseTimeoutMs` 是针对整个用例的正整数准入截止时间；其解析后的默认值为 300000 ms。

## 确认授权 {#confirmation}

除非指定 `--dry-run`，否则符合条件的修复工件仅在获得授权后提交；`--yes` 提供非交互式授权。

## CI 环境 {#ci}

除 `--list` 外，CI 环境中的修复操作将被拒绝，除非 `ci.heal` 为 true。

## 前提条件与写入行为 {#preconditions}

除 `--list` 外，所选目标必须是幂等的；默认目标是有状态的。

Plan 与 Grounding 伴生文件的写入会被缓冲，直至通过授权结算；但每次测量都可能通过 runsDir 范围内的存储写入尝试凭证，此副作用可在授权前发生，且在 `--dry-run` 期间也会发生。

进程退出码的取值及其优先级由 [退出码](/ambercast/zh-cn/reference/exit-codes/#aggregation-priority) 规定。

## 相关链接

- [配置](/ambercast/zh-cn/reference/configuration/#grounding)
- [报告](/ambercast/zh-cn/reference/reports/#heal-results)
- [退出码](/ambercast/zh-cn/reference/exit-codes/#exit-code-table)
- [文件布局](/ambercast/zh-cn/reference/file-layout/#run-artifacts)
