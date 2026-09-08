---
title: AIエージェントからのambercastの利用
description: AIエージェントがテストアセットを変更・操作する際の読む順序と安全な実行ループを定めます。
---

AIエージェントがテストアセットを変更するにあたり、事前に把握すべき運用上の読む順序と安全な実行ループを定めます。

## 操作の前に読むべきドキュメント {#read-before-acting}

AIエージェント向けのドキュメントでは、読む順序、副作用、およびアクションの分岐を定めています。正確な仕様はリファレンスが、手順はHow-toが扱います。利用可能なCLIコマンドは `generate`、`run`、`check`、`heal` です。

| 参照ドキュメント | 理由 |
| --- | --- |
| [5分で動かす最初のテスト](/ambercast/ja/tutorials/quick-start/) | 成果物ループと前提条件を確立するため。 |
| [オペレーション規約](/ambercast/ja/agents/operating-contract/) | 副作用と承認境界を確立するため。 |
| [CLIの概要](/ambercast/ja/reference/cli/overview/) | 正確なコマンドコントラクトを選択するため。 |
| [レポート](/ambercast/ja/reference/reports/) | コマンド実行後の構造化出力を解釈するため。 |

## 境界づけられたループでの実行 {#bounded-loop}

必須となる基本的なエージェントループは、実装 → 要求された `.test.md` の記述または調整 → 実行 → レポートからの修正、です。

生成（`generate`）は、正規化されたプロンプトテキストと選択されたターゲットから出所（provenance）を導出し、プランとそれに隣接する grounding パスを構築します。完全な grounding が行われた実行は、AIプロバイダーを解決することなく進めることができます。

1. 承認されたスコープ内で要求された製品変更を実装します。→ 実装が要求されたテスト意図に対して準備できた状態になります。
2. 要求された `.test.md` を記述または調整します。→ プロンプトによって検証する振る舞いを表現します。
3. 選択した `.test.md` を実行し、その構造化された結果を読み取ります。→ 次のアクションを選択する前に、エンベロープを解釈するために [レポート](/ambercast/ja/reference/reports/) を使用します。
4. レポートから修正を行い、必要に応じて選択したループを繰り返します。→ 承認境界と安全なアクション分岐は [オペレーション規約](/ambercast/ja/agents/operating-contract/) が定めています。実行結果のみからこれらを推測して判断しないでください。

関連リンク: [セットアッププロンプト](/ambercast/ja/agents/setup-prompt/), [オペレーション規約](/ambercast/ja/agents/operating-contract/), [構造化出力の読み取り](/ambercast/ja/agents/reading-structured-output/), [機械可読リソース](/ambercast/ja/agents/machine-readable-resources/), [レポート](/ambercast/ja/reference/reports/)
