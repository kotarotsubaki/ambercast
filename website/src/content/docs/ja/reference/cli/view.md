---
title: ambercast view
description: テスト結果ビューアの起動、ポート選択、および非対話型環境における実行制御の計画仕様を定義します。
status: planned
sidebar:
  badge:
    text: Planned
    variant: caution
---

:::caution
`ambercast view` は 0.3.1 では実装されていません。本ページに記載されている内容は、計画されている設計上の動作です。
:::

`ambercast view` は、ローカルでテスト結果を確認するためのビューアの起動、ポート選択、および非対話型環境での実行制御を行うコマンドです。

## ステータス {#status}

`ambercast view` は 0.3.1 では実装されていません。現在のコマンドパーサーは `generate`、`run`、`check`、`heal` のみを受け付け、それ以外のコマンドは拒絶します。本コマンドが担うローカルビューアとしての役割は、計画されているビューア設計で定義されています。

関連情報:
- [CLIの概要](/ambercast/ja/reference/cli/overview/#command-surface)
- [レポート](/ambercast/ja/reference/reports/#envelope)

## 計画されているインターフェース {#planned-interface}

| 構文 / 動作 | 計画されている仕様 |
| --- | --- |
| `view [--port <n>] [--host <addr>] [--allow-headless]` | ローカル結果ビューアを起動します。 |
| 既定のポート | 設定または既定のポートから開始し、空きポートが見つかるまでインクリメントして、実際のURLを出力します。 |
| `--port` / 設定 | 固定ポートの指定を許可し、CI環境や固定ブックマークに対応します。 |
| 非対話型環境での既定動作 | CI環境または非対話型ターミナルでは、終了コード 2 で実行を拒絶します。 |
| `--allow-headless` | 非対話型環境での実行拒絶を明示的に解除します。 |
| 設計共通フラグ | `--config <path>`、`--no-color`、`--version`、および `--help` はすべての計画コマンドに共通と宣言されています。マトリクス上、`view` に `--json` は割り当てられていません。 |

本ビューアは、テスト結果とスクリーンショットを確認するための、Storybookのようなローカルサーバーとして計画されています。

レンダリングされる構造は保存されたJSONとスクリーンショットによって決定され、AIの役割はテストの要約や失敗原因の説明といった自然言語コンテンツの生成に限定されます。

ブラウザの起動失敗は、計画されている共通終了コード規約に基づき、環境要因による終了コード 3 に分類されます。

`view` は、Ambercastで計画されている機能の中でネットワークポートを消費する唯一の機能です（計画されているMCPサーバーはポートを使用しないstdio通信です）。

## 未決定の項目 {#undecided-items}

| 状態 | 項目 |
| --- | --- |
| 未規定 | `--host` の指定は挙げられていますが、バインディング、アドレス、外部公開に関するセマンティクスは定義されておらず、未確定です。 |
| 未規定 | 既定のポート番号、インクリメントの上限、サーバーのライフサイクル、ルーティング、およびUIはビューア設計で固定されておらず、未確定です。 |
| 明示的に未決 | `view` に関して明示的に未決とされている項目はありません（設計上、「未決」とラベル付けされているのは `baseline` と `restore` のみです）。 |

関連情報:
- [設定](/ambercast/ja/reference/configuration/#key-table)
- [レポート](/ambercast/ja/reference/reports/#result-shapes)
- [ambercast mcp](/ambercast/ja/reference/cli/mcp/#planned-interface)
