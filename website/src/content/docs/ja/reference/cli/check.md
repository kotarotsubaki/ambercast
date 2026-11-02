---
title: ambercast check
description: 計画とグラウンディングの鮮度を調べる ambercast check のフラグ、ステータス、結果フィールド、読み取り専用の契約。
---

`ambercast check` はプロンプト、計画（plan）、グラウンディングのコンパニオンを調べ、それぞれが新しく正しいかを報告する。AI を呼ばず、ブラウザを起動せず、イベントを送らず、ディスクにも書かない。

## フラグ {#flags}

プロンプトのパスを直接渡すことも、[設定された探索](/ambercast/ja/reference/configuration/#file-selection)に選ばせることもできる。

| フラグ | 値 | 効果 | 既定値 |
| --- | --- | --- | --- |
| files | path[] | リテラルのプロンプト。未指定なら探索 | discovery |
| --allow-empty | boolean | 空の選択を許可する | false |
| --list | boolean | 検査せずに一覧を出す | false |
| --json | boolean | JSON エンベロープで出力する | false |
| --config | path | 設定ファイルを明示する | omitted |
| --no-color | boolean | ANSI の色を無効にする | false |

## ステータス一覧 {#status-vocabulary}

`check` は結果ごとに、次の 12 個のステータスのどれか 1 つを報告する。`listed` は `--list` のときだけ、`skipped` は中断の後だけに現れる。

- `fresh`
- `stale`
- `missing-plan`
- `missing-grounding`
- `invalid-grounding`
- `stale-grounding`
- `fresh-without-grounding`
- `orphaned-plan`
- `orphaned-grounding`
- `invalid-artifact-name`
- `listed`
- `skipped`

各ステータスの導出規則と合否は、[鮮度とダイジェスト](/ambercast/ja/spec/freshness/#freshness-consequences)が定める。

## 結果 {#results}

完了した検出結果は `id`・`file`・`planFile`・`status`・`reason` を持つ。`groundingFile` と `artifactFile` は、検出の根拠になるときだけ現れる。ステータスが `invalid-artifact-name` の検出結果だけは例外で、`planFile` を持たない。`id`・`file`・`status`・`reason` と `artifactFile` を持ち、すべて成果物自身を指す。フィールドの定義とレポートの構造は[レポート](/ambercast/ja/reference/reports/#check-results)にある。

## 読み取り専用の検査 {#read-only-contract}

`check` は読み取り専用である。依存には AI ランタイム、ブラウザドライバー、イベント送信、書き込みストレージを含まない。実行時には、読み取り専用のストレージ、ファイルレイアウトの規則（[ファイルレイアウト](/ambercast/ja/reference/file-layout/#companions)を参照する）、探索（[設定](/ambercast/ja/reference/configuration/#file-selection)を参照する）を組み合わせる。

終了コードの値と優先順位は[終了コード](/ambercast/ja/reference/exit-codes/#aggregation-priority)が定め、対応の全体は[終了コードの表](/ambercast/ja/reference/exit-codes/#exit-code-table)にある。

- 信頼できない成果物は、終了コード `4` に寄与する。
- 許可されていない空の選択は、終了コード `5` に寄与する。
