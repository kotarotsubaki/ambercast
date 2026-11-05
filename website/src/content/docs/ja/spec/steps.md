---
title: "ステップ"
description: "この章は、コミットするすべてのステップの種類とそのフィールドおよび例、ならびにローカル生成がコミット済みステップに変換する生成形式を定義する。"
---

## Step 共用体 {#step-union}

コミットするすべてのステップは `Step` の厳格な分岐であり、`kind` で判別する。どの分岐も `id: StepId` を持ち、`Plan.targets` のキーを指す `target` を必須とする（`src/core/ir/schema.ts:561,930`）。

## 確認参照 {#confirmation-references}

アサーションまたは `ai` ステップは、空でない `confirms` 配列を持てる。この配列は、成功したときにそのグラウンディングを確認する、先行する `click`、`press`、`fill`、`fill-secret`、`capture` のステップを指す。`generate` と `heal` は、検証の前に `navigate` ステップを指す `confirms` の参照を取り除く。検証が報告するコードは次の 5 つである。詳細は[適合性](/ambercast/ja/spec/conformance/#semantic-validation)を参照。ターゲットの同一性は検査しない（`src/core/ir/confirms-validation.ts:45`、`src/core/ir/confirms-validation.ts:96`）。

- `confirms-unknown-step`: 未知の ID。
- `confirms-not-earlier`: 同じステップまたは後続のステップ。
- `confirms-not-action`: 対象にならないステップ。
- `confirms-duplicate`: 重複した ID。
- `confirms-unsorted`: ID が計画（plan）内の昇順でない。

## `action` / `click` {#action-click}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | `/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/` | 安定したステップ ID。 | `src/core/ir/schema.ts:41,561` |
| `kind` | string | required | literal `action` | 外側の判別子。 | `src/core/ir/schema.ts:613` |
| `target` | string | required | name in Plan `targets` | 実行ターゲット。 | `src/core/ir/schema.ts:561` |
| `action` | string | required | literal `click` | アクションの判別子。 | `src/core/ir/schema.ts:614` |
| `intent` | `ElementIntent` | required | [値型](/ambercast/ja/spec/value-types/#shared-types) | プロンプトの根拠に結び付いた要素の記述。 | `src/core/ir/schema.ts:573` |

```json
{"id":"click-login","kind":"action","action":"click","target":"app","intent":{"description":"Click Log in","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":13}}}
```

## `action` / `navigate` {#action-navigate}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | 安定した ID。 | `src/core/ir/schema.ts:41,561` |
| `kind` | string | required | literal `action` | 外側の判別子。 | `src/core/ir/schema.ts:632` |
| `action` | string | required | literal `navigate` | アクションの判別子。 | `src/core/ir/schema.ts:633` |
| `url` | `InterpolatableText` | required | no `{{secrets.` marker | ナビゲーション先のテキスト。 | `src/core/ir/schema.ts:566` |

```json
{"id":"open-home","kind":"action","action":"navigate","target":"app","url":"https://example.test"}
```

実行時には、計画、キャッシュしたトレース、新規のエージェントのどのナビゲーションも、次を満たさなければならない（MUST）。

- 稼働中のターゲットの `baseUrl` を基準に解決する。
- HTTP(S) を使う。
- そのターゲットのオリジンにとどまる。

解決できない宛先、HTTP(S) 以外の宛先、別オリジンの宛先は、整合性の失敗である（`src/usecases/run.ts:993`）。

## `action` / `press` {#action-press}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | 安定した ID。 | `src/core/ir/schema.ts:41,561` |
| `kind` | string | required | literal `action` | 外側の判別子。 | `src/core/ir/schema.ts:652` |
| `target` | string | required | name in Plan `targets` | 実行ターゲット。 | `src/core/ir/schema.ts:561` |
| `action` | string | required | literal `press` | アクションの判別子。 | `src/core/ir/schema.ts:653` |
| `intent` | `ElementIntent` | required | [値型](/ambercast/ja/spec/value-types/#shared-types) | プロンプトの根拠に結び付いた要素の記述。 | `src/core/ir/schema.ts:574` |
| `key` | string | required | enum `Enter`, `Tab`, `Escape`, `ArrowDown`, `ArrowUp` | キー。 | `src/core/ir/schema.ts:569` |

```json
{"id":"submit","kind":"action","action":"press","target":"app","intent":{"description":"Press Enter in Email","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":21}},"key":"Enter"}
```

## `action` / `fill` {#action-fill}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | 安定した ID。 | `src/core/ir/schema.ts:41,561` |
| `kind` | string | required | literal `action` | 外側の判別子。 | `src/core/ir/schema.ts:672` |
| `target` | string | required | name in Plan `targets` | 実行ターゲット。 | `src/core/ir/schema.ts:561` |
| `action` | string | required | literal `fill` | アクションの判別子。 | `src/core/ir/schema.ts:673` |
| `intent` | `ElementIntent` | required | [値型](/ambercast/ja/spec/value-types/#shared-types) | プロンプトの根拠に結び付いた要素の記述。 | `src/core/ir/schema.ts:575` |
| `value` | `InterpolatableText` | required | no secret marker | シークレットでないテキスト、または実行状態のテキスト。 | `src/core/ir/schema.ts:571` |

```json
{"id":"fill-email","kind":"action","action":"fill","target":"app","intent":{"description":"Fill Email","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":11}},"value":"a@example.test"}
```

## `action` / `fill-secret` {#action-fill-secret}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | 安定した ID。 | `src/core/ir/schema.ts:41,561` |
| `kind` | string | required | literal `action` | 外側の判別子。 | `src/core/ir/schema.ts:695` |
| `target` | string | required | name in Plan `targets` | 実行ターゲット。 | `src/core/ir/schema.ts:561` |
| `action` | string | required | literal `fill-secret` | アクションの判別子。 | `src/core/ir/schema.ts:696` |
| `intent` | `ElementIntent` | required | [値型](/ambercast/ja/spec/value-types/#shared-types) | プロンプトの根拠に結び付いた要素の記述。 | `src/core/ir/schema.ts:576` |
| `secretRef` | `SecretRef` | required | whole secret-ref grammar | シークレット値への参照。 | `src/core/ir/schema.ts:108,572` |

```json
{"id":"fill-password","kind":"action","action":"fill-secret","target":"app","intent":{"description":"Fill Password","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":14}},"secretRef":"{{secrets.LOGIN_PASSWORD}}"}
```

## `assert` / `text-visible` {#assert-text-visible}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | 安定した ID。 | `src/core/ir/schema.ts:41,561` |
| `kind` | string | required | literal `assert` | 外側の判別子。 | `src/core/ir/schema.ts:735` |
| `check` | string | required | literal `text-visible` | アサーションの判別子。 | `src/core/ir/schema.ts:736` |
| `timeoutMs` | integer | optional | 0–120000 | アサーションの再試行の締切（ミリ秒）。 | `src/core/ir/schema.ts:601` |
| `text` | `InterpolatableText` | required | no secret marker | 表示されると期待するテキスト。 | `src/core/ir/schema.ts:587` |
| `confirms` | `StepId[]` | optional | non-empty; earlier action-kind or capture steps in ascending Plan order | 成功時にグラウンディングを確認するステップ。 | `src/core/ir/schema.ts:597` |

```json
{"id":"welcome-visible","kind":"assert","check":"text-visible","target":"app","text":"Welcome"}
```

## `assert` / `element-visible` {#assert-element-visible}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | 安定した ID。 | `src/core/ir/schema.ts:41,561` |
| `kind` | string | required | literal `assert` | 外側の判別子。 | `src/core/ir/schema.ts:756` |
| `target` | string | required | name in Plan `targets` | 実行ターゲット。 | `src/core/ir/schema.ts:561` |
| `check` | string | required | literal `element-visible` | アサーションの判別子。 | `src/core/ir/schema.ts:757` |
| `timeoutMs` | integer | optional | 0–120000 | アサーションの再試行の締切（ミリ秒）。 | `src/core/ir/schema.ts:601` |
| `intent` | `QuotedElementIntent` | required | [値型](/ambercast/ja/spec/value-types/#shared-types) | プロンプトの根拠に結び付いた要素の記述。 | `src/core/ir/schema.ts:594` |
| `confirms` | `StepId[]` | optional | non-empty; earlier action-kind or capture steps in ascending Plan order | 成功時にグラウンディングを確認するステップ。 | `src/core/ir/schema.ts:597` |

```json
{"id":"menu-visible","kind":"assert","check":"element-visible","target":"app","intent":{"description":"Main navigation 「Main」","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":23},"quote":{"text":"Main","sourceSpan":{"startLine":1,"startColumn":18,"endLine":1,"endColumn":22}}}}
```

## `assert` / `text-equals` {#assert-text-equals}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | 安定した ID。 | `src/core/ir/schema.ts:41,561` |
| `kind` | string | required | literal `assert` | 外側の判別子。 | `src/core/ir/schema.ts:779` |
| `target` | string | required | name in Plan `targets` | 実行ターゲット。 | `src/core/ir/schema.ts:561` |
| `check` | string | required | literal `text-equals` | アサーションの判別子。 | `src/core/ir/schema.ts:780` |
| `timeoutMs` | integer | optional | 0–120000 | アサーションの再試行の締切（ミリ秒）。 | `src/core/ir/schema.ts:601` |
| `intent` | `QuotedElementIntent` | required | [値型](/ambercast/ja/spec/value-types/#shared-types) | プロンプトの根拠に結び付いた要素の記述。 | `src/core/ir/schema.ts:595` |
| `text` | `InterpolatableText` | required | no secret marker | 期待する完全一致のテキスト。 | `src/core/ir/schema.ts:591` |
| `confirms` | `StepId[]` | optional | non-empty; earlier action-kind or capture steps in ascending Plan order | 成功時にグラウンディングを確認するステップ。 | `src/core/ir/schema.ts:597` |

```json
{"id":"title","kind":"assert","check":"text-equals","target":"app","intent":{"description":"Account heading 「Account」","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":26},"quote":{"text":"Account","sourceSpan":{"startLine":1,"startColumn":18,"endLine":1,"endColumn":25}}},"text":"Account overview"}
```

## `assert` / `url-matches` {#assert-url-matches}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | 安定した ID。 | `src/core/ir/schema.ts:41,561` |
| `kind` | string | required | literal `assert` | 外側の判別子。 | `src/core/ir/schema.ts:802` |
| `check` | string | required | literal `url-matches` | アサーションの判別子。 | `src/core/ir/schema.ts:803` |
| `timeoutMs` | integer | optional | 0–120000 | アサーションの再試行の締切（ミリ秒）。 | `src/core/ir/schema.ts:601` |
| `pattern` | `InterpolatableText` | required | no secret marker | 期待する URL に一致させるテキスト。 | `src/core/ir/schema.ts:592` |
| `confirms` | `StepId[]` | optional | non-empty; earlier action-kind or capture steps in ascending Plan order | 成功時にグラウンディングを確認するステップ。 | `src/core/ir/schema.ts:597` |

```json
{"id":"on-account","kind":"assert","check":"url-matches","target":"app","pattern":"/account"}
```

## `assert` / `element-count` {#assert-element-count}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | 安定した ID。 | `src/core/ir/schema.ts:41,561` |
| `kind` | string | required | literal `assert` | 外側の判別子。 | `src/core/ir/schema.ts:825` |
| `target` | string | required | name in Plan `targets` | 実行ターゲット。 | `src/core/ir/schema.ts:561` |
| `check` | string | required | literal `element-count` | アサーションの判別子。 | `src/core/ir/schema.ts:826` |
| `timeoutMs` | integer | optional | 0–120000 | アサーションの再試行の締切（ミリ秒）。 | `src/core/ir/schema.ts:601` |
| `intent` | `QuotedElementIntent` | required | [値型](/ambercast/ja/spec/value-types/#shared-types) | プロンプトの根拠に結び付いた要素の記述。 | `src/core/ir/schema.ts:596` |
| `count` | integer | required | nonnegative | 期待する個数（0 を含む）。 | `src/core/ir/schema.ts:593` |
| `confirms` | `StepId[]` | optional | non-empty; earlier action-kind or capture steps in ascending Plan order | 成功時にグラウンディングを確認するステップ。 | `src/core/ir/schema.ts:597` |

```json
{"id":"one-alert","kind":"assert","check":"element-count","target":"app","intent":{"description":"Error alerts 「Error」","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":21},"quote":{"text":"Error","sourceSpan":{"startLine":1,"startColumn":15,"endLine":1,"endColumn":20}}},"count":1}
```

## アサーションのポーリング {#assertion-polling}

アサーションの検査は、観測に失敗した後、ステップの締切まで最大 100ms の間隔でポーリングする。`timeoutMs` はこの締切について Target の `resolveTimeoutMs` を上書きし、0 でも 1 回は評価する。

ポーリングは、初回バインディングの第 1 段階、計画のアサーション、AI によるアサーションのツールに適用する。トレース再生の 2 つの判定、すなわちイベントの判定と検証の判定にも適用する。計画のアサーションには、3 種類の引用要素の検査と、`text-visible` と `url-matches` のブラウザ検査の経路が含まれる。AI によるアサーションのツールとトレース再生は、Target の `resolveTimeoutMs` を使う。これらはいずれも、締切に届く待機の後に最後の観測を 1 回行い、その観測が結果を決める。

`element-visible`、`text-equals`、`element-count` は、グラウンディングを参照せず、更新せず、AI も呼び出さない。`--resolve` の有無にかかわらず、締切まで `accessibilitySnapshot()` と `matchQuotedCandidates` でポーリングする（`src/usecases/run.ts:3071-3184`）。

## `capture` {#capture}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | 安定した ID。 | `src/core/ir/schema.ts:41,561` |
| `kind` | string | required | literal `capture` | ステップの判別子。 | `src/core/ir/schema.ts:866` |
| `target` | string | required | name in Plan `targets` | 実行ターゲット。 | `src/core/ir/schema.ts:561` |
| `intent` | `ElementIntent` | required | [値型](/ambercast/ja/spec/value-types/#shared-types) | プロンプトの根拠に結び付いた要素の記述。 | `src/core/ir/schema.ts:867` |
| `variable` | `RunVariableName` | required | `/^[a-z][a-zA-Z0-9]*$/` | 実行状態の変数名（接頭辞なし）。 | `src/core/ir/schema.ts:868` |

```json
{"id":"capture-code","kind":"capture","target":"app","intent":{"description":"Capture Code","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":13}},"variable":"code"}
```

## `ai` {#ai}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | 安定した ID。 | `src/core/ir/schema.ts:41,561` |
| `kind` | string | required | literal `ai` | ステップの判別子。 | `src/core/ir/schema.ts:582` |
| `instruction` | `InterpolatableText` | required | no secret marker | エージェントへの指示。 | `src/core/ir/schema.ts:583` |
| `secrets` | `AiStepSecretUse[]` | optional | strict entries | コミット済みのシークレット使用。 | `src/core/ir/schema.ts:901` |
| `instructionCoverage` | `InstructionCriterion[]` | required | min 1 | ローカルで帰属させた基準。 | `src/core/ir/schema.ts:902` |
| `confirms` | `StepId[]` | optional | non-empty; earlier action-kind or capture steps in ascending Plan order | 成功時にグラウンディングを確認するステップ。 | `src/core/ir/schema.ts:900` |

```json
{"id":"complete-flow","kind":"ai","target":"app","instruction":"Finish checkout.","instructionCoverage":[{"id":"finish","kind":"success","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":17}}]}
```

## コミット済み AI シークレット使用 {#committed-ai-secret-grants}

コミット済みの AI ステップの任意の `secrets` 配列の各要素は、厳格な `AiStepSecretUse` であり、解決済みの参照だけを記録する。同意と許可リストによる認可は計画の永続化より前に行われ、計画の来歴フィールドではない（`src/core/ir/schema.ts:883,898-903`、`src/usecases/generate.ts:1652-1728`）。

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `ref` | `SecretRef` | required | whole secret-reference grammar | コミット済みのシークレット参照。 | `src/core/ir/schema.ts:883` |

```json
{"id":"complete-flow","kind":"ai","target":"app","instruction":"Finish checkout.","secrets":[{"ref":"{{secrets.CARD_NUMBER}}"}],"instructionCoverage":[{"id":"finish","kind":"success","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":17}}]}
```

## 生成形式 {#generated-forms}

生成された `click`、`press`、`fill`、`fill-secret`、`capture` の形式は `GeneratedElementIntent` を持ち、生成された `element-visible`、`text-equals`、`element-count` の形式は `GeneratedQuotedElementIntent` を持つ。どちらも、[値型](/ambercast/ja/spec/value-types/#shared-types)の共有されたコミット済みの形に、ローカルで帰属させる（`src/core/ir/schema.ts:435-457,985-1166`）。

| object | field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `GeneratedFillSecretAction` | `id`, `kind`, `action`, `target` | as committed fill-secret except `secretRef` | required | `kind: action`, `action: fill-secret` | ローカル命名を待つプロバイダー形式。 | `src/core/ir/schema.ts:1022-1029` |
|  | `secret` | `SecretNameChoice` | optional | strict choice | 既存の許可リスト名の要求または新しい名前のヒント。 | `src/core/ir/schema.ts:144-147,1028` |
| `GeneratedAiStepSecretUse` | choice | `SecretNameChoice` or `{}` | required per array member | strict choice or no provider preference | ローカル解決を待つプロバイダー命名意図。 | `src/core/ir/schema.ts:1146` |
| `GeneratedAiStep` | `id`, `kind`, `instruction` | as committed AI | required | `kind: ai` | 共有AIコントラクト。 | `src/core/ir/schema.ts:1156` |
|  | `secrets` | generated uses[] | optional | strict entries | 保留中のシークレット名解決。 | `src/core/ir/schema.ts:1157` |
|  | `instructionCoverage` | generated criteria[] | required | min 1 | 保留中の基準帰属。 | `src/core/ir/schema.ts:1158` |
|  | `verificationIntent` | `VerificationIntent[]` | required | min 1 in strict form | 一時的な検証提案。 | `src/core/ir/schema.ts:1159` |

## 設計根拠 {#rationale}

課題は、特に UI が誤った合格（wrong pass）を生み得る場面で、アクションが証明と取り違えられるのを防ぐことである。明示的なアサーションの分岐は、観測した成功基準を検査できるようにする。

採用した判別共用体は、すべてのオペコードに閉じたフィールドの契約を与え、シークレットの入力を通常のテキストから分ける。プロバイダーの命名意図は、計画をコミットする前にローカルで解決し、同意を得る。

プロバイダーが渡すアンカーと列の座標は、各基準を、ローカルで解決した 1 つのプロンプトの抜粋に結び付ける。4 座標の `InstructionSourceSpan` に対するローカルの解決が、コミットする帰属を正確にする。プロバイダーの `citation` は、その解決を確かめるチェックサムにすぎず、結合キーではない（`src/usecases/instruction-coverage-policy.ts:405-479`）。

末尾の `url-matches` は、引用した成功基準の独立した証明ではなく、自明に成り立つ成功の形であるため、拒否する。サポートされていて重複しない、末尾の `TraceAssert` を使う。成功条件を表現できない場合、生成は失敗する（`src/usecases/instruction-coverage-policy.ts:468-469`、`src/usecases/instruction-coverage-policy.ts:630-631`）。

却下した代替案の 1 つは、任意のペイロードフィールドを持つ単一のアクションオブジェクトである。無効な組み合わせがスキーマから見えなくなるため、却下した。もう 1 つは、汎用のテキストにシークレットを載せることである。同意の境界とマスキングが曖昧になるため、却下した。
