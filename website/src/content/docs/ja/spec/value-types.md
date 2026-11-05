---
title: "値型"
description: "この章は、他の章が名前で参照する共有オブジェクトとスカラーの契約を定義する。"
---

## 共有型 {#shared-types}

他のすべての章は、形状を再記述せず、これらの定義を使わなければならない（MUST）。以下のオブジェクトはすべて厳格であり、未知のプロパティを拒絶しなければならない（MUST）（`src/core/ir/schema.ts:231`、`src/core/ir/schema.ts:254`）。正規表現は、実行時の正本からそのまま引用する。

| Type | field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `TargetDefinition` | `baseUrl` | string | required | `/^https?:\/\/[^\s/?#]\S*$/`; `/^(?![\s\S]*\{\{secrets\.)[\s\S]*$/` | シークレットマーカーを含まない、作成されたHTTP(S)ベースURL。 | `src/core/ir/schema.ts:37-38,233` |
|  | `surface` | string | required | literal `web` | 実行サーフェス。 | `src/core/ir/schema.ts:232` |
|  | `secretSinkOrigins` | record `SecretRef` → `SecretSinkOrigin[]` | optional | See scalar table | シークレットごとの許可されたオリジン。 | `src/core/ir/schema.ts:234` |
|  | `locale` | string | optional | min length 1 | config loader が正規化した後の BCP-47 形式の locale タグ。 | `src/core/ir/schema.ts:235` |
| `AccessibilityElementRef` | `strategy` | string | required | literal `accessibility` | ロケータ判別子。 | `src/core/ir/schema.ts:254` |
|  | `role` | string | required | min 1 | 正確なアクセシビリティロール。 | `src/core/ir/schema.ts:256` |
|  | `name` | string | required | min 1 | アクセシブル名。 | `src/core/ir/schema.ts:257` |
| `GroundingElementLocator` | `strategy` | string | required | literal `accessibility` | ロケータ判別子。 | `src/core/ir/schema.ts:276` |
|  | `role` | string | required | min 1 | 完全一致のアクセシビリティロール。 | `src/core/ir/schema.ts:278` |
|  | `name` | string | required | may be empty | 空文字は accessible name を持たない要素を表し、正規化後の名前が空のノードにだけ一致する。 | `src/core/ir/schema.ts:279` |
| `Quote` | `text` | string | required | min 1; max 4096; no-secrets-literal pattern | 引用された抜粋のリテラルテキスト。 | `src/core/ir/schema.ts:407` |
|  | `sourceSpan` | `InstructionSourceSpan` | required | strict nested object | 引用された抜粋の位置。 | `src/core/ir/schema.ts:408` |
| `ElementIntent` | `description` | string | required | min 1; max 4096; no-secrets-literal pattern | プロンプトの根拠に結び付いた自然言語の要素記述。 | `src/core/ir/schema.ts:415` |
|  | `sourceSpan` | `InstructionSourceSpan` | required | strict nested object | 記述の抜粋位置。 | `src/core/ir/schema.ts:416` |
|  | `roleHint` | string | optional | `/^[a-z]+$/` | 任意の小文字アクセシビリティロールのヒント。 | `src/core/ir/schema.ts:417` |
|  | `quote` | `Quote` | optional | strict nested object | プロンプト内の位置を独立して特定した任意の UI テキスト引用。 | `src/core/ir/schema.ts:418` |
| `QuotedElementIntent` (`ElementIntent` を拡張) | `quote` | `Quote` | required | strict nested object | 必須の UI テキスト引用。 | `src/core/ir/schema.ts:424` |
| `Fingerprint` | `algorithm` | string | required | literal `a11y-neighborhood-v2` | ロケータエビデンスの形式。 | `src/core/ir/schema.ts:320` |
|  | `hash` | string | required | `/^[0-9a-f]{64}$/` | 小文字のSHA-256。 | `src/core/ir/schema.ts:35,321` |
| `InstructionSourceSpan` | `startLine` | integer | required | positive | 1始まりのUTF-16開始行。 | `src/core/ir/schema.ts:372` |
|  | `startColumn` | integer | required | positive | 1始まりのUTF-16開始列。 | `src/core/ir/schema.ts:373` |
|  | `endLine` | integer | required | positive | 1始まりのUTF-16終了行。 | `src/core/ir/schema.ts:374` |
|  | `endColumn` | integer | required | positive | 境界を含まないUTF-16終了列。 | `src/core/ir/schema.ts:375` |
| `GeneratedInstructionCriterion` | `id` | string | required | `STEP_ID_PATTERN` | 帰属待ちのクライテリア。 | `src/core/ir/schema.ts:393` |
|  | `kind` | string | required | enum `success`, `action` | 節の役割。 | `src/core/ir/schema.ts:394` |
|  | `startAnchor` | string | required | none (format and range checked by usecase policy) | プロバイダーが主張する開始行アンカー（`L<n>`）。 | `src/core/ir/schema.ts:395` |
|  | `startColumn` | integer | required | none (range checked by usecase policy) | プロバイダーが主張する1始まりのUTF-16開始列。 | `src/core/ir/schema.ts:396` |
|  | `endAnchor` | string | required | none (format and range checked by usecase policy) | プロバイダーが主張する終了行アンカー（`L<n>`）。 | `src/core/ir/schema.ts:397` |
|  | `endColumn` | integer | required | none (range checked by usecase policy) | プロバイダーが主張する境界を含まないUTF-16終了列。 | `src/core/ir/schema.ts:398` |
|  | `citation` | string | required | min 1; max `4096` | プロバイダの逐語的な抜粋(チェックサム専用で位置特定には使われない)。 | `src/core/ir/schema.ts:399` |
| `InstructionCriterion` | `id` | string | required | `STEP_ID_PATTERN` | 確定されたクライテリアID。 | `src/core/ir/schema.ts:506` |
|  | `kind` | string | required | enum `success`, `action` | 節の役割。 | `src/core/ir/schema.ts:507` |
|  | `sourceSpan` | `InstructionSourceSpan` | required | strict nested object | ローカルで導出されたプロンプト位置。 | `src/core/ir/schema.ts:508` |
| `SecretNameChoice` | `allowedName` | `SecretName` | exclusive alternative | strict one-field object | 投影済み許可リスト名を再利用するプロバイダー要求。 | `src/core/ir/schema.ts:144-147` |
|  | `nameHint` | `SecretNameHint` | exclusive alternative | strict one-field object | 新たに発見した名前に対するプロバイダー提案。 | `src/core/ir/schema.ts:144-147` |

