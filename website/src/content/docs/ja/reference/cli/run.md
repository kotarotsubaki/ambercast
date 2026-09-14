---
title: ambercast run
description: ambercast run コマンドのフラグ仕様、リプレイパス、明示的な AI 解決、および実行時の書き込み動作について説明します。
---

`ambercast run` は、リプレイパスの実行と実行結果の書き込みを制御するコマンドです。既定では AI を呼び出さず、グラウンディングミスは `grounding-unresolved`（終了コード 4）としてフェイルクローズし、`--resolve` を使うよう案内します。ミスをライブ AI で解決するには `--resolve` を明示的に指定します。

## フラグ {#flags}

| フラグ | 値 | 効果 | 既定値 |
| --- | --- | --- | --- |
| files | path[] | リテラルプロンプト。未指定時は検出（discovery）を選択 | discovery |
| --grep | pattern | 正規表現によるパスフィルター | omitted |
| --target | name | ターゲットを選択 | omitted |
| --headed | boolean | ブラウザ画面を表示（headed） | false |
| --resolve | boolean | グラウンディングミス時のライブ AI 解決を明示的に有効化 | false |
| --update-cache | boolean | キャッシュの書き込みを要求 | false |
| --stale | fail\|regenerate | stale（古くなった状態）ポリシーのパーサー値 | fail |
| --ai | claude\|codex | 解決プロバイダーのオーバーライド | omitted |
| --allow-empty | boolean | 空の選択を許可 | false |
| --list | boolean | リプレイを実行せずに一覧表示 | false |
| --json | boolean | JSONエンベロープ形式で出力 | false |
| --no-color | boolean | ANSIエスケープシーケンスを無効化 | false |

## リプレイ {#replay}

| 条件 | AIプロバイダー | 結果パス |
| --- | --- | --- |
| グラウンディングヒット | そのリプレイでは使用しない | 決定論的リプレイ |
| グラウンディングミス、`--resolve` なし | なし | `grounding-unresolved`（終了コード 4）としてフェイルクローズ |
| グラウンディングミス、`--resolve` あり | リゾルバー（`--ai` によるオーバーライド） | ライブ AI 解決および書き戻しの可能性 |

- ランタイムは、設定の読み込みやファイルI/Oを行う前に `--stale=regenerate` を拒否します。
- ランタイムは、ブラウザ、シークレット、設定、および `--resolve` が使用できるプロバイダーの解決機構を構成します。

## AI呼び出し {#ai-calls}

プロバイダーの解決機構が run ユースケースに渡されるため、グラウンディング済みのリプレイは利用可能なプロバイダーが存在しない状態でも進行できます。キャッシュミスでそれを使用できるのは、`--resolve` を指定した場合だけです。

## 不足しているグラウンディングを解決する {#resolve}

`--resolve` は AI 解決パスを明示的に有効化します。指定しない場合、グラウンディングミスはプロバイダーをディスパッチせずにフェイルクローズします。

## グラウンディングの書き戻し {#grounding-write-back}

`run` は、解決された書き戻しゲートによって許可された場合にのみ、変更されたグラウンディングを書き込みます。ローカル環境およびCI環境の全条件については [設定](/ambercast/ja/reference/configuration/#grounding) を参照してください。

## レポートと終了コード {#report-and-exits}

`<runsDir>/<runId>/report.json` へのレポート永続化（`reportPersistence`）を試行するのは `run` のみです。書き込み完了時は `persisted`、不完全な内容が外部に見えない状態での書き込み失敗時は `failed`、結果確定前の失敗を含む書き込みが試行されなかった場合は `not-attempted` が適用されます。

実行結果ステータスには `passed`、`failed`、`error`、`listed`、`skipped` があります。プロセス終了コードの値およびその優先順位は [終了コード](/ambercast/ja/reference/exit-codes/#aggregation-priority) が定義しています。

関連リンク: [設定](/ambercast/ja/reference/configuration/#grounding)、[レポート](/ambercast/ja/reference/reports/#run-results)、[ファイルレイアウト](/ambercast/ja/reference/file-layout/#run-artifacts)、[終了コード](/ambercast/ja/reference/exit-codes/#aggregation-priority)。
