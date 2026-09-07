---
title: ambercast mcp
description: ambercast の v2 MCP サーバーの起動およびトランスポート仕様に関するリファレンス。
status: planned
sidebar:
  badge:
    text: Planned
    variant: caution
---

:::caution
`ambercast mcp` は計画段階の機能であり、バージョン 0.3.1 には実装されていません。本ドキュメントに記載されている内容は現在の動作ではなく、将来意図されている設計仕様です。
:::

`ambercast mcp` は、ambercast の v2 MCP サーバーの起動およびトランスポートの規律を規定するコマンドです。

## ステータス {#status}

`ambercast mcp` はバージョン 0.3.1 では実装されていません。パーサーが受け付けるコマンドは `generate`、`run`、`check`、`heal` のみであり、それ以外のコマンドは拒否されます。計画されている v2 サーバーインターフェースは、MCP 設計によって定義されています。

関連リンク: [CLIの概要](/ambercast/ja/reference/cli/overview/#command-surface)、[MCP サーバー](/ambercast/ja/agents/mcp-server/)。

## 計画されているインターフェース {#planned-interface}

| 項目 | 計画仕様 |
| --- | --- |
| 起動 | `ambercast mcp` はメインパッケージから v2 MCP サーバーを起動します。 |
| トランスポート | `stdio` を使用します。サーバーはポートを持ちません。 |
| `stdout` | JSON-RPC のみを書き込みます。CI はこの不変条件を検証しなければなりません。 |
| `stderr` | 進捗およびログはここに書き込み、JSON-RPC ストリーム経由では決して出力しません。 |
| ツールの境界 | `init` や `view` を MCP ツールとして公開しません。 |
| サーバー指示文 | 冒頭で、本サーバーがキーストローク E2E の実行および修復のためのものであることを明記します。 |
| 検出テキストの容量制限 | クライアントが説明文や指示文をそれぞれ 2 KB で切り詰める可能性があるため、重要な内容を先頭に配置します。 |

設計上、`ambercast mcp` に対する CLI フラグや入力オプションのスキーマは指定されていません。

## 未決定事項 {#undecided-items}

| 状態 | 項目 |
| --- | --- |
| 明示的に未決定 | なし。パッケージコマンド、stdio トランスポート、ポートを持たない配信形式は確定事項として記録されています。 |
| 未指定 | 正確なサーバーフラグ、起動エラー、ライフサイクル、およびクライアント設定は、これらの参照資料では定義されておらず、未確認です。 |

関連リンク: [MCP ツール](/ambercast/ja/reference/mcp-tools/#planned-tool-contract)、[MCP ツール](/ambercast/ja/reference/mcp-tools/#tool-table)。
