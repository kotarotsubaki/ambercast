---
title: 互換性と再生成
description: パッケージのバージョンごとのアーティファクト形式の互換性と、計画・グラウンディング・レポートの再生成が必要になる変更を示す。
---

各リリースはスキーマバージョンと要素フィンガープリントタグを固定する。以下の表は、リリースごとに固定されるバージョンと、再生成を要する変更を示す。

## 互換性テーブル {#compatibility-table}

| パッケージバージョン | 計画（plan） `schemaVersion` | グラウンディング `schemaVersion` | 要素フィンガープリントタグ | レポート `schemaVersion` |
| --- | --- | --- | --- | --- |
| `0.1.0` | `2` | `1` | `a11y-neighborhood-v2` | `3.0` |
| `0.2.0` | `2` | `1` | `a11y-neighborhood-v2` | `3.0` |
| `0.5.0` | `3` | `1` | `a11y-neighborhood-v2` | `3.5` |
| `0.7.0` | `5` | `3` | `a11y-neighborhood-v2` | `3.8` |
| `0.8.0` | `5` | `3` | `a11y-neighborhood-v2` | `3.9` |
| `0.9.0` | `5` | `3` | `a11y-neighborhood-v2` | `3.10` |
| `0.10.0` | `5` | `4` | `a11y-neighborhood-v2` | `3.11` |

表には 0.1.0、0.2.0、0.8.0 以降のすべてのリリース、計画またはグラウンディングのスキーマバージョンが変わった各リリースを載せる。最新リリースより後に `main` で変わったスキーマバージョンは、リリース時にこの表へ載る。現在公開中のスキーマは [JSON スキーマ](/ambercast/ja/reference/json-schemas/#publication-metadata) を参照する。

バージョン 0.2.0 では、計画のスキーマバージョンを上げずにプロバイダーのリクエスト規約が変わった。この変更で `producerBundleFingerprint` とすべてのプロンプトの `inputsDigest` が変わり、0.1.0 の計画は stale（陳腐化）になった。詳しくは [変更履歴](/ambercast/ja/reference/changelog/#release-020) を参照する。

スキーマの変更は、いずれもインプレースでは移行されない。遷移ごとに次の扱いになる。

- 計画 v1 と v2: `generate` はどちらも fresh ではないものとして扱い、現行の計画を再生成する。`check` は読み取り専用で `stale` と報告する。`run` と `heal` は `INTEGRITY_VIOLATION`（終了コード 4）で拒否する。
- 計画 v3: v2 のシークレットグラントの provenance モデルを、同意と `secrets.allow` に置き換える。
- 計画 v4: インプレースでは移行されない。fresh ではない計画、`stale`、`INTEGRITY_VIOLATION` として同じく扱われる。
- 計画 v5: v4 の要素参照をソースに裏付けられた intent へ置き換え、`confirms` も追加する。
- グラウンディング v3: v2 のフィンガープリントのみのエントリを置き換える。新しいエントリは locator、fingerprint、intentDigest、provenance を持つ。

手順を追ったアップグレード方法は [バージョン間のアップグレード](/ambercast/ja/how-to/upgrade/) を参照する。

## 再生成境界 {#regeneration-boundary}

| 変更内容 | 影響を受ける対象 | 再生成・対応の義務 |
| --- | --- | --- |
| 正規化されたプロンプト、計画のスキーマバージョン、ジェネレーターテンプレートのフィンガープリント、プロデューサーバンドルのフィンガープリント、または名前付きターゲット定義の変更 | `inputsDigest` と計画の鮮度 | 計画を再生成する。その結果のグラウンディングの紐付けは、再生に関係する計画の内容として別に扱う。 |
| 再生に関係する計画の内容 | グラウンディングに記録された `planDigest` | グラウンディングを再生成または置換する。`generatorMeta` だけの変更は `planDigest` に含まれない。 |
| 受け入れ対象の要素フィンガープリントアルゴリズムまたはプリイメージ | 既存の要素グラウンディングエントリ | `run` では、次のソースをキャッシュミスとして扱う。対象は、存在しないソース、無効な JSON のソース、stale な provenance のソース、カバレッジの主張がないまま厳密なパースに失敗したソースである。現行の provenance を持つソースがカバレッジを主張した後の構造的または正規化の失敗は、整合性エラーになり、フォールバックしない。`check` のグラウンディング検査は、JSON やスキーマの不備と、主張された非正規ソースを `invalid` に分類し、古い `planDigest` を `stale` に分類する。公開レポートのステータスは [鮮度とダイジェスト](/ambercast/ja/spec/freshness/#freshness-consequences) のリポジトリポリシーに従って導出する。 |
| レポートのスキーマバージョンまたはフィールド規約 | 構造化出力のコンシューマーと永続化された実行レポート | 出力されるレポート契約に合わせてコンシューマーを更新する。各レポートバージョンの変更点は [変更履歴](/ambercast/ja/reference/changelog/) に載っている。 |
| 計画、グラウンディング、設定、またはレポートの Zod スキーマ | 公開された npm スキーマアーティファクト | パッケージのビルドを実行し、それぞれの Zod ソースから 4 つの JSON Schema を再生成する。 |

`inputsDigest` は、宣言された 5 つの入力だけを、正規 JSON（canonical JSON）と SHA-256 でハッシュする。入力は次のとおりである。

- 正規化されたプロンプト
- 計画のスキーマバージョン
- ジェネレーターテンプレートのフィンガープリント
- プロデューサーバンドルのフィンガープリント
- 名前付きターゲット定義

グラウンディングの鮮度判定は、グラウンディングに記録された `planDigest` と、候補の計画から計算したダイジェストとの直接の一致比較である。

## 関連項目 {#see-also}

- [変更履歴](/ambercast/ja/reference/changelog/#release-020)
- [バージョン間のアップグレード](/ambercast/ja/how-to/upgrade/)
- [ambercast check](/ambercast/ja/reference/cli/check/#status-vocabulary)
- [鮮度とダイジェスト](/ambercast/ja/spec/freshness/)
- [鮮度の帰結](/ambercast/ja/spec/freshness/#freshness-consequences)
- [仕様変更履歴](/ambercast/ja/spec/changelog/)
