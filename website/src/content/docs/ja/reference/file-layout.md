---
title: ファイルレイアウト
description: コンパニオンファイルと実行成果物について、Ambercast が導出するパス、書き込み元、書き込みタイミングを定義する。
---

Ambercast は、コンパニオンファイルと実行成果物のパスをすべてテストディレクトリと実行ディレクトリから解決する。本ページは、導出される各パスと、その書き込み元・タイミング、実装が持つコミットポリシーを示す。

## コンパニオン {#companions}

| 入力パス | 導出パス | 規則 |
| --- | --- | --- |
| `<testDir>/<dirs>/<name>.test.md` | `<testDir>/<dirs>/<name>.ambercast.plan.json` | 末尾の `.test.md` だけを置換する。`<name>` に含まれる他のドットは保持する。 |
| `<testDir>/<dirs>/<name>.test.md` | `<testDir>/<dirs>/<name>.ambercast.grounding.json` | 隣接する末尾サフィックスに同じ変換を適用する。 |

順方向のマッピングは、`testDir` 内にあり、末尾が厳密に `.test.md` で、名前が空でないパスだけを受け入れる。無効な呼び出し元の入力は `RangeError` を送出する。

逆方向のマッピングが認識するのは、ツリー内で厳密に一致する計画（plan）かグラウンディングのサフィックスだけである。それ以外には `undefined` を返す。

## 実行成果物 {#run-artifacts}

| 成果物 | 正確なパス | 書き込み元 / タイミング | 実装に基づくコミットポリシー |
| --- | --- | --- | --- |
| プロンプト | `<testDir>/<dirs>/<name>.test.md` | ユーザーが書く入力。Ambercast は読み取る。 | リポジトリに関する判断はコード化されていない。手順は[Git での成果物の管理](/ambercast/ja/how-to/manage-artifacts-in-git/)にある。 |
| 計画コンパニオン | `<testDir>/<dirs>/<name>.ambercast.plan.json` | `generate` が新規に生成した計画を書く。`heal` は承認された確定（settlement）の後にだけ置き換えられる。 | ランタイムはコミット済みの入力として扱う。リポジトリ操作は行わない。 |
| グラウンディングコンパニオン | `<testDir>/<dirs>/<name>.ambercast.grounding.json` | `generate` が作成または修復する。`run` は書き戻しポリシーに従い、変更されたグラウンディングを書くことがある。`heal` は確定後に置き換えられる。 | `grounding.repositoryPolicy` の既定値は `committed` で、`uncommitted` にもできる。Ambercast 自体はリポジトリ操作を行わない。 |
| 呼び出しディレクトリ | `<runsDir>/<runId>/` | `run` と `heal` は、ケースのエビデンスに単一の呼び出し識別子を使う。run ID はタイムスタンプと UUID からなる安全なセグメントである。 | ランタイムはこのディレクトリにリポジトリポリシーを持たない。`ambercast init` は既定の `runsDir` に対して `tests/ambercast/.runs/` を `.gitignore` に追記する。手順は[Git での成果物の管理](/ambercast/ja/how-to/manage-artifacts-in-git/)にある。 |
| ケースディレクトリ | `<runsDir>/<runId>/<test-relative-dir>/<name>/` | `run` が、ケースのエビデンス収集にこのディレクトリを渡す。 | 呼び出しディレクトリと同じ。 |
| 実行スクリーンショット | `<runsDir>/<runId>/<test-relative-dir>/<name>/<stepId>.png` | `run` が、対象となる失敗したライブブラウザのステップに書く。シークレット検出により省略されることがある。 | 呼び出しディレクトリと同じ。 |
| ヒール試行ディレクトリ | `<runsDir>/<runId>/<test-relative-dir>/<name>/attempt-<n>/` | `heal` が試行ごとに正の序数を割り当てる。その試行のエビデンスとオーバーレイは、このディレクトリ配下に閉じ込める。 | 呼び出しディレクトリと同じ。 |
| ヒールスクリーンショット | `<runsDir>/<runId>/<test-relative-dir>/<name>/attempt-<n>/<stepId>.png` | 共有キャプチャパスが、対象となる失敗ステップのエビデンスを、試行単位のケースディレクトリに書く。 | 呼び出しディレクトリと同じ。 |
| 実行レポート | `<runsDir>/<runId>/report.json` | `run` が実行後に確定したバッチエンベロープを書く。[`ambercast view`](/ambercast/ja/reference/cli/view/)がこれを読む。アトミック書き込みに失敗すると `reportPersistence` が変わる。 | 呼び出しディレクトリと同じ。 |

スクリーンショットはベストエフォートである。キャプチャや保存に失敗した場合も省略される。

`runsDir` は独立して設定され、既定値は `tests/ambercast/.runs` である。レイアウト解決処理は `testDir` から導出しない。

`runId` は `^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$` に一致する必要がある。このパターンにより、区切り文字、ドットセグメント、空の ID を排除する。

`report.json` は `run` が書く。他のレポート系コマンドは、書き込みを行わずにエンベロープを返す。

## 関連項目 {#see-also}

- [設定](/ambercast/ja/reference/configuration/#key-table)
- [レポート](/ambercast/ja/reference/reports/#persistence)
- [プロンプトファイルのフォーマット](/ambercast/ja/reference/prompt-format/#file-identity)
- [Git での成果物の管理](/ambercast/ja/how-to/manage-artifacts-in-git/)
- [計画のライフサイクルと鮮度](/ambercast/ja/explanation/plan-lifecycle/)
