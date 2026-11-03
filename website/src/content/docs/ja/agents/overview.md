---
title: AIエージェントからのambercastの利用
description: エージェントはテストアセットを変える前に4ページをこの順で読み、実装・プロンプトの記述・実行・レポートからの修正というループで進める。
---

このページで、エージェントは何を読んでから作業を始めるか、どの順で動くかを決める。読み順、副作用、行動の分岐はエージェント向けページが扱い、正確な仕様はリファレンスが、手順はHow-toが扱う。

## 動く前に読むページ {#read-before-acting}

CLIには`init`、`generate`、`run`、`check`、`heal`、`view`、`mcp`の7つのコマンドがある。テストアセットを変える前に、次の4ページを上から順に読む。

| 読むページ | 得られるもの |
| --- | --- |
| [5分で動かす最初のテスト](/ambercast/ja/tutorials/quick-start/) | 成果物のループと前提条件 |
| [オペレーション規約](/ambercast/ja/agents/operating-contract/) | 副作用と承認の境界 |
| [CLIの概要](/ambercast/ja/reference/cli/overview/) | 各コマンドの正確な仕様 |
| [レポート](/ambercast/ja/reference/reports/) | コマンド実行後のJSONレポートの読み方 |

関連リンク: [セットアッププロンプト](/ambercast/ja/agents/setup-prompt/)、[構造化出力の読み取り](/ambercast/ja/agents/reading-structured-output/)、[機械可読リソース](/ambercast/ja/agents/machine-readable-resources/)

## 範囲を決めたループで進める {#bounded-loop}

基本のループは、実装、依頼された`.test.md`の記述または調整、実行、レポートからの修正の順である。承認の境界は個々の結果から推測せず、オペレーション規約に従う。

1. 承認された範囲で、依頼された製品の変更を実装する。
2. 依頼された`.test.md`を書くか調整し、検証したい振る舞いをプロンプトに表す。
3. その`.test.md`を実行し、JSONレポートを読む。
4. レポートに従って直し、必要ならもう一度実行する。

`run`には信頼できる計画（plan）が要るため、計画がなければ先に`generate`を実行する。`generate`は計画とグラウンディングのファイルをプロンプトの隣に書く。

グラウンディングがそろっていれば、再生はAIを呼ばず、使えるプロバイダーも要らない。グラウンディングが見つからないときは、`--resolve`を付けない限り終了コード4で失敗する。

関連リンク: [オペレーション規約](/ambercast/ja/agents/operating-contract/)、[レポート](/ambercast/ja/reference/reports/)