`ElementRef` は、現在 `AccessibilityElementRef` だけを持つ。`HexSha256` は `/^[0-9a-f]{64}$/` である。`StepId` と `InstructionCriterionId` は `/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/` である。`RunVariableName` は `/^[a-z][a-zA-Z0-9]*$/` である。`RunRef` は `/^\{\{run\.[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*\}\}$/` である（`src/core/ir/schema.ts:35,41,42,43,290,335,353,520,535`）。

## スカラーと参照の契約 {#scalar-contracts}

| Type | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `SecretRef` | string | value | `/^\{\{secrets\.[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*\}\}$/` | 完全なシークレット参照。 | `src/core/ir/schema.ts:32,33,108` |
| `SecretName` | string | value | `/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/` | 同意と構成で使用する裸の論理名。 | `src/core/ir/schema.ts:32,123` |
| `SecretNameHint` | string | value | `/^[a-z][a-z0-9_]{0,63}$/` | プロバイダーのフォールバック命名候補であり、コミット済み参照ではない。 | `src/core/ir/schema.ts:133` |
| `SecretSinkOrigin` | string | value | `/^https?:\/\/[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*(?::(?:6553[0-5]\|655[0-2][0-9]\|65[0-4][0-9]{2}\|6[0-4][0-9]{3}\|[1-5][0-9]{4}\|[1-9][0-9]{0,3}))?$/`; no-secret pattern | HTTP(S)オリジンのみ。 | `src/core/ir/schema.ts:40,163-165` |
| `InterpolatableText` | string | value | `/^(?![\s\S]*\{\{secrets\.)[\s\S]*$/` | テキストはrunの補間を含み得るが、シークレットトークンを含まない。 | `src/core/ir/schema.ts:37,193` |
| `Citation` | string | value | min 1; max `4096` | 帰属前の正確なプロンプト部分文字列。 | `src/core/ir/schema.ts:342,399` |
| `JsonValue` | JSON scalar/array/object | value | RFC 8259 recursive union | メタデータまたはプロバイダの曖昧性の値。 | `src/core/ir/schema.ts:1516` |

`secretSinkOrigins` にシークレットのエントリがなければ、そのシークレットの既定は `baseUrl` になる。明示した空配列はすべてのオリジンを拒否し、空でない配列は既定を置き換える（`src/core/ir/schema.ts:220-223`）。`InstructionSourceSpan` のプロンプト座標の検査は、すべてセマンティック検証である（`src/usecases/instruction-coverage-policy.ts:501-531`）。

## 例 {#examples}

```json
{"strategy":"accessibility","role":"button","name":"Sign in"}
```

```json
{"algorithm":"a11y-neighborhood-v2","hash":"0000000000000000000000000000000000000000000000000000000000000000"}
```

## 設計根拠 {#rationale}

共有オブジェクトは、計画（plan）、生成レスポンス、グラウンディングが、互換性のないロケータ、参照、来歴を少しずつ持ち込む問題を解決する。この設計は、厳格な実行時の定義を 1 つのスキーマに置き、JSON Schema をそこから導出する。

採用した設計は、値全体のシークレット参照と run 参照を通常のテキストから分け、プロバイダーの命名意図をコミット済みのシークレット参照から分ける。永続的な認可の権威は、AI が作った参照ではなく、ローカルの命名と同意にある。

却下した代替案の 1 つは、ドキュメントごとにロケータとシークレットの構文を独立に定義することである。レビューでは、一見互換に見える乖離を見つけられないため、却下した。もう 1 つは、引用を永続的な権威として扱うことである。プロンプトに対する検証は、決定的でローカルでなければならないため、却下した。
