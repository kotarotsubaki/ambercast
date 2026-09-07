---
title: 在 AI Agent 中使用 ambercast
description: 为 AI Agent 提供修改测试资产前的操作阅读顺序、副作用范围与有界运行循环指引。
---

在修改测试资产前，本文档为 AI Agent 梳理所需的操作阅读顺序、副作用范围与操作分支。可用的 CLI 命令包括 `generate`、`run`、`check` 和 `heal`；确切的规范归属 Reference，具体操作流程归属 How-to。

## 行动前阅读 {#read-before-acting}

在修改测试资产前，您需要建立最基本的上下文认知。在考虑执行任何命令之前，请先查阅对应的确切契约：

| 阅读文档 | 原因 |
| --- | --- |
| [5 分钟完成您的首个测试](/ambercast/zh-cn/tutorials/quick-start/) | 建立产物循环与前提条件。 |
| [操作契约](/ambercast/zh-cn/agents/operating-contract/) | 确立副作用与审批边界。 |
| [CLI 概览](/ambercast/zh-cn/reference/cli/overview/) | 选择确切的命令契约。 |
| [报告](/ambercast/zh-cn/reference/reports/) | 在命令执行后解读结构化输出。 |

## 在有界循环中操作 {#bounded-loop}

Agent 所需的基础循环为：实现 → 编写或调整所请求的 `.test.md` → 运行 → 根据报告修复。生成（generation）过程会从规范化的 prompt 文本与选定的目标中获取来源依据（provenance），进而构建 plan 及其相邻的 grounding 路径。完全 grounding 的运行可以在无需解析 AI 提供商的情况下进行。

1. 在批准的范围内实现所请求的产品变更。→ 实现已就绪，可用于其所请求的测试意图。
2. 编写或调整所请求的 `.test.md`。→ prompt 表达了待验证的行为。
3. 运行选定的 `.test.md` 并读取其结构化结果。→ 在选择下一步行动前，使用 [报告](/ambercast/zh-cn/reference/reports/) 解读 envelope。
4. 根据报告进行修复，随后按需重复选定的循环。→ [操作契约](/ambercast/zh-cn/agents/operating-contract/) 规定了审批边界与安全的操作分支；切勿仅凭结果自行推断。

相关链接：[设置提示词](/ambercast/zh-cn/agents/setup-prompt/), [操作契约](/ambercast/zh-cn/agents/operating-contract/), [读取结构化输出](/ambercast/zh-cn/agents/reading-structured-output/), [机器可读资源](/ambercast/zh-cn/agents/machine-readable-resources/), [报告](/ambercast/zh-cn/reference/reports/)
