---
title: 在 AI Agent 中使用 ambercast
description: Agent 在修改测试资产前按顺序阅读四个页面，然后按“实现、编写提示词、运行、依据报告修复”的循环工作。
---

本页帮助 Agent 决定开始前读什么、按什么顺序行动。Agent 页面负责阅读顺序、副作用和行动分支，精确规格由参考页负责，操作步骤由操作指南负责。

## 行动前阅读 {#read-before-acting}

CLI 有七个命令：`init`、`generate`、`run`、`check`、`heal`、`view` 和 `mcp`。修改测试资产前，按顺序阅读下面四个页面。

| 阅读 | 得到什么 |
| --- | --- |
| [5 分钟内完成第一个测试](/ambercast/zh-cn/tutorials/quick-start/) | 产物循环与前置条件 |
| [操作契约](/ambercast/zh-cn/agents/operating-contract/) | 副作用与审批边界 |
| [CLI 概览](/ambercast/zh-cn/reference/cli/overview/) | 每个命令的精确契约 |
| [报告](/ambercast/zh-cn/reference/reports/) | 命令执行后如何读取 JSON 报告 |

相关链接：[设置提示词](/ambercast/zh-cn/agents/setup-prompt/)、[读取结构化输出](/ambercast/zh-cn/agents/reading-structured-output/)、[机器可读资源](/ambercast/zh-cn/agents/machine-readable-resources/)

## 在有界循环中工作 {#bounded-loop}

基本循环是：实现，编写或调整所要求的 `.test.md`，运行，依据报告修复。审批边界以操作契约为准，不要从单个结果推断。

1. 在获批的范围内实现所要求的产品改动。
2. 编写或调整所要求的 `.test.md`，让提示词写明要验证的行为。
3. 运行该 `.test.md`，读取它的 JSON 报告。
4. 依据报告修复，必要时再次运行。

`run` 需要可信的执行计划，所以要先运行 `generate`。`generate` 会在提示词旁写入执行计划和定位缓存文件。定位缓存完整时，回放不调用 AI。定位缓存未命中时，除非传入 `--resolve`，否则命令以退出码 4 失败。

相关链接：[操作契约](/ambercast/zh-cn/agents/operating-contract/)、[报告](/ambercast/zh-cn/reference/reports/)
