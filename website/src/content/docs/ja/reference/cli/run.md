---
title: ambercast run
description: ambercast run コマンドのフラグ、リプレイパス、明示的な AI 解決、グラウンディングの書き戻し、レポートの永続化を解説する。
---

`ambercast run` はテストプロンプトをターゲット環境に対して実行し、決定論的なリプレイと実行結果の書き込みを管理する。リプレイは既定で AI を呼び出さない。グラウンディングミスは `grounding-unresolved`（終了コード 4）としてフェイルクローズし、`--resolve` の利用を案内する。ミスをライブ AI で解決するには `--resolve` を渡す。

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

<a id="replay-paths"></a>

## リプレイ {#replay}

| 条件 | AIプロバイダー | 結果パス |
| --- | --- | --- |
| グラウンディングヒット | そのリプレイでは使用しない | 決定論的リプレイ |
| グラウンディングミス、`--resolve` なし | なし | `grounding-unresolved`（終了コード 4）としてフェイルクローズ |
| グラウンディングミス、`--resolve` あり | リゾルバー（`--ai` によるオーバーライド） | ライブ AI 解決および書き戻しの可能性 |

ランタイムは、設定の読み込みやファイル I/O を行う前に `--stale=regenerate` を拒否する。ブラウザ・環境変数に基づくシークレット・設定・`--resolve` が使用できるプロバイダー解決機構は、この拒否判定の後に構成される。シークレット値は、許可されたブラウザシンクでのみ `AMBERCAST_SECRET_<NAME>` から解決される。`run` は生成の同意を要求しない。

## AI呼び出し {#ai-calls}

プロバイダーの解決機構は run ユースケースに渡されるため、グラウンディング済みのリプレイは利用可能なプロバイダーが無くても進行する。キャッシュミスでその解決機構を使えるのは、`--resolve` を指定した場合だけである。

## 不足しているグラウンディングを解決する {#resolve}

`--resolve` は AI 解決パスを明示的に有効化する。指定しない場合、グラウンディングミスはプロバイダーをディスパッチせずにフェイルクローズする。

## グラウンディングの書き戻し {#grounding-write-back}

`run` は、解決された書き戻しゲートが許可した場合にのみ変更後のグラウンディングを書き込む。ローカル環境と CI 環境の全条件は [設定](/ambercast/ja/reference/configuration/#grounding) を参照する。

## レポートと終了コード {#report-and-exits}

`<runsDir>/<runId>/report.json` へのレポート永続化（`reportPersistence`）を試みるのは `run` だけである。書き込み完了後は `persisted`、部分的な内容が外部に見えない状態での書き込み失敗は `failed`、結果確定前の失敗を含め書き込みを試みなかった場合は `not-attempted` になる。

実行結果ステータスは `passed`・`failed`・`error`・`listed`・`skipped` のいずれかであり、プロセス終了コードの値と優先順位は [終了コード](/ambercast/ja/reference/exit-codes/#aggregation-priority) が定める。

関連リンク: [設定](/ambercast/ja/reference/configuration/#grounding)、[レポート](/ambercast/ja/reference/reports/#run-results)、[ファイルレイアウト](/ambercast/ja/reference/file-layout/#run-artifacts)、[終了コード](/ambercast/ja/reference/exit-codes/#aggregation-priority)
