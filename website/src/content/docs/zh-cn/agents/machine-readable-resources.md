---
title: 机器可读资源
description: 站点发布了哪些机器可读文件，以及由 `capabilities.json` 决定哪些内容可用。
---

本页帮助 Agent 决定可以获取哪些文件，以及能否信任这些文件。

## 可用性规则 {#availability-rule}

是否可用，最终以 `capabilities.json` 为准。计划中的页面不会进入 `llms.txt` 和 `llms-full.txt`，而是连同标题和说明列在 `llms-planned.txt` 中。

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
| [`schemas/plan.v3.schema.json`](https://kotarotsubaki.github.io/ambercast/schemas/plan.v3.schema.json) | 可用 |
| [`schemas/plan.v4.schema.json`](https://kotarotsubaki.github.io/ambercast/schemas/plan.v4.schema.json) | 可用 |
| [`schemas/plan.v5.schema.json`](https://kotarotsubaki.github.io/ambercast/schemas/plan.v5.schema.json) | 可用 |
| [`schemas/grounding.v2.schema.json`](https://kotarotsubaki.github.io/ambercast/schemas/grounding.v2.schema.json) | 可用 |
| [`schemas/grounding.v3.schema.json`](https://kotarotsubaki.github.io/ambercast/schemas/grounding.v3.schema.json) | 可用 |
| [`schemas/grounding.v4.schema.json`](https://kotarotsubaki.github.io/ambercast/schemas/grounding.v4.schema.json) | 可用 |
| [`schemas/report.v3.schema.json`](https://kotarotsubaki.github.io/ambercast/schemas/report.v3.schema.json) | 可用 |
| [`capabilities.json`](https://kotarotsubaki.github.io/ambercast/capabilities.json) | 可用 |
| [`manifest/cli.json`](https://kotarotsubaki.github.io/ambercast/manifest/cli.json) | 可用 |

`plan.v2`、`plan.v3`、`plan.v4`、`grounding.v2` 和 `grounding.v3` 的 schema 是提交在仓库中的冻结快照，原样复制到站点。配置、执行计划 v5、定位缓存 v4 和报告的 schema，以及 `capabilities.json` 与 `manifest/cli.json`，与进入 npm 包的构建产物逐字节一致。

相关链接：[在 AI Agent 中使用 ambercast](/ambercast/zh-cn/agents/overview/)、[JSON Schema 规范](/ambercast/zh-cn/reference/json-schemas/)、[状态与路线图](/ambercast/zh-cn/explanation/status-and-roadmap/)
