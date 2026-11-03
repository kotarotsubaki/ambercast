---
title: Machine-readable resources
description: The site publishes these machine-readable files, and `capabilities.json` decides which of them are available.
---

These are the files you can fetch, and the rule that says which of them to trust.

## Availability rule {#availability-rule}

`capabilities.json` is the final source for what is available. Planned pages stay out of `llms.txt` and `llms-full.txt`, and `llms-planned.txt` lists each with its title and description.

## Published artifacts {#planned-artifacts}

| Resource | State |
| --- | --- |
| [`llms.txt`](https://kotarotsubaki.github.io/ambercast/llms.txt) | available |
| [`llms-full.txt`](https://kotarotsubaki.github.io/ambercast/llms-full.txt) | available |
| [`ja/llms.txt`](https://kotarotsubaki.github.io/ambercast/ja/llms.txt) | available |
| [`ja/llms-full.txt`](https://kotarotsubaki.github.io/ambercast/ja/llms-full.txt) | available |
| [`zh-cn/llms.txt`](https://kotarotsubaki.github.io/ambercast/zh-cn/llms.txt) | available |
| [`zh-cn/llms-full.txt`](https://kotarotsubaki.github.io/ambercast/zh-cn/llms-full.txt) | available |
| [`llms-planned.txt`](https://kotarotsubaki.github.io/ambercast/llms-planned.txt) | available |
| [`schemas/config.schema.json`](https://kotarotsubaki.github.io/ambercast/schemas/config.schema.json) | available |
| [`schemas/plan.v2.schema.json`](https://kotarotsubaki.github.io/ambercast/schemas/plan.v2.schema.json) | available |
| [`schemas/plan.v3.schema.json`](https://kotarotsubaki.github.io/ambercast/schemas/plan.v3.schema.json) | available |
| [`schemas/plan.v4.schema.json`](https://kotarotsubaki.github.io/ambercast/schemas/plan.v4.schema.json) | available |
| [`schemas/plan.v5.schema.json`](https://kotarotsubaki.github.io/ambercast/schemas/plan.v5.schema.json) | available |
| [`schemas/grounding.v2.schema.json`](https://kotarotsubaki.github.io/ambercast/schemas/grounding.v2.schema.json) | available |
| [`schemas/grounding.v3.schema.json`](https://kotarotsubaki.github.io/ambercast/schemas/grounding.v3.schema.json) | available |
| [`schemas/grounding.v4.schema.json`](https://kotarotsubaki.github.io/ambercast/schemas/grounding.v4.schema.json) | available |
| [`schemas/report.v3.schema.json`](https://kotarotsubaki.github.io/ambercast/schemas/report.v3.schema.json) | available |
| [`capabilities.json`](https://kotarotsubaki.github.io/ambercast/capabilities.json) | available |
| [`manifest/cli.json`](https://kotarotsubaki.github.io/ambercast/manifest/cli.json) | available |

The `plan.v2`, `plan.v3`, `plan.v4`, `grounding.v2`, and `grounding.v3` schemas are frozen snapshots committed in the repository and copied to the site unchanged. The config, Plan v5, Grounding v4, and report schemas, `capabilities.json`, and `manifest/cli.json` are copied byte for byte from the build that also goes into the npm package.

Related: [Using ambercast from an AI agent](/ambercast/agents/overview/), [JSON Schemas](/ambercast/reference/json-schemas/), [Status and roadmap](/ambercast/explanation/status-and-roadmap/)
