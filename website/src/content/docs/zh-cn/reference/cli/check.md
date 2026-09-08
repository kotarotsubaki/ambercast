---
title: ambercast check
description: 为 CLI 用户汇总检查状态。
---

`ambercast check` 为命令行用户汇总检查状态。您可以直接指定字面提示词路径，或者在未指定时由命令执行自动发现；同时可以使用相关标志选择目标、允许空选择、仅列出文件而不执行检查、以 JSON 外层封包输出、显式指定配置文件或禁用 ANSI 颜色。

## 标志 {#flags}

| 标志 | 值 | 作用 | 默认值 |
| --- | --- | --- | --- |
| files | path[] | 字面提示词；未指定时选择自动发现 | discovery |
| --target | name | 选择目标 | 省略 |
| --allow-empty | boolean | 允许空选择 | false |
| --list | boolean | 仅列出而不执行检查 | false |
| --json | boolean | JSON 外层封包 | false |
| --config | path | 显式指定配置 | 省略 |
| --no-color | boolean | 禁用 ANSI 颜色 | false |

## 状态词汇 {#status-vocabulary}

`check` 报告的状态包括：`fresh`、`stale`（已过期）、`missing-plan`、`missing-grounding`、`invalid-grounding`、`stale-grounding`、`fresh-without-grounding`、`orphaned-plan`、`orphaned-grounding`、`invalid-artifact-name`、`listed` 或 `skipped`。

这些值的规范派生规则以及通过/失败分类归 [新鲜度与摘要](/ambercast/zh-cn/spec/freshness/#freshness-consequences) 所有。

## 结果 {#results}

已完成的检查发现必须包含 `id`、`file`、`planFile`、`status` 和 `reason`；`groundingFile` 或 `artifactFile` 仅在其作为证据时才会出现。

`check` 是只读命令：其依赖约定排除了 AI、浏览器、事件与写入存储。

## 只读检查 {#read-only-contract}

Check 组合了只读存储、布局与发现。

进程退出码的数值及其优先级归 [退出码](/ambercast/zh-cn/reference/exit-codes/#aggregation-priority) 所有；不可信工件产生退出码 4，未被允许的空选择产生退出码 5。

相关链接：[文件布局](/ambercast/zh-cn/reference/file-layout/#companions)、[报告](/ambercast/zh-cn/reference/reports/#check-results)、[退出码](/ambercast/zh-cn/reference/exit-codes/#exit-code-table)、[配置](/ambercast/zh-cn/reference/configuration/#file-selection)。
