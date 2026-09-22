---
title: ambercast init
description: ambercast init が設定ファイル、サンプルプロンプト、およびリポジトリ向けのガイダンスを作成するためのコマンドラインリファレンスです。
---

## 使い方 {#usage}

```bash
ambercast init [--dir <path>] [--yes|-y] [--force] [--no-color] [--help]
```

`ambercast init` は、プロジェクトで ambercast を使い始めるために必要な最小限のファイルを作成します。書き込みの前に変更計画を表示し、カレントワーキングディレクトリ以外のディレクトリも対象にできます。

## フラグ {#flags}

| フラグ | 値 | 効果 | デフォルト |
| --- | --- | --- | --- |
| `--dir` | `<path>` | スキャフォールディング先のプロジェクトルート | cwd |
| `--yes, -y` | boolean | 確認プロンプトを省略 | false |
| `--force` | boolean | 既存の ambercast.config.json を置き換え | false |
| `--no-color` | boolean | ANSI を無効化 | false |

## 書き込む内容 {#what-it-writes}

このコマンドは、プロジェクトルートからの相対パスで次の4つの成果物を計画します。

| 成果物 | 不在の場合 | 既に存在する場合 |
| --- | --- | --- |
| `ambercast.config.json` | 作成 | スキャフォールドと完全一致すればスキップ。それ以外は `--force` による置換がなければ拒否 |
| `tests/ambercast/find-page.test.md` | 作成 | 内容を調べたり置き換えたりせずスキップ |
| `.gitignore` | 作成 | `tests/ambercast/.runs/` が既にあればスキップ。それ以外はその行を追記 |
| `AGENTS.md` | 作成 | ambercast のマーカーブロックが一致すればスキップ。正しいマーカー対で内容が異なれば置換、マーカーがなければ追記、不正なマーカーは拒否 |

## 確認と非対話的な利用 {#confirmation}

完全な計画は常に stderr に表示されます。対話的な端末では、その後に ambercast が `Write these files? [y/N] ` と確認します。`--yes` を指定するとこのプロンプトを省略できます。

CI または非 TTY の環境では、`--yes` を指定しない init は拒否されます。コーディングエージェントが実行する場合、`--yes` が省略するのは CLI の確認だけであり、4つのファイル変更に必要な人間の承認を代替するものではありません。[オペレーション規約](/ambercast/ja/agents/operating-contract/#command-contract)を参照してください。

## 終了コード {#exit-codes}

- `0`: スキャフォールディングの成功、すべてスキップされた no-op、または確認の辞退。
- `2`: 不正な引数、`--yes` なしの非対話利用、設定の競合、不正な `AGENTS.md` マーカーなど、事前検査での拒否。
- `3`: I/O 失敗、中断、または計画の適用中の失敗。

共通のプロセスステータスについては、[終了コード](/ambercast/ja/reference/exit-codes/#exit-code-table)を参照してください。

## 再実行 {#re-running}

成功後に同じコマンドを再実行しても冪等です。4つの成果物はすべて `skipped` と表示され、ambercast は `Nothing to do.` を出力し、ファイルのバイト列は変わりません。

## 関連リンク {#related}

- [CLI の概要](/ambercast/ja/reference/cli/overview/#command-surface)
- [5分で動かす最初のテスト](/ambercast/ja/tutorials/quick-start/)
- [設定](/ambercast/ja/reference/configuration/#file-selection)
- [オペレーション規約](/ambercast/ja/agents/operating-contract/#command-contract)
