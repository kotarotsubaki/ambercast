---
title: ambercast review
description: 独立したAIによるレビュー結果および既知のフラグを定義する、計画中のambercast reviewコマンドのリファレンスです。
status: planned
sidebar:
  badge:
    text: Planned
    variant: caution
---

:::caution
`ambercast review` は 0.3.1 では実装されていません。本ドキュメントに記載されている内容は現行の実装の動作ではなく、v2 に向けて計画されている設計上の意図された動作です。
:::

`ambercast review` は、独立したAIによるレビュー結果および既知のフラグを定義するコマンドです。本コマンドは 0.3.1 では実装されておらず、v2 での提供が計画されています。

## ステータス {#status}

- `ambercast review` は 0.3.1 では実装されていません。パーサーは `generate`、`run`、`check`、`heal` のみを受け付け、それ以外のコマンドはすべて拒絶されます。本コマンドの役割は、v2 に向けたCLI設計で定義されています。

関連リンク: [CLIの概要](/ambercast/ja/reference/cli/overview/#command-surface)、[レポート](/ambercast/ja/reference/reports/#result-shapes)

## 計画されているインターフェース {#planned-interface}

| 構文 / 動作 | 計画されているコントラクト |
| --- | --- |
| `review [files...] [--target <name>] [--json]` | Planが意図を満たし、十分に検証を行っているかを、生成元とは分離されたコンテキストのAIに問い合わせます。 |
| `--target` | 計画されているターゲットの解決は、明示的なターゲット指定、設定された既定値、単一の固有ターゲットキー、次いで exit 2 の順に行われます。無効な明示的名前からフォールバックすることは決してありません。 |
| `--json` | argv のパース完了後のすべての終了時に、共通の構造化エンベロープを出力します。 |
| レビュー懸念 | 懸念（concern）は本コマンドの正当なレッド結果であり、exit 1 にマッピングされます。 |

- 本コマンドは v2 に割り当てられており、その名称は 2026-08-01 に正式に確定されました。
- 計画されている終了コードの集約には `2 > 3 > 4 > 1 > 5 > 0` が使用されます。

## 未決事項 {#undecided-items}

| 状態 | 項目 | 未決のままとなっている理由 |
| --- | --- | --- |
| ギャップ | `--allow-empty` および `--list` | コマンドの概要（synopsis）からは省略されている一方、コマンド・フラグ対応表では双方が review に割り当てられて動作が定義されています。 |
| 未規定 | レビュープロバイダーおよび詳細な結果コントラクト | 設計では、生成元とは分離されたコンテキストのAIが意図と検証の十分性を判定することのみが述べられています。 |
| 明示的に未決 | `review` には該当なし | このラベルが付与されているのは `baseline` と `restore` のみです。 |

関連リンク: [MCP ツール](/ambercast/ja/reference/mcp-tools/#planned-tool-contract)、[計画ドキュメント](/ambercast/ja/spec/plan-document/)
