---
title: ファイルレイアウト
description: パス計算、成果物の生成タイミング、および実装に基づくリポジトリポリシーを定義します。
---

Ambercastにおけるパス計算、成果物の生成タイミング、および実装に基づくリポジトリポリシーを定義します。テストディレクトリ内のテストファイルから導出されるコンパニオンファイルや、実行時に生成される成果物の配置規則を規定します。

## コンパニオン {#companions}

| 入力パス | 導出パス | 規則 |
| --- | --- | --- |
| `<testDir>/<dirs>/<name>.test.md` | `<testDir>/<dirs>/<name>.ambercast.plan.json` | 末尾の `.test.md` のみを置換し、`<name>` に含まれる他のドットは保持します。 |
| `<testDir>/<dirs>/<name>.test.md` | `<testDir>/<dirs>/<name>.ambercast.grounding.json` | 同様に隣接する末尾サフィックスの変換を適用します。 |

順方向のマッピングは、`testDir` 内に存在し、末尾が厳密に `.test.md` で終わり、かつ空でない名前を持つパスのみを受け入れます。無効な呼び出し元の入力に対しては `RangeError` を送出します。

逆方向のマッピングは、ツリー内の厳密なプランまたはグラウンディングのサフィックスのみを認識し、それ以外の場合は `undefined` を返します。

## 実行アーティファクト {#run-artifacts}

| アーティファクト | 正確なパス | 書き込み元 / タイミング | 実装に基づくコミットポリシー |
| --- | --- | --- | --- |
| プロンプト | `<testDir>/<dirs>/<name>.test.md` | ユーザーが作成する入力です。Ambercastがこれを読み取ります。 | Gitに関する判断はコード化されていません。Gitの手順は how-to/manage-artifacts-in-git が管轄します。 |
| プランコンパニオン | `<testDir>/<dirs>/<name>.ambercast.plan.json` | `generate` が新規生成されたプランを書き込みます。`heal` は承認された確定（settlement）の後にのみこれを置き換えることができます。 | ランタイムはこれをコミット済みの入力として扱いますが、Git操作は一切行いません。 |
| グラウンディングコンパニオン | `<testDir>/<dirs>/<name>.ambercast.grounding.json` | `generate` が作成または修復します。`run` はライトバックポリシーに基づいて変更されたグラウンディングを書き込む場合があります。`heal` は確定後にこれを置き換えることができます。 | `grounding.repositoryPolicy` の既定値は `committed` であり、`uncommitted` に設定することも可能です。Ambercast自体はGit操作を一切行いません。 |
| 呼び出しディレクトリ | `<runsDir>/<runId>/` | `run` および `heal` が、ケースのエビデンス用に単一の呼び出し識別子を使用します。run IDはタイムスタンプとUUIDからなる安全なセグメントです。 | このディレクトリに対するリポジトリポリシーは存在しません。Gitの手順は how-to/manage-artifacts-in-git が管轄します。 |
| ケースディレクトリ | `<runsDir>/<runId>/<test-relative-dir>/<name>/` | `run` がケースのエビデンス収集用にこのディレクトリを提供します。 | 呼び出しディレクトリと同様です。 |
| 実行時スクリーンショット | `<runsDir>/<runId>/<test-relative-dir>/<name>/<stepId>.png` | `run` が、対象となる失敗したライブブラウザステップに対して書き込みます。シークレット検出により省略される場合があります。 | 呼び出しディレクトリと同様です。 |
| ヒール試行ディレクトリ | `<runsDir>/<runId>/<test-relative-dir>/<name>/attempt-<n>/` | `heal` が試行ごとに正の序数を割り当て、その試行のエビデンスおよびオーバーレイをその配下に隔離して格納します。 | 呼び出しディレクトリと同様です。 |
| ヒールスクリーンショット | `<runsDir>/<runId>/<test-relative-dir>/<name>/attempt-<n>/<stepId>.png` | 共有キャプチャパスが、対象となる失敗したステップのエビデンスを試行スコープのケースディレクトリ内に書き込みます。 | 呼び出しディレクトリと同様です。 |
| 実行レポート | `<runsDir>/<runId>/report.json` | 実行完了後に `run` のみが確定したバッチエンベロープを書き込みます。アトミック書き込みに失敗すると `reportPersistence` が変化します。 | 呼び出しディレクトリと同様です。 |

`runsDir` は独立して設定され、既定値は `tests/ambercast/.runs` です。レイアウト解決処理によって `testDir` から導出されることはありません。

`runId` は `^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$` に一致する必要があり、区切り文字、ドットセグメント、および空のIDを排除します。

`report.json` を永続化するのは `run` のみです。`generate`、`check`、および `heal` は、このレイアウト書き込みを行わずにエンベロープを返します。

## 関連情報

- [設定](/ambercast/ja/reference/configuration/#key-table)
- [レポート](/ambercast/ja/reference/reports/#persistence)
- [プロンプトファイルのフォーマット](/ambercast/ja/reference/prompt-format/#file-identity)
- [Gitでの成果物の管理](/ambercast/ja/how-to/manage-artifacts-in-git/)
- [プランのライフサイクルと鮮度](/ambercast/ja/explanation/plan-lifecycle/)
