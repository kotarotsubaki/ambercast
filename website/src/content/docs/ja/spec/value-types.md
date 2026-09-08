---
title: "値型"
description: "他のすべての章は、それらの形状を再記述するのではなく、これらの定義を使用しなければならない（MUST）。"
---

## 共有型 {#shared-types}

他のすべての章は、それらの形状を再記述するのではなく、これらの定義を使用しなければならない（MUST）。以下のすべてのオブジェクトは厳格（strict）であり、未知のプロパティは拒絶されなければならない（MUST）。[src/core/ir/schema.ts:165](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L165) [src/core/ir/schema.ts:183](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L183) 正規表現はランタイムオーソリティから逐語的に引用されている。

| Type | field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `TargetDefinition` | `baseUrl` | string | required | `/^https?:\\/\\/[^\\s/?#]\\S*$/`; `/^(?![\\s\\S]*\\{\\{secrets\\.)[\\s\\S]*$/` | シークレットマーカーを含まない、作成されたHTTP(S)ベースURL。 | [src/core/ir/schema.ts:37-38](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L37-L38), [src/core/ir/schema.ts:165-166](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L165-L166) |
|  | `browser` | string | required | literal `chromium` | 選択されたブラウザ。 | [src/core/ir/schema.ts:167](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L167) |
|  | `secretSinkOrigins` | record `SecretRef` → `SecretSinkOrigin[]` | optional | See scalar table | シークレットごとの許可されたオリジン。 | [src/core/ir/schema.ts:168](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L168) |
| `AccessibilityElementRef` | `strategy` | string | required | literal `accessibility` | ロケータ判別子。 | [src/core/ir/schema.ts:183](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L183) |
|  | `role` | string | required | min 1 | 正確なアクセシビリティロール。 | [src/core/ir/schema.ts:185](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L185) |
|  | `name` | string | required | min 1 | アクセシブル名。 | [src/core/ir/schema.ts:186](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L186) |
| `Fingerprint` | `algorithm` | string | required | literal `a11y-neighborhood-v2` | ロケータエビデンスの形式。 | [src/core/ir/schema.ts:221](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L221) |
|  | `hash` | string | required | `/^[0-9a-f]{64}$/` | 小文字のSHA-256。 | [src/core/ir/schema.ts:35](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L35), [src/core/ir/schema.ts:223](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L223) |
| `SourceSpan` | `startLine` | integer | required | positive | 境界を含む、1始まりのグラント開始行。 | [src/core/ir/schema.ts:259](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L259) |
|  | `endLine` | integer | required | positive; `endLine >= startLine` | 境界を含むグラント終了行。 | [src/core/ir/schema.ts:260](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L260), [src/core/ir/schema.ts:261](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L261) |
| `InstructionSourceSpan` | `startLine` | integer | required | positive | 1始まりのUTF-16開始行。 | [src/core/ir/schema.ts:332](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L332) |
|  | `startColumn` | integer | required | positive | 1始まりのUTF-16開始列。 | [src/core/ir/schema.ts:333](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L333) |
|  | `endLine` | integer | required | positive | 1始まりのUTF-16終了行。 | [src/core/ir/schema.ts:334](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L334) |
|  | `endColumn` | integer | required | positive | 境界を含まないUTF-16終了列。 | [src/core/ir/schema.ts:335](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L335) |
| `GeneratedInstructionCriterion` | `id` | string | required | `STEP_ID_PATTERN` | 帰属待ちのクライテリア。 | [src/core/ir/schema.ts:350](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L350) |
|  | `kind` | string | required | enum `success`, `action` | 節の役割。 | [src/core/ir/schema.ts:351](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L351) |
|  | `citation` | string | required | min 1; max `4096` | プロバイダの逐語的な抜粋。 | [src/core/ir/schema.ts:352](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L352) |
| `InstructionCriterion` | `id` | string | required | `STEP_ID_PATTERN` | 確定されたクライテリアID。 | [src/core/ir/schema.ts:366](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L366) |
|  | `kind` | string | required | enum `success`, `action` | 節の役割。 | [src/core/ir/schema.ts:367](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L367) |
|  | `sourceSpan` | `InstructionSourceSpan` | required | strict nested object | ローカルで導出されたプロンプト位置。 | [src/core/ir/schema.ts:368](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L368) |

