---
title: "計画ドキュメント"
description: "`PlanDocument` は厳格なオブジェクトである。"
---

## ドキュメントの形状 {#document-shape}

`PlanDocument` は厳格なオブジェクトである。プロデューサはリテラルバージョン 2 を出力しなければならず（MUST）、コンシューマは未知のプロパティおよび他のバージョンを拒絶しなければならない（MUST）。[src/core/ir/schema.ts:1189](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1189)

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `schemaVersion` | integer | required | literal `2` | 計画フォーマットのバージョン。 | [src/core/ir/schema.ts:57](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L57), [src/core/ir/schema.ts:1190](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1190) |
| `source` | strict object | required | exactly `inputsDigest` | 鮮度ラッパー。 | [src/core/ir/schema.ts:1191](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1191) |
| `source.inputsDigest` | string | required | `/^[0-9a-f]{64}$/` | 生成入力のダイジェスト。 | [src/core/ir/schema.ts:35](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L35), [src/core/ir/schema.ts:1191](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1191) |
| `generatorMeta` | record string → `JsonValue` | optional | JSON only | `planDigest` から除外されるメタデータ。 | [src/core/ir/schema.ts:1189-1193](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1189-L1193); [src/core/ir/digest.ts:128-131](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/digest.ts#L128-L131) |
| `targets` | record string → `TargetDefinition` | required | strict value; [値型](/ambercast/ja/spec/value-types/#shared-types) | ターゲットのスナップショット。 | [src/core/ir/schema.ts:1193](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1193) |
| `steps` | `Step[]` | required | ordered strict branches | 計画シーケンス; [ステップ](/ambercast/ja/spec/steps/#step-union)。 | [src/core/ir/schema.ts:1194](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1194) |

`generatorMeta` の省略と `{}` は、シリアライズされた Plan の値としては区別されたままであるが、いずれも `planDigest` には影響しない：ダイジェストビューは `generatorMeta` を全体として除外する。[src/core/ir/schema.ts:1189-1193](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1189-L1193) [src/core/ir/digest.ts:128-131](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/digest.ts#L128-L131)

## 完全な最小ドキュメント {#complete-minimal-document}

ダイジェスト文字列は例示用のプレースホルダーである。Grounding の例は、まさにこの Plan の例を参照すると宣言された、同一の例示用 `planDigest` を使用する。

```json
{
  "schemaVersion": 2,
  "source": {"inputsDigest": "0000000000000000000000000000000000000000000000000000000000000000"},
  "targets": {"app": {"baseUrl": "https://example.test", "browser": "chromium"}},
  "steps": [{"id": "open-home", "kind": "action", "action": "navigate", "url": "https://example.test"}]
}
```

## セマンティック制約 {#semantic-constraints}

ステップ ID は一意でなければならず（MUST）、重複がある場合は後続の `steps[index].id` において `duplicate step id: <id>` が報告される。[src/core/ir/schema.ts:1180-1204](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1180-L1204) インストラクションカバレッジは、[適合性](/ambercast/ja/spec/conformance/#semantic-validation) におけるプロンプト束縛のローカル帰属と集合チェックを要求する。[src/usecases/instruction-coverage-policy.ts:337-496](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/instruction-coverage-policy.ts#L337-L496)

## プロバイダー専用の生成レスポンス {#provider-generation-response}

プロバイダーは `schemaVersion`、`source`、または `targets` を作成しない。コミット済み計画のバリデーションの前に、ローカル生成がこれらを追加する。[src/core/ir/schema.ts:1227](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1227)

| object | field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `GeneratedPlanResponse` | `steps` | `GeneratedStep[]` | required | generated forms in [ステップ](/ambercast/ja/spec/steps/#generated-forms) | プロバイダーの提案。 | [src/core/ir/schema.ts:1234](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1234) |
|  | `generatorMeta` | record string → `JsonValue` | optional | JSON only | プロバイダーのメタデータ。 | [src/core/ir/schema.ts:1236](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1236) |
|  | `ambiguities` | `JsonValue[]` | required | none | 曖昧性のペイロード。 | [src/core/ir/schema.ts:1237](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1237) |
| `VerificationIntent` | `criterionId` | `InstructionCriterionId` | required | step-ID regex | 提案された成功基準。 | [src/core/ir/schema.ts:844](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L844) |
|  | `assertion` | `TraceAssert` | required | strict trace assertion | 一時的な終端エビデンス。 | [src/core/ir/schema.ts:846](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L846) |

`GeneratedPlanResponseForPolicy` は AI の `verificationIntent` アサーションを `JsonValue` に緩和する。`GeneratedPlanResponseRequest` は空の `verificationIntent` を許可する。双方は一時的であり、コミットされた Plan 形式となることは決してない。[src/core/ir/schema.ts:1250](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1250), [src/core/ir/schema.ts:1286](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1286)

## 設計根拠 {#rationale}

課題は、レビュー済みのテスト意図を保持しつつ、生成された実行詳細の再現性を可能にすることである。計画は派生データであるため、ソースプロンプトになることなく生成来歴を公開する。

選定された厳格でバージョン管理されたドキュメントは、結果をドキュメント外に残したまま、ターゲットのスナップショットと順序付きステップを捕捉する。これにより、リプレイをまたいでも計画ダイジェストが安定し、入力が変更された際の再生成が明示的になる。

却下された代替案の一つはトレースを計画にマージするものであったが、実行の成功によってレビュー済みの意図が書き換えられてしまうため却下された。もう一つの代替案は古い計画をインプレースで移行するものであったが、セマンティクスが変更された派生物は、暗黙のうちに再解釈するよりも再生成する方が安全であるため却下された。 
