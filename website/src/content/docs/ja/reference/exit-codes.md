---
title: 終了コード
description: ambercast が返すプロセスの終了コードと、複数の結果を 1 つにまとめるときの優先順位を示すリファレンス。
---

CI やスクリプトは、終了コードを見て実行結果を判別できる。終了コードは 0 から 5 までの 6 種類で、それぞれに優先順位がある。

## 終了コード一覧 {#exit-code-table}

| コード | 意味 | 優先順位（小さいほど優先） |
| --- | --- | --- |
| 0 | 成功、または候補なし | 5 |
| 1 | コマンドとしての否定的な結果 | 3 |
| 2 | 利用または設定のエラー | 0 |
| 3 | 環境エラー | 1 |
| 4 | 信頼できない計画（plan）またはグラウンディングの成果物 | 2 |
| 5 | 選択が空 | 4 |

たとえば [`PROMPT_PATH_INVALID`](/ambercast/ja/reference/error-codes/#code-vocabulary) は利用エラーであり、終了コード 2 で終わる。

## 集約優先順位 {#aggregation-priority}

複数の結果が出たときは、優先順位の数値が小さい終了コードを採用する。順序は 2 > 3 > 4 > 1 > 5 > 0 である。

結果は反復の順序に依存しない。候補がなければ 0 を返す。

## 優先順位の互換アンカー {#priority}

旧来のアンカーを残すための節である。内容は[集約優先順位](/ambercast/ja/reference/exit-codes/#aggregation-priority)を参照する。

## 関連項目 {#see-also}

- [エラーコード](/ambercast/ja/reference/error-codes/#code-vocabulary)
- [レポート](/ambercast/ja/reference/reports/#envelope)
- [よくある失敗のトラブルシューティング](/ambercast/ja/how-to/troubleshoot/)
