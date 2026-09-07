---
title: "鮮度とダイジェスト"
description: "`inputsDigest` は、正確にこれら5つのメンバー（`normalizedTestMd`、`schemaVersion`、`generatorPromptTemplateFingerprint`、`planProducerBundleFingerprint`、および `targetDefinitions`）を持つ新規に構築されたオブジェクトの正規JSONに対する、小文字のSHA-256でなければならない（MUST）。"
---

## 入力ダイジェスト {#inputs-digest}

`inputsDigest` は、正確にこれら5つのメンバー（`normalizedTestMd`、`schemaVersion`、`generatorPromptTemplateFingerprint`、`planProducerBundleFingerprint`、および `targetDefinitions`）を持つ新規に構築されたオブジェクトの正規JSONに対する、小文字のSHA-256でなければならない（MUST）。正規JSONはオブジェクトのキーをソートするため、メンバーの挿入順序には意味がない。[src/core/ir/digest.ts:93](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/digest.ts#L93) [src/core/ir/digest.ts:105](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/digest.ts#L105) [src/core/ir/canonical-json.ts:147](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/canonical-json.ts#L147) 入力オブジェクト自体を直接ハッシュ化してはならない（MUST NOT）。[src/core/ir/digest.ts:97](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/digest.ts#L97) プロデューサバンドルのフィンガープリントは計画セマンティックなプロデューサ設定を独立して表すため、テンプレートのバイト列のみでは不十分である。[src/core/ir/digest.ts:70](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/digest.ts#L70)

## プランダイジェスト {#plan-digest}

`planDigest` は `generatorMeta` を除く PlanDocument をハッシュ化しなければならない（MUST）。[src/core/ir/digest.ts:118](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/digest.ts#L118) グラウンディングの最新性は、格納された `planDigest` と計算されたプランダイジェストとの完全な一致である。[src/core/ir/digest.ts:145](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/digest.ts#L145)

`planDigest` を計算するには、`generatorMeta` を除くすべての Plan フィールドをコピーし、残りのオブジェクトを [正準 JSON](/ambercast/ja/spec/canonical-json/#digest-form) に従って正規化し、その UTF-8 バイト列を SHA-256 でハッシュ化して、そのダイジェストを小文字の16進数でエンコードする。[src/core/ir/digest.ts:128](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/digest.ts#L128) 正規化されたプロンプト、スキーマバージョン、テンプレートのフィンガープリント、プロデューサバンドルのフィンガープリント、ターゲット名、またはターゲット定義の変更は、格納された `inputsDigest` をステールにする。[src/core/ir/digest.ts:52](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/digest.ts#L52), [src/core/ir/digest.ts:60](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/digest.ts#L60), [src/core/ir/digest.ts:68](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/digest.ts#L68), [src/core/ir/digest.ts:77](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/digest.ts#L77), [src/core/ir/digest.ts:87](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/digest.ts#L87)

## 鮮度の帰結 {#freshness-consequences}

コンシューマは、格納された `inputsDigest` が現在の値と異なる場合、プランを `stale` とマークしなければならない（MUST）。[src/usecases/check.ts:500](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/check.ts#L500) プロデューサバンドルのフィンガープリントは独立した鮮度入力であるため、プロンプトやターゲットのデータが変更されない場合でも、実装の変更によってプランがステールになる可能性がある。[src/core/ir/digest.ts:70](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/digest.ts#L70) コンシューマは、`planDigest` が異なる場合、プラン／グラウンディングのペアを未バインドとして扱わなければならない（MUST）。[src/core/ir/digest.ts:145](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/digest.ts#L145)

本セクションは、`check` ステータス導出の正準な定義元である。参照ページは、それぞれのローカルな目的のためにその要約を記載し、ここにリンクするのみとしなければならない（MUST）。以下の表は、`check` の結果値に対して規範的である。以下の `missing`、`invalid`、および `stale` はグラウンディング検査の分類であり、レポートの `status` 値ではない。[src/usecases/check-grounding.ts:18](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/check-grounding.ts#L18) [src/report/schema.ts:525](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/report/schema.ts#L525)

| id | `check` ステータス | 導出 | 結果分類 |
| --- | --- | --- | --- |
| CHK-01 | `fresh` | プランがパース可能で、正規形式であり、有効なコミット済みカバレッジを持ち、その `inputsDigest` が一致し、かつそのコンパニオンが有効である。 | pass |
| CHK-02 | `stale` | プランの JSON／スキーマ／正規形式、またはコミット済みカバレッジが無効であるか、あるいはその `inputsDigest` が異なる。 | fail |
| CHK-03 | `fresh-without-grounding` | プランが fresh であり、コンパニオンが有効ではなく、リポジトリポリシーが `uncommitted` である。 | pass |
| CHK-04 | `missing-grounding` | プランが fresh であり、コンパニオン検査が `missing` であり、ポリシーがコミット済みグラウンディングを要求している。 | fail |
| CHK-05 | `invalid-grounding` | プランが fresh であり、コンパニオン検査が `invalid` である（JSON／スキーマ／正規形式カバレッジの失敗）。 | fail |
| CHK-06 | `stale-grounding` | プランが fresh であり、コンパニオン検査が `stale` である（別の `planDigest`）。 | fail |
| CHK-07 | `missing-plan` | 選択されたテストにプランアーティファクトが存在しない。 | fail |
| CHK-08 | `orphaned-plan` | スコープ内のプランが、存在しないテストパスへと逆マッピングされる。 | fail |
| CHK-09 | `orphaned-grounding` | スコープ内のグラウンディングアーティファクトが、対応するテストプロンプトが存在しないパスへと逆マッピングされる。 | fail |
| CHK-10 | `invalid-artifact-name` | アーティファクトのパスからテスト識別子を逆導出できない。 | fail |
| CHK-11 | `listed` | ディスカバリのみのリスト表示では、選択されたパスを検査しない。 | skipped |
| CHK-12 | `skipped` | 中断により、識別情報のみの保留行が残される。 | skipped |

`fresh` および `fresh-without-grounding` の行は pass であり、上記で fail と分類されたすべての行は failure の要因となり、`listed` および `skipped` は skipped である。[src/usecases/check-report.ts:71](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/check-report.ts#L71)

## 設計根拠 {#rationale}

問題は、導出されたプランが、それを生成した入力およびプロデューサ規約を現在も表しているか否かを判断することである。プロンプトのみの比較では、ジェネレーターのセマンティクスの変更を検知できない。

採用された閉じた原像には、プロデューサバンドルの来歴と、個別のプラン対グラウンディングのダイジェスト結合が含まれている。これにより、すべての無効化入力が明示的になり、1つのプランに対して1つの最新グラウンディングという対応関係が維持される。

却下された代替案の1つは、プロデューサの来歴を省略していた。これは、変更された生成挙動が fresh を装う可能性があるため却下された。別の代替案はタイムスタンプを使用していたが、コンテンツを特定することも決定論的なキャッシュの再利用を可能にすることもないため却下された。 
