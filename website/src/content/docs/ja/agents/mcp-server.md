---
title: MCP サーバー
description: ambercast で計画されている MCP サーバーの接続仕様と境界について説明します。
status: planned
sidebar:
  badge:
    text: Planned
    variant: caution
---

:::caution
このページで説明している機能は計画段階のものであり、バージョン 0.3.1 には実装されていません。現在の動作ではなく、計画されている設計上の動作について説明しています。
:::

本ドキュメントでは、ambercast における MCP サーバーの計画されている接続仕様と設計境界について説明します。本機能は現在計画中であり、バージョン 0.3.1 には実装されていません。

## ステータス {#status}

本ページで説明している機能は計画中のものであり、0.3.1 には実装されていません。

## 計画されている接続境界 {#planned-connection-boundary}

エージェントインターフェースの設計では、MCP は stdio を使用する `ambercast mcp` サブコマンドとして計画されており、各インスタンスはそのカレントワーキングディレクトリにスコープされます。

MCP の設計は、ツールのスキーマ、アノテーション、`isError`、および既定の `dryRun` の振る舞いの定義元となります。

関連リンク:
- [MCP ツール](/ambercast/ja/reference/mcp-tools/)
- [構造化出力の読み取り](/ambercast/ja/agents/reading-structured-output/)
- [ステータスとロードマップ](/ambercast/ja/explanation/status-and-roadmap/)