現在、`ElementRef` は `AccessibilityElementRef` のみを持つ。`HexSha256` は `/^[0-9a-f]{64}$/` であり、`StepId` および `InstructionCriterionId` は `/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/` であり、`RunVariableName` は `/^[a-z][a-zA-Z0-9]*$/` であり、`RunRef` は `/^\\{\\{run\\.[A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)*\\}\\}$/` である。[src/core/ir/schema.ts:35](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L35), [src/core/ir/schema.ts:41](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L41), [src/core/ir/schema.ts:198](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L198), [src/core/ir/schema.ts:237](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L237), [src/core/ir/schema.ts:311](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L311), [src/core/ir/schema.ts:381](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L381), [src/core/ir/schema.ts:396](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L396)

## スカラーと参照の規約 {#scalar-contracts}

| Type | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `SecretRef` | string | value | `/^\\{\\{secrets\\.[A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)*\\}\\}$/` | 完全なシークレット参照。 | [src/core/ir/schema.ts:31](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L31), [src/core/ir/schema.ts:33](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L33), [src/core/ir/schema.ts:74](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L74) |
| `SecretSinkOrigin` | string | value | `/^https?:\\/\\/[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*(?::(?:6553[0-5]|655[0-2][0-9]|65[0-4][0-9]{2}|6[0-4][0-9]{3}|[1-5][0-9]{4}|[1-9][0-9]{0,3}))?$/`; no-secret pattern | HTTP(S)オリジンのみ。 | [src/core/ir/schema.ts:40](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L40), [src/core/ir/schema.ts:95-97](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L95-L97) |
| `InterpolatableText` | string | value | `/^(?![\\s\\S]*\\{\\{secrets\\.)[\\s\\S]*$/` | テキストはrunの補間を含み得るが、シークレットトークンを含まない。 | [src/core/ir/schema.ts:37](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L37), [src/core/ir/schema.ts:125](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L125) |
| `Citation` | string | value | min 1; max `4096` | 帰属前の正確なプロンプト部分文字列。 | [src/core/ir/schema.ts:273](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L273), [src/core/ir/schema.ts:279](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L279) |
| `JsonValue` | JSON scalar/array/object | value | RFC 8259 recursive union | メタデータまたはプロバイダの曖昧性の値。 | [src/core/ir/schema.ts:1167](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1167) |

`secretSinkOrigins` にシークレットのエントリが存在しない場合、そのシークレットのデフォルトは `baseUrl` となる。明示的な空配列はすべてのオリジンを拒否し、空でない配列はデフォルトを置き換える。[src/core/ir/schema.ts:152-157](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L152-L157) `SourceSpan` の順序付け、およびすべての `InstructionSourceSpan` のプロンプト座標チェックはセマンティックバリデーションである。[src/core/ir/schema.ts:254](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L254), [src/core/ir/schema.ts:328](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L328)

## 例 {#examples}

```json
{"strategy":"accessibility","role":"button","name":"Sign in"}
```

```json
{"algorithm":"a11y-neighborhood-v2","hash":"0000000000000000000000000000000000000000000000000000000000000000"}
```

## 設計根拠 {#rationale}

共有オブジェクトは、プラン、生成レスポンス、およびグラウンディングが、互換性のないロケータ、参照、および出所情報（provenance）を徐々に獲得していく問題を解決する。本設計は厳格なランタイム定義を1つのスキーマに配置し、そこから JSON Schema を導出する。

選択された設計は、値全体のシークレット参照および run 参照を通常のテキストから分離し、プロバイダの引用をコミットされたソーススパンから分離する。したがって、AIが生成した抜粋ではなくローカルコードが、永続的な出所情報（provenance）に対するオーソリティとなる。

却下された代替案の1つは、各ドキュメントでロケータとシークレットの構文を独立して定義することであった。レビューでは一見互換性があるように見える乖離（drift）を検出できないため、これは却下された。もう1つは、引用を永続的なオーソリティとして扱うことであった。プロンプト相対の検証は決定論的かつローカルでなければならないため、これは却下された。 
