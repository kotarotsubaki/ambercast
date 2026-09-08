---
title: 終了コード
description: ambercast がプロセス終了ステータスとして返す終了コードと、その集約優先順位のリファレンスです。
---

ambercast は、機械判定が可能なプロセス終了ステータスとして終了コードを提供します。CI や自動実行スクリプトにおいて処理結果を判別できるように、各終了コードには固有の意味と集約時の優先順位が定められています。

エラーコードの語彙については [エラーコード](/ambercast/ja/reference/error-codes/#code-vocabulary)、レポートのエンベロープ構造については [レポート](/ambercast/ja/reference/reports/#envelope)、トラブルシューティングの手順については [一般的な障害のトラブルシューティング](/ambercast/ja/how-to/troubleshoot/) を参照してください。

## 終了コード一覧 {#exit-code-table}

ambercast がプロセス終了時に返す終了コード、その定義、および優先順位は以下の通りです。

| code | meaning | priority |
| --- | --- | --- |
| 0 | success or no candidate | 5 |
| 1 | command-domain negative result | 3 |
| 2 | usage or configuration error | 0 |
| 3 | environment error | 1 |
| 4 | untrustworthy plan or grounding artifact | 2 |
| 5 | empty selection | 4 |

## 集約優先順位 {#aggregation-priority}

複数の終了コードが集約される場合、優先順位の数値（ランク）がより小さいコードが優先されます。これにより、優先関係は 2 > 3 > 4 > 1 > 5 > 0 と定まります。

このコード選択はイテレーション順序に依存せず、対象となる候補が存在しない場合は 0 を返します。

## 優先順位の互換性リンク {#priority}

以前のアンカーとの後方互換性を維持するためのセクションですので、集約優先順位の詳細については [終了コード](/ambercast/ja/reference/exit-codes/#aggregation-priority) を参照してください。
