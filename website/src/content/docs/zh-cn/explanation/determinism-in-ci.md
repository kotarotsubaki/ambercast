---
title: CI 中的确定性
description: 在 CI 中，ambercast 的检查没有副作用，默认只写运行报告和受限证据，拒绝自动修复，并只返回一个退出码。
---

在 CI 中，检查没有副作用。ambercast 默认只写运行报告和受限证据，拒绝自动修复，并把最严重的问题作为单一退出码返回。

## 只读检查 {#read-only-check}

`check` 无法访问 AI 执行器、浏览器、机密、时钟和事件。它对存储的访问也是只读的。因此只读是结构上的保证，不靠约定。

检查提示词、执行计划、定位缓存和孤立产物，只需要读取和存在性检查。

相关链接：[ambercast check](/ambercast/zh-cn/reference/cli/check/#read-only-contract)、[执行计划的生命周期与新鲜度](/ambercast/zh-cn/explanation/plan-lifecycle/#fresh-plan-decision)

## 回放的写入有边界 {#bounded-side-effects}

`run` 只把运行报告 JSON 写到本次调用的报告路径。写入之前，它先把信封定稿为 `persisted`，所以文件与返回的信封一致。

写入失败时，`run` 返回带有 `reportPersistence: "failed"` 的信封。此时只有原本退出码为 0 的运行会变成 3，退出码 1、2、4、5 保持不变。`not-attempted` 表示没有尝试写入，`failed` 表示没有留下可见的部分内容。

在 CI 中回写定位缓存，需要 `--update-cache` 或 `ci.updateGroundingCache: true`。详情见[配置参考](/ambercast/zh-cn/reference/configuration/#grounding)。

相关链接：[报告](/ambercast/zh-cn/reference/reports/#persistence)、[ambercast run](/ambercast/zh-cn/reference/cli/run/#grounding-write-back)

## CI 默认拒绝自愈 {#heal-refusal}

除 `--list` 外，除非 `ci.heal` 为 true，否则 CI 中的 `heal` 会以配置错误失败。`heal --list` 仍是不写入任何内容的发现操作。

自愈把执行计划和定位缓存的候选项缓存在私有区域，只通过提交步骤写入。回放尝试仍可能在用例运行目录下写入受限证据，`--dry-run` 下的尝试也不例外。

相关链接：[ambercast heal](/ambercast/zh-cn/reference/cli/heal/#ci)、[自愈模型](/ambercast/zh-cn/explanation/healing-model/#confirmation-and-writes)

## 最严重的问题决定退出码 {#exit-priority}

结果混杂时，退出码取最严重的候选项。优先级固定为 `2 > 3 > 4 > 1 > 5 > 0`。迭代顺序和重复的候选项都不会改变结果。

相关链接：[退出码](/ambercast/zh-cn/reference/exit-codes/#aggregation-priority)、[操作契约](/ambercast/zh-cn/agents/operating-contract/#next-action-by-exit-code)、[读取结构化输出](/ambercast/zh-cn/agents/reading-structured-output/#decision-tree)
