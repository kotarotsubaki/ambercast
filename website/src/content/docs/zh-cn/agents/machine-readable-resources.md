---
title: 机器可读资源
description: 明确列出已发布的机器可读资源及其可用性规则。
---

本页面列出 ambercast 已发布的机器可读资源及其可用性状态。智能体应以 `capabilities.json` 作为最终的可用性依据。

## 可用性规则 {#availability-rule}

- `capabilities.json` 是智能体判断资源最终可用性的依据。
- 计划中的页面会被排除在默认的 `llms.txt` 与 `llms-full.txt` 之外。
- 以下列出的所有资源均已在本次发布中上线。

## 已发布的产物 {#planned-artifacts}

| 资源 | 状态 |
| --- | --- |
| [`llms.txt`](https://kotarotsubaki.github.io/ambercast/llms.txt) | 可用 |
| [`llms-full.txt`](https://kotarotsubaki.github.io/ambercast/llms-full.txt) | 可用 |
| [`ja/llms.txt`](https://kotarotsubaki.github.io/ambercast/ja/llms.txt) | 可用 |
| [`ja/llms-full.txt`](https://kotarotsubaki.github.io/ambercast/ja/llms-full.txt) | 可用 |
| [`zh-cn/llms.txt`](https://kotarotsubaki.github.io/ambercast/zh-cn/llms.txt) | 可用 |
| [`zh-cn/llms-full.txt`](https://kotarotsubaki.github.io/ambercast/zh-cn/llms-full.txt) | 可用 |
| [`llms-planned.txt`](https://kotarotsubaki.github.io/ambercast/llms-planned.txt) | 可用 |
| [`schemas/config.schema.json`](https://kotarotsubaki.github.io/ambercast/schemas/config.schema.json) | 可用 |
| [`schemas/plan.v2.schema.json`](https://kotarotsubaki.github.io/ambercast/schemas/plan.v2.schema.json) | 可用 |
| [`schemas/grounding.v1.schema.json`](https://kotarotsubaki.github.io/ambercast/schemas/grounding.v1.schema.json) | 可用 |
| [`schemas/report.v3.schema.json`](https://kotarotsubaki.github.io/ambercast/schemas/report.v3.schema.json) | 可用 |
| [`capabilities.json`](https://kotarotsubaki.github.io/ambercast/capabilities.json) | 可用 |
| [`manifest/cli.json`](https://kotarotsubaki.github.io/ambercast/manifest/cli.json) | 可用 |

config、plan、grounding 与 report 的 Schema 产物均已发布，文档站点与 npm 分发包中所生成的字节完全一致。

本页面介绍在本次发布中已上线的构建生成产物。

相关链接：[在 AI Agent 中使用 ambercast](/ambercast/zh-cn/agents/overview/)、[JSON Schema 规范](/ambercast/zh-cn/reference/json-schemas/)、[状态与路线图](/ambercast/zh-cn/explanation/status-and-roadmap/)
