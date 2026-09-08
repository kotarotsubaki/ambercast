---
title: MCP ツール
description: 計画されている MCP ツールの規約とツール一覧のリファレンス。
status: planned
sidebar:
  badge:
    text: Planned
    variant: caution
---

:::caution
MCP ツールは 0.3.1 では実装されていません。本ドキュメントでは、計画されている設計上の仕様について説明します。
:::

本書では、ambercast における計画中の MCP（Model Context Protocol）ツール規約を定義します。MCP ツールは 0.3.1 では未実装であり、将来の v2 ツールセットとして設計されています。

## 実装状況 {#status}

MCP ツールは 0.3.1 では実装されていません。CLI パーサーが受け付けるコマンドは `generate`、`run`、`check`、`heal` のみであり、`mcp` サーバーコマンドは提供されていません。計画されている v2 ツールセットは、MCP 設計において定義されています。

関連リンク: [ambercast mcp](/ambercast/ja/reference/cli/mcp/#status)、[MCP サーバー](/ambercast/ja/agents/mcp-server/)。

## 計画中のツール規約 {#planned-tool-contract}

ツール規約の設計方針は以下のとおりです。

- ツール名には `ambercast_` プレフィックスとスネークケース（snake_case）を使用します。すべての CLI コマンドを機械的に複製するのではなく、ワークフロー操作の厳選されたセットを公開します。
- `structuredContent` には CLI の `--json` と同じ構造化レポートスキーマが使用され、そのまま変更されずに `outputSchema` として公開されます。
- スクリーンショットはファイルパスまたは `resource_link` として返され、インラインの base64 として返されることは決してありません。
- 観測サブツリーの分離に関する注記は、ランタイムペイロードと JSON Schema の記述（description）の両方に記載されます。

## ツール一覧 {#tool-table}

| ツール | 対応する CLI コマンド | アノテーション（`readOnly`, `destructive`, `idempotent`, `openWorld`） | `isError: true` の条件 | `isError: false` となる正当な否定結果 |
| --- | --- | --- | --- | --- |
| `ambercast_generate` | `generate --json` | `false`, `false`, `true`（弱）, `false` | 終了コード 2 または 3。 | 厳格モードでの曖昧性による終了コード 1。 |
| `ambercast_run` | `run --json` | `false`, `false`, `false`, `true` | 終了コード 2 または 3、および信頼できない Plan の拒否による終了コード 4。 | アサーション失敗による終了コード 1。 |
| `ambercast_check` | `check --json` | `true`, `false`, `true`, `false` | 終了コード 2 または 3。 | stale（古くなった状態）の検出による終了コード 4（`results[].status` に反映）。 |
| `ambercast_heal` | `heal --json` | `false`, `true`, `false`, `true` | CI での拒否を含む終了コード 2 または 3、および修復前の信頼できない Plan の拒否。 | 修復が開始されたものの解決しなかった終了コード 1。 |
| `ambercast_review` | `review --json` | `true`, `false`, `false`, `true` | 終了コード 2 または 3。 | レビューでの懸念検出による終了コード 1。 |

- 4 つの MCP アノテーションはすべて明示する必要があります。destructive および open-world ヒントの MCP 既定値は、省略したままにしておくのは安全ではないためです。
- 一般的な `isError` ポリシーとして、終了コード 2 および 3 では `true` に設定されます。終了コード 4 の扱いはワークフローによって異なりますが、テスト失敗（赤）を示す終了コード 1 および一致件数ゼロを示す終了コード 5 は `false` のまま維持されます。
- `ambercast_generate` の idempotent ヒントは弱い（weak）ものです。新しい Plan の再作成はスキップされ効果は収束しますが、AI による出力自体が変動する可能性があります。

## heal の安全策の既定値 {#heal-safety-default}

| チャネル | `dryRun` の既定値 | 理由 |
| --- | --- | --- |
| MCP `ambercast_heal` | `true` | エージェント呼び出しではプレビューが既定となります。heal は破壊的な MCP ワークフローであるためです。 |
| CLI `ambercast heal` | `false` | MCP の既定値は、ローカル CLI での利用と意図的に非対称になっています。 |

この設計では、対応可能なクライアントに対して `requiresUserInteraction` 相当のヒントを推奨していますが、それを必須の標準アノテーションとはしていません。

## 未決定事項 {#undecided-items}

| 状態 | 項目 |
| --- | --- |
| 明示的に未定 | MCP ツールの設計上、未決定事項はありません。上記の 5 つのツールが、明示された v2 セットとなります。 |
| 未指定 | MCP heal の `dryRun` 既定値を除き、ツールごとの正確な入力プロパティスキーマは未確認です。 |
| 未指定 | DB リセットの設計では baseline と restore が将来の 2 つの MCP ツールに対応するとされていますが、ツール名、アノテーション、`isError` ルール、入出力スキーマは提供されておらず未確認です。 |

関連リンク: [レポート](/ambercast/ja/reference/reports/#envelope)、[ambercast review](/ambercast/ja/reference/cli/review/#planned-interface)、[ambercast baseline と ambercast restore](/ambercast/ja/reference/cli/baseline-restore/#planned-boundary)。
