---
title: ambercast review
description: 計画が意図を満たすかを独立した AI に問う、未実装の ambercast review の計画中のインターフェースと未決事項。
status: planned
sidebar:
  badge:
    text: Planned
    variant: caution
---

:::caution
`ambercast review` は現行版では実装されていない。ここに書く内容は、現行の CLI の機能ではなく、v2 で計画されている動作である。

:::

このページは、`ambercast review` が何を確かめ、何を返す予定か、どの点がまだ決まっていないかを記録する。

## ステータス {#status}

`ambercast review` は現行版では実装されておらず、利用できる CLI コマンドでもない。提供は v2 で計画されている。利用できるコマンドは[CLI の概要](/ambercast/ja/reference/cli/overview/#command-surface)に、現在ある結果の形は[レポート](/ambercast/ja/reference/reports/#result-shapes)にある。

## 計画中のインターフェース {#planned-interface}

| 構文 / 動作 | 計画中の契約 |
| --- | --- |
| `review [files...] [--target <name>] [--json]` | 生成元とは別のコンテキストにいる AI に、計画（plan）が意図を満たし、十分に検証しているかを問う。 |
| `--target` | ターゲットは、明示された名前、設定された既定値、唯一の自前のターゲットキーの順に解決し、どれも無ければ終了コード `2` で終わる。無効な名前を明示したときは、他に切り替えない。 |
| `--json` | 引数の解析後に終わるすべての経路で、共通の構造化エンベロープを出力する。 |
| レビューの懸念 | 懸念はコマンドの正当な赤の結果であり、終了コード `1` に対応する。 |

- このコマンドは v2 に割り当てられ、名前は 2026-08-01 に確定した。
- 集約した終了コードの優先順位は `2 > 3 > 4 > 1 > 5 > 0` とする計画である。

## 未決事項 {#undecided-items}

| 状態 | 項目 | 未決のままである理由 |
| --- | --- | --- |
| ギャップ | `--allow-empty` と `--list` | 計画中の設計は両方のフラグを `review` に割り当てているが、その構文には載っていない。 |
| 未規定 | レビューのプロバイダーと、結果の詳細な契約 | 設計が述べるのは、別のコンテキストの AI が意図と検証の十分さを判定することだけである。 |
| 明示的に未決 | `review` にはなし | このラベルが付くのは `baseline` と `restore` だけである。 |

現在使えるツールは[MCP ツール](/ambercast/ja/reference/mcp-tools/#tool-table)を、レビューが読む計画の形式は[計画ドキュメント](/ambercast/ja/spec/plan-document/)を参照する。
