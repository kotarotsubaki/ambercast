---
title: "計画ドキュメント"
description: "この章は、コミットする計画ファイルの最上位オブジェクトである `PlanDocument`、その最小の例、およびローカル生成がそれに変換する生成レスポンスを定義する。"
---

## ドキュメントの形状 {#document-shape}

`PlanDocument` は厳格なオブジェクトである。プロデューサはリテラルの `5` を出力しなければならず（MUST）、コンシューマは未知のプロパティと他のバージョンを拒絶しなければならない（MUST）（`src/core/ir/schema.ts:62`、`src/core/ir/schema.ts:1541-1546`）。

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `schemaVersion` | integer | required | literal `5` | 計画（plan）フォーマットのバージョン。 | `src/core/ir/schema.ts:62,1542` |
| `source` | strict object | required | exactly `inputsDigest` | 鮮度のラッパー。 | `src/core/ir/schema.ts:1543` |
| `source.inputsDigest` | string | required | `/^[0-9a-f]{64}$/` | 生成入力のダイジェスト。 | `src/core/ir/schema.ts:35,1543` |
| `generatorMeta` | record string → `JsonValue` | optional | JSON only | `planDigest` から除外されるメタデータ。 | `src/core/ir/schema.ts:1544`、`src/core/ir/digest.ts:153-157` |
| `targets` | record string → `TargetDefinition` | required | strict value; [値型](/ambercast/ja/spec/value-types/#shared-types) | 参照されるターゲットのスナップショット。すべてのキーをいずれかのステップが使う必要がある。 | `src/core/ir/schema.ts:1545,1569-1578` |
| `steps` | `Step[]` | required | ordered strict branches | 計画のシーケンス; [ステップ](/ambercast/ja/spec/steps/#step-union)。 | `src/core/ir/schema.ts:1546` |

`generatorMeta` の省略と `{}` は、シリアライズした計画の値としては別のままだが、どちらも `planDigest` には影響しない。ダイジェスト用のビューが `generatorMeta` の全体を除外するためである（`src/core/ir/schema.ts:1544`、`src/core/ir/digest.ts:153-157`）。

## 完全な最小ドキュメント {#complete-minimal-document}

ダイジェストの文字列は、例示用のプレースホルダーである。グラウンディングの例は、この計画の例を指すと宣言した、同じ例示用の `planDigest` を使う。

```json
{
  "schemaVersion": 5,
  "source": {"inputsDigest": "0000000000000000000000000000000000000000000000000000000000000000"},
  "targets": {"app": {"surface": "web", "baseUrl": "https://example.test"}},
  "steps": [{"id": "open-home", "kind": "action", "action": "navigate", "target": "app", "url": "https://example.test"}]
}
```

## セマンティック制約 {#semantic-constraints}

ステップ ID は一意でなければならない（MUST）。重複があると、後ろの `steps[index].id` に `duplicate step id: <id>` を報告する（`src/core/ir/schema.ts:1551-1558`）。命令のカバレッジは、[適合性](/ambercast/ja/spec/conformance/#semantic-validation)が定める、プロンプトに結び付いたローカルの帰属と集合の検査を要求する（`src/usecases/instruction-coverage-policy.ts:379-538`）。

## プロバイダー専用の生成レスポンス {#provider-generation-response}

プロバイダーは、`schemaVersion`、`source`、`targets` を作成しない。コミット済みの計画を検証する前に、ローカル生成がこれらを追加する。プロバイダーのシークレット命名の意図は、コミット済みの `SecretRef` を作る前にローカルで解決する（`src/core/ir/schema.ts:1611-1624`、`src/core/ir/schema.ts:1022-1029,1146`）。

要素を含むステップについてプロバイダーが提案する形式は、コミット済みの `ElementIntent` と `QuotedElementIntent` ではなく、`GeneratedInstructionCriterion` と同じアンカー座標を持つ一時的な `GeneratedElementIntent` と `GeneratedQuotedElementIntent` を使う（`src/core/ir/schema.ts:392-400,435-457`）。

| object | field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `GeneratedPlanResponse` | `steps` | `GeneratedStep[]` | required | generated forms in [ステップ](/ambercast/ja/spec/steps/#generated-forms) | プロバイダーの提案。 | `src/core/ir/schema.ts:1612` |
|  | `generatorMeta` | record string → `JsonValue` | optional | JSON only | プロバイダーのメタデータ。 | `src/core/ir/schema.ts:1613` |
|  | `ambiguities` | `JsonValue[]` | required | none | ターゲットを割り当てられないステップ。 | `src/core/ir/schema.ts:1622` |
|  | `assumptions` | `string[]` | optional | string items only | プロンプトにない他の仮定。レポートの警告であり、計画には保存しない。 | `src/core/ir/schema.ts:1623` |
| `VerificationIntent` | `criterionId` | `InstructionCriterionId` | required | step-ID regex | 提案された成功基準。 | `src/core/ir/schema.ts:1187` |
|  | `assertion` | `TraceAssert` | required | strict trace assertion | 一時的な終端エビデンス。 | `src/core/ir/schema.ts:1188` |

`GeneratedPlanResponseForPolicy` は、AI の `verificationIntent` のアサーションを `JsonValue` に緩める。`GeneratedPlanResponseRequest` は、空の `verificationIntent` を許す。どちらも一時的な形式であり、コミットする計画の形式にはならない（`src/core/ir/schema.ts:1636,1672`）。

## 設計根拠 {#rationale}

課題は、レビュー済みのテストの意図を保ちながら、生成する実行の詳細を再現できるようにすることである。計画は派生データなので、ソースのプロンプトの代わりにはならず、生成の来歴だけを示す。

採用した厳格でバージョン管理されたドキュメントは、結果を含めずに、ターゲットのスナップショットと順序付きのステップを記録する。これにより、計画のダイジェストは再生をまたいで安定し、入力が変わったときの再生成が明確になる。

却下した代替案の 1 つは、トレースを計画に統合することである。実行が成功するたびに、レビュー済みの意図が書き換わるため、却下した。もう 1 つは、古い計画をその場で移行することである。意味が変わった派生物は、黙って再解釈するより再生成する方が安全なため、却下した。
