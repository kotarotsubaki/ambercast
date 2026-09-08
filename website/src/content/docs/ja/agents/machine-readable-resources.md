---
title: 機械可読リソース
description: ambercast で計画されている機械可読リソースと、その提供ルールについて説明します。
---

本ドキュメントでは、ambercast のドキュメントサイトにおいて計画されている機械可読リソースと、その提供ルールについて説明します。

## 提供ルール {#availability-rule}

エージェント向けのリソース提供ルールは以下のとおりです。

- `capabilities.json` が生成された段階で、エージェントにとっての最終的な提供可否の参照元となります。
- 計画中のページは、既定の `/ambercast/llms.txt` および `/ambercast/llms-full.txt` から除外されます。
- 本ページに記載されているリソースはいずれも現在の公開サイトには存在しておらず、すべて計画中（0.3.1 では未実装）です。

## 計画中のアーティファクト {#planned-artifacts}

| リソース | 状態 |
| --- | --- |
| `/ambercast/llms.txt` | 計画中（0.3.1 では未実装） |
| `/ambercast/llms-full.txt` | 計画中（0.3.1 では未実装） |
| ロケールごとの `/{locale}/llms.txt` バリアント | 計画中（0.3.1 では未実装） |
| `/ambercast/schemas/*.json` | 計画中（0.3.1 では未実装） |
| `capabilities.json` | 計画中（0.3.1 では未実装） |

スキーマのアーティファクトは config、plan、grounding、および report 向けに計画されており、サイト向けと npm 配布向けで同一のバイト列が生成されます。

本ドキュメントはビルド生成アーティファクトに位置付けられており、現時点における設計内容を反映しています。

関連情報: [AIエージェントからのambercastの利用](/ambercast/ja/agents/overview/), [JSON スキーマ](/ambercast/ja/reference/json-schemas/), [ステータスとロードマップ](/ambercast/ja/explanation/status-and-roadmap/)
