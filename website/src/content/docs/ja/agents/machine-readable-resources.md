---
title: 機械可読リソース
description: サイトが公開する機械可読ファイルの一覧と、何が利用可能かを`capabilities.json`で決めるという規則を示す。
---

エージェントはこのページで、どのファイルを取得できるか、そのファイルを信頼してよいかを決める。

## 提供ルール {#availability-rule}

利用可能かどうかの最終的な根拠は`capabilities.json`である。計画中のページは`llms.txt`と`llms-full.txt`に含まれず、題名と説明つきで`llms-planned.txt`に並ぶ。

## 公開しているファイル {#planned-artifacts}

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
| [`schemas/plan.v4.schema.json`](https://kotarotsubaki.github.io/ambercast/schemas/plan.v4.schema.json) | 利用可能 |
| [`schemas/plan.v5.schema.json`](https://kotarotsubaki.github.io/ambercast/schemas/plan.v5.schema.json) | 利用可能 |
| [`schemas/grounding.v2.schema.json`](https://kotarotsubaki.github.io/ambercast/schemas/grounding.v2.schema.json) | 利用可能 |
| [`schemas/grounding.v3.schema.json`](https://kotarotsubaki.github.io/ambercast/schemas/grounding.v3.schema.json) | 利用可能 |
| [`schemas/grounding.v4.schema.json`](https://kotarotsubaki.github.io/ambercast/schemas/grounding.v4.schema.json) | 利用可能 |
| [`schemas/report.v3.schema.json`](https://kotarotsubaki.github.io/ambercast/schemas/report.v3.schema.json) | 利用可能 |
| [`capabilities.json`](https://kotarotsubaki.github.io/ambercast/capabilities.json) | 利用可能 |
| [`manifest/cli.json`](https://kotarotsubaki.github.io/ambercast/manifest/cli.json) | 利用可能 |

`plan.v2`、`plan.v3`、`plan.v4`、`grounding.v2`、`grounding.v3`のスキーマは、リポジトリにコミットした固定の履歴スナップショットで、サイトへそのまま複製される。設定、計画（plan）v5、グラウンディングv4、レポートのスキーマと、`capabilities.json`、`manifest/cli.json`は、npmパッケージに入るビルドと同じバイト列をサイトへ複製する。

関連リンク: [AIエージェントからのambercastの利用](/ambercast/ja/agents/overview/)、[JSON スキーマ](/ambercast/ja/reference/json-schemas/)、[ステータスとロードマップ](/ambercast/ja/explanation/status-and-roadmap/)
