---
title: ambercast check
description: CLIにおけるアーティファクトの検査ステータスと検証結果の仕様を解説します。
---

`ambercast check` は、テストプロンプトに対応するプランやグラウンディングなどのアーティファクトを読み取り専用で検査し、そのステータスを報告するコマンドです。AIプロバイダ、ブラウザ操作、イベント送受信、およびストレージへの書き込みを行わずに、状態の検証を素早く実行します。

## フラグ {#flags}

| フラグ | 値 | 効果 | デフォルト |
| --- | --- | --- | --- |
| files | path[] | リテラルプロンプトの指定。省略時はディスカバリを実行 | discovery |
| --target | name | ターゲットの選択 | omitted |
| --allow-empty | boolean | 空の選択を許容 | false |
| --list | boolean | 検査を行わずに一覧表示 | false |
| --json | boolean | JSONエンベロープ形式で出力 | false |
| --config | path | 明示的な設定ファイルの指定 | omitted |
| --no-color | boolean | ANSIカラー出力を無効化 | false |

## ステータス語彙 {#status-vocabulary}

`check` はアーティファクトの検査結果として、次のステータスを報告します。

`fresh`、`stale`、`missing-plan`、`missing-grounding`、`invalid-grounding`、`stale-grounding`、`fresh-without-grounding`、`orphaned-plan`、`orphaned-grounding`、`invalid-artifact-name`、`listed`、`skipped`

これらの値の厳密な導出ロジックおよび合否判定の分類は、[鮮度とダイジェスト](/ambercast/ja/spec/freshness/#freshness-consequences) で定義されています。

## 検査結果 {#results}

完了した検出結果（findings）の出力には、`id`、`file`、`planFile`、`status`、`reason` の各フィールドが必須として含まれます。`groundingFile` および `artifactFile` は、判定の根拠として存在する場合にのみ出力されます。レポートフィールド全体の定義については、[レポート](/ambercast/ja/reference/reports/#check-results) を参照してください。

`check` の依存関係コントラクトからは、AI、ブラウザ、イベント、および書き込みストレージが完全に除外されています。

## 読み取り専用検査 {#read-only-contract}

`check` コマンドは、読み取り専用ストレージ、レイアウト、およびディスカバリの組み合わせで構成されています。

プロセスの終了コードおよびその集約優先順位は [終了コード](/ambercast/ja/reference/exit-codes/#aggregation-priority) で規定されています。信頼できないアーティファクトが検出された場合は終了コード `4` が、許容されていない空の選択が行われた場合は終了コード `5` が返されます。

関連リンク:
- [ファイルレイアウト](/ambercast/ja/reference/file-layout/#companions)
- [レポート](/ambercast/ja/reference/reports/#check-results)
- [終了コード](/ambercast/ja/reference/exit-codes/#exit-code-table)
- [設定](/ambercast/ja/reference/configuration/#file-selection)
