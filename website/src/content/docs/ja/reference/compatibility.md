---
title: 互換性と再生成
description: ambercast におけるアーティファクト形式のバージョン互換性と、変更に伴う再生成の要件について定義します。
---

ambercast が生成する Plan や Grounding などのアーティファクト形式における互換性と、入力や規約の変更に伴う再生成の境界について規定します。

## 互換性テーブル {#compatibility-table}

パッケージの各バージョンと、各アーティファクトのスキーマバージョンおよび要素フィンガープリントタグの対応関係は以下の通りです。

| パッケージバージョン | Plan `schemaVersion` | Grounding `schemaVersion` | 要素フィンガープリントタグ | レポート `schemaVersion` |
| --- | --- | --- | --- | --- |
| `0.1.0` | `2` | `1`（未確認） | `a11y-neighborhood-v2` | `3.0` |
| `0.2.0` | `2` | `1` | `a11y-neighborhood-v2` | `3.0` |

バージョン 0.2.0 では、Plan のスキーマバージョンを変更することなくプロバイダのリクエスト規約が変更されました。この変更により `producerBundleFingerprint` およびすべてのプロンプトの `inputsDigest` が変化するため、0.1.0 で生成された Plan は stale（陳腐化）として扱われます。

なお、Plan のバージョン 1 については、インプレースで移行（マイグレーション）される仕組みはなく、再生成されるか stale として報告されます。

## 再生成境界 {#regeneration-boundary}

コードや設定、プロンプトに変更が加わった際の影響範囲と、それに伴うアーティファクトの再生成義務は以下の通り定義されています。

| 変更内容 | 影響を受ける対象 | 再生成・対応の義務 |
| --- | --- | --- |
| 正規化されたプロンプト、Plan スキーマバージョン、ジェネレータテンプレートのフィンガープリント、プロデューサバンドルのフィンガープリント、または名前付きターゲット定義の変更 | `inputsDigest` および Plan の鮮度 | Plan を再生成します。その結果として生じる Grounding の紐付けには、リプレイ関連 Plan 内容の変更に伴う義務が個別に適用されます。 |
| リプレイに関連する Plan の内容 | Grounding に記録された `planDigest` | Grounding を再生成または置換します。`generatorMeta` のみの変更は `planDigest` に含まれません。 |
| 受け入れ対象の要素フィンガープリントアルゴリズムまたはプリイメージ | 既存の要素グラウンディングエントリ | `run` では、利用不能なソースは、存在しない場合、無効な JSON の場合、stale な provenance の場合、またはカバレッジの主張がないまま厳密なパースに失敗した場合はキャッシュミスとして扱われます。現行の provenance を持つソースが一度カバレッジを主張した場合、その構造的または正規化の失敗は整合性エラー（integrity failure）となり、フォールバックは行われません。`check` では、グラウンディングの検査において JSON やスキーマの不備、および主張された非正規ソースは `invalid` として分類され、古い `planDigest` は `stale` として分類されます。公開レポートのステータスは [鮮度とダイジェスト](/ambercast/ja/spec/freshness/#freshness-consequences) のリポジトリポリシーに従って導出されます。 |
| レポートのスキーマバージョンまたはフィールド規約 | 構造化出力のコンシューマおよび永続化された実行レポート | （未確認）コンシューマの移行およびレポート再生成の義務は 0.2.0 のコードでは定義されていません。実装では出力されるエンベロープのバージョンのみが固定されています。 |
| Plan、Grounding、または設定の Zod スキーマ | 公開された npm スキーマアーティファクト | パッケージのビルドを実行し、それぞれの Zod ソースから 4 つの JSON Schema を再生成します。 |

`inputsDigest` は、正規化されたプロンプト、Plan スキーマバージョン、ジェネレータテンプレートのフィンガープリント、プロデューサバンドルのフィンガープリント（`producerBundleFingerprint`）、および名前付きターゲット定義という 5 つの入力値のみを対象に、正規 JSON（canonical JSON）および SHA-256 を介して厳密にハッシュ値を算出します。

Grounding の鮮度判定は、Grounding 自体に記録された `planDigest` と、候補となる Plan に対して計算されたダイジェストとの直接的な完全一致チェック（direct equality check）によって検証されます。

### 関連ドキュメント
- [変更履歴](/ambercast/ja/reference/changelog/#release-020)
- [バージョン間のアップグレード](/ambercast/ja/how-to/upgrade/)
- [ambercast check](/ambercast/ja/reference/cli/check/#status-vocabulary)
- [鮮度とダイジェスト](/ambercast/ja/spec/freshness/)
- [仕様変更履歴](/ambercast/ja/spec/changelog/)
