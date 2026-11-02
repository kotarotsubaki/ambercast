---
title: ambercast init
description: 設定ファイル、サンプルプロンプト、リポジトリ向けの案内を作る ambercast init の書式、フラグ、書き込むファイル、確認、終了コード。
---

`ambercast init` は、プロジェクトで ambercast を使い始めるのに最低限必要なファイルを作る。書き込む前にすべての変更を計画し、カレントディレクトリ以外のディレクトリも対象にできる。

## 使い方 {#usage}

```text
ambercast init [--dir <path>] [--yes|-y] [--force] [--no-color] [--help]
```

## フラグ {#flags}

`init` は位置引数を取らない。

| フラグ | 値 | 効果 | 既定値 |
| --- | --- | --- | --- |
| --dir | path | 雛形を作るプロジェクトルート | cwd |
| --yes, -y | boolean | 確認のプロンプトを省く | false |
| --force | boolean | 既存の ambercast.config.json を置き換える | false |
| --no-color | boolean | ANSI の色を無効にする | false |

## 書き込むファイル {#what-it-writes}

コマンドは、プロジェクトルートからの相対パスで 4 つの成果物を計画する。

| 成果物 | 無いとき | すでにあるとき |
| --- | --- | --- |
| `ambercast.config.json` | 作成する | 雛形と同一であればスキップする。違えば、`--force` で置き換えない限り拒否する |
| `tests/ambercast/find-page.test.md` | 作成する | 中身を調べず、置き換えもせずにスキップする |
| `.gitignore` | 下の 2 行の単位を付けて作成する | すでに `tests/ambercast/.runs/` を含めばスキップする。含まなければ、その単位を末尾に追加する |
| `AGENTS.md` | 作成する | ambercast のマーカーブロックが一致すればスキップする。有効なマーカーの組が 1 つあって内容が違えば置き換え、マーカーが無ければ追記し、マーカーが壊れていれば拒否する |

`.gitignore` の単位は、コメント `# ambercast run evidence` と、それに続く `tests/ambercast/.runs/` の行である。

## 確認と非対話での利用 {#confirmation}

init は、変更計画の全体を必ず標準エラーに出力する。対話的な端末では、続けて `Write these files? [y/N] ` と尋ね、`--yes` はこの確認を省く。

CI などの非 TTY 環境では、`--yes` を渡さない限り init は呼び出しを拒否する。コーディングエージェントがコマンドを実行する場合も、`--yes` が省くのは CLI の確認だけである。4 つのファイル変更に対する人間の承認は、`--yes` では代替できない。[オペレーション規約](/ambercast/ja/agents/operating-contract/#command-contract)を参照する。

## 終了コード {#exit-codes}

- `0`: 雛形の作成に成功した、すべての成果物をスキップした、または確認を断った。
- `2`: 事前検査での拒否。引数の誤り、`--yes` なしの非対話実行、設定の衝突、`AGENTS.md` のマーカーの破損などが含まれる。
- `3`: I/O の失敗、中断、または変更計画の適用中の失敗。

プロセス状態の共通の一覧は[終了コードの表](/ambercast/ja/reference/exit-codes/#exit-code-table)にある。

## 再実行 {#re-running}

成功した後に同じコマンドを再実行しても結果は変わらない。4 つの成果物はすべて `skipped` と報告され、ambercast は `Nothing to do.` を出力する。バイト列も変わらない。

## 関連項目 {#see-also}

- [CLI の概要](/ambercast/ja/reference/cli/overview/#command-surface)
- [5分で動かす最初のテスト](/ambercast/ja/tutorials/quick-start/)
- [設定](/ambercast/ja/reference/configuration/#file-selection)
- [オペレーション規約](/ambercast/ja/agents/operating-contract/#command-contract)
