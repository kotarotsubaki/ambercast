---
title: 机器可读资源
description: 明确列出计划中的机器可读资源及其当前未实现的可用性状态。
---

本页面为您明确列出 ambercast 规划中的机器可读资源及其当前的可用性状态。当前线上站点尚未提供这些资源，智能体在资源生成后应以 `capabilities.json` 作为最终的可用性依据。

## 可用性规则 {#availability-rule}

- 一旦生成，`capabilities.json` 将作为智能体判断资源最终可用性的依据。
- 计划中的页面会被排除在默认的 `llms.txt` 与 `llms-full.txt` 之外。
- 当前线上站点中不存在以下所列的任何资源；各项资源目前均处于规划中（在 0.3.1 中未实现）。

## 计划中的产物 {#planned-artifacts}

| 资源 | 状态 |
| --- | --- |
| `/ambercast/llms.txt` | 计划中（在 0.3.1 中未实现） |
| `/ambercast/llms-full.txt` | 计划中（在 0.3.1 中未实现） |
| 各语言区域的 `/{locale}/llms.txt` 变体 | 计划中（在 0.3.1 中未实现） |
| `/ambercast/schemas/*.json` | 计划中（在 0.3.1 中未实现） |
| `capabilities.json` | 计划中（在 0.3.1 中未实现） |

针对 config、plan、grounding 与 report，计划提供相应的 Schema 产物，文档站点与 npm 分发包中所生成的字节完全一致。

本页面归类为构建生成的产物，当前仍处于设计规划阶段。

相关链接：[在 AI Agent 中使用 ambercast](/ambercast/zh-cn/agents/overview/)、[JSON Schema 规范](/ambercast/zh-cn/reference/json-schemas/)、[状态与路线图](/ambercast/zh-cn/explanation/status-and-roadmap/)
