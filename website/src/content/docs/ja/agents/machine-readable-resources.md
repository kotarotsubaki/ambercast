---
title: 機械可読リソース
description: ambercast で公開されている機械可読リソースと、その提供ルールについて説明します。
---

本ドキュメントでは、ambercast のドキュメントサイトで公開されている機械可読リソースと、その提供ルールについて説明します。

## 提供ルール {#availability-rule}

エージェント向けのリソース提供ルールは以下のとおりです。

- `capabilities.json` は、エージェントにとっての最終的な提供可否の参照元です。
- 計画中のページは、既定の `/ambercast/llms.txt` および `/ambercast/llms-full.txt` から除外されます。
- 本ページに記載されているリソースはすべて、このリリースで公開サイトに公開されています。

## 公開済みのアーティファクト {#planned-artifacts}

| リソース | 状態 |
| --- | --- |
| [`llms.txt`](https://kotarotsubaki.github.io/ambercast/llms.txt) | 利用可能 |
| [`llms-full.txt`](https://kotarotsubaki.github.io/ambercast/llms-full.txt) | 利用可能 |
| [`ja/llms.txt`](https://kotarotsubaki.github.io/ambercast/ja/llms.txt) | 利用可能 |
| [`ja/llms-full.txt`](https://kotarotsubaki.github.io/ambercast/ja/llms-full.txt) | 利用可能 |
| [`zh-cn/llms.txt`](https://kotarotsubaki.github.io/ambercast/zh-cn/llms.txt) | 利用可能 |
| [`zh-cn/llms-full.txt`](https://kotarotsubaki.github.io/ambercast/zh-cn/llms-full.txt) | 利用可能 |
| [`llms-planned.txt`](https://kotarotsubaki.github.io/ambercast/llms-planned.txt) | 利用可能 |
| [`schemas/config.schema.json`](https://kotarotsubaki.github.io/ambercast/schemas/config.schema.json) | 利用可能 |
| [`schemas/plan.v2.schema.json`](https://kotarotsubaki.github.io/ambercast/schemas/plan.v2.schema.json) | 利用可能 |
| [`schemas/plan.v3.schema.json`](https://kotarotsubaki.github.io/ambercast/schemas/plan.v3.schema.json) | 利用可能 |
| [`schemas/grounding.v1.schema.json`](https://kotarotsubaki.github.io/ambercast/schemas/grounding.v1.schema.json) | 利用可能 |
| [`schemas/report.v3.schema.json`](https://kotarotsubaki.github.io/ambercast/schemas/report.v3.schema.json) | 利用可能 |
| [`capabilities.json`](https://kotarotsubaki.github.io/ambercast/capabilities.json) | 利用可能 |
| [`manifest/cli.json`](https://kotarotsubaki.github.io/ambercast/manifest/cli.json) | 利用可能 |

`schemas/plan.v2.schema.json` は、コミット済みの履歴スナップショットをサイトへコピーした凍結アーティファクトです。現在のビルドは config スキーマ、Plan v3 スキーマ、grounding スキーマ、report スキーマ、`capabilities.json`、および `manifest/cli.json` を生成し、サイト向けと npm 配布向けで同一のバイト列になります。

本ドキュメントは、このリリースで公開されたアーティファクトを扱います。

関連情報: [AIエージェントからのambercastの利用](/ambercast/ja/agents/overview/), [JSON スキーマ](/ambercast/ja/reference/json-schemas/), [ステータスとロードマップ](/ambercast/ja/explanation/status-and-roadmap/)
