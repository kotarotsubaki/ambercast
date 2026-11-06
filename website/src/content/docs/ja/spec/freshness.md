---
title: "鮮度とダイジェスト"
description: "この章は `inputsDigest` と `planDigest` を定め、計画とグラウンディングが最新かどうかの判定と、そこから導く `check` のステータスを扱う。"
---

## 入力ダイジェスト {#inputs-digest}

`inputsDigest` は、新規に構築したオブジェクトの正規 JSON の小文字 SHA-256 でなければならない（MUST）。このオブジェクトのメンバーは `normalizedTestMd`・`schemaVersion`・`generatorPromptTemplateFingerprint`・`planProducerBundleFingerprint`・`targetDefinitions` の5つだけである（`src/core/ir/digest.ts:130-139`）。

`targetDefinitions` には、`Plan.targets` が参照するターゲット定義だけを名前順で射影する（`src/core/target/resolve.ts:12-43`）。参照されないターゲットを変えても、計画（plan）は古くならず、ダイジェストも変わらない。設定の `executor` の値はダイジェストに含めない。

正規 JSON はオブジェクトのキーを並べ替えるため、メンバーの挿入順に意味はない（`src/core/ir/canonical-json.ts:153`）。入力オブジェクトそのものを直接ハッシュしてはならない（MUST NOT）（`src/core/ir/digest.ts:118-125`）。プロデューサーバンドルのフィンガープリントは、計画の意味に関わるプロデューサー設定を独立に表す。そのため、テンプレートのバイト列だけでは足りない（`src/core/ir/digest.ts:95-102`）。

## 計画ダイジェスト {#plan-digest}

`planDigest` は、`generatorMeta` を除いた PlanDocument をハッシュしなければならない（MUST）（`src/core/ir/digest.ts:153-156`）。グラウンディングが最新であるとは、保存された `planDigest` と計算した計画ダイジェストが一致することである（`src/core/ir/digest.ts:170-175`）。

`planDigest` は次の4段階で計算する（`src/core/ir/digest.ts:153-156`）。

1. `generatorMeta` を除く計画の全フィールドをコピーする。
2. 残ったオブジェクトを [正準 JSON](/ambercast/ja/spec/canonical-json/#digest-form) に従って正準化する。
3. その UTF-8 バイト列を SHA-256 でハッシュする。
4. ダイジェストを小文字の16進数で表す。

次のどれかが変わると、保存された `inputsDigest` は古くなる。正規化したプロンプト、スキーマバージョン、テンプレートのフィンガープリント、プロデューサーバンドルのフィンガープリント、ターゲット名、ターゲット定義である（`src/core/ir/digest.ts:77,85,93,102,112`）。

## 鮮度の帰結 {#freshness-consequences}

保存された `inputsDigest` が現在の値と異なるとき、コンシューマーは計画を `stale` と判定しなければならない（MUST）（`src/usecases/check.ts:461-465,535`）。プロデューサーバンドルのフィンガープリントは独立した鮮度の入力である。このため、プロンプトとターゲットのデータは同じでも、実装の変更で計画は古くなりうる（`src/core/ir/digest.ts:95-102`）。

`planDigest` が異なるとき、コンシューマーは計画とグラウンディングの組を未結合として扱わなければならない（MUST）（`src/core/ir/digest.ts:170-175`）。

この節は `check` のステータス導出の正本である。リファレンスのページは、それぞれの目的に合わせて要約するだけにとどめ、ここへリンクしなければならない（MUST）。次の表は `check` の結果値について規範となる。表中の `missing`・`invalid`・`stale` はグラウンディング検査の分類であり、レポートの `status` の値ではない（`src/usecases/check-grounding.ts:18`、`src/report/schema.ts:1111-1117`）。

| id | `check` ステータス | 導出 | 結果の分類 |
| --- | --- | --- | --- |
| CHK-01 | `fresh` | 計画が構文として読め、正準形式で、コミット済みのカバレッジが有効で、`inputsDigest` が一致し、対になるグラウンディングが有効である。 | pass |
| CHK-02 | `stale` | 計画の JSON・スキーマ・正準形式・コミット済みカバレッジのいずれかが無効、廃止された `schemaVersion: 4` を使う、コミット済みの `ElementIntent` または `QuotedElementIntent` のソーススパンが無効、あるいは `inputsDigest` が異なる。 | fail |
| CHK-03 | `fresh-without-grounding` | 計画は fresh で、対になるグラウンディングは有効でなく、リポジトリのポリシーが `uncommitted` である。 | pass |
| CHK-04 | `missing-grounding` | 計画は fresh で、グラウンディングの検査結果が `missing` で、ポリシーがコミット済みのグラウンディングを求める。 | fail |
| CHK-05 | `invalid-grounding` | 計画は fresh で、グラウンディングの検査結果が `invalid` である（JSON・スキーマ・正準形式のカバレッジの失敗）。 | fail |
| CHK-06 | `stale-grounding` | 計画は fresh で、グラウンディングの検査結果が `stale` である（別の `planDigest`、または廃止されたグラウンディングの `schemaVersion: 2` か `3`。後者はスキーマ形状の検証より先に調べる）。 | fail |
| CHK-07 | `missing-plan` | 選んだテストに計画のアーティファクトがない。 | fail |
| CHK-08 | `orphaned-plan` | 対象範囲の計画を逆に対応づけると、存在しないテストのパスになる。 | fail |
| CHK-09 | `orphaned-grounding` | 対象範囲のグラウンディングのアーティファクトを逆に対応づけると、対応するテストのプロンプトがないパスになる。 | fail |
| CHK-10 | `invalid-artifact-name` | アーティファクトのパスからテストの識別子を逆算できない。 | fail |
| CHK-11 | `listed` | 探索だけの一覧表示では、選んだパスを検査しない。 | skipped |
| CHK-12 | `skipped` | 中断により、識別情報だけの保留行が残る。 | skipped |

それ以外は有効で最新のグラウンディング文書でも、エントリに次のいずれかがあれば、文書単位の分類は変わらない。

- `intentDigest` が一致しない。
- ID が計画にない。
- アクション種別でないステップのエントリである。

`run` は、そのようなエントリを自分のステップ単位の境界で存在しないものとして扱う。

`fresh` と `fresh-without-grounding` の行は pass である。上の表で fail と分類した行はすべて失敗に数える。`listed` と `skipped` は skipped である（`src/usecases/check-report.ts:72-75`）。

## 設計根拠 {#rationale}

問題は、導出した計画が、それを作った入力とプロデューサーの規約を今も表しているかどうかを判定することである。プロンプトだけの比較では、ジェネレーターの意味の変更を検出できない。

採用した閉じた原像には、プロデューサーバンドルの来歴と、計画とグラウンディングを結ぶ別のダイジェストを含める。これにより、無効化の入力はすべて明示され、1つの計画には最新のグラウンディングが1つだけ対応する。

却下した案は2つある。1つはプロデューサーの来歴を省く案で、生成の挙動が変わっても fresh に見えてしまうため却下した。もう1つはタイムスタンプを使う案で、内容を特定できず、決定論的なキャッシュの再利用もできないため却下した。
