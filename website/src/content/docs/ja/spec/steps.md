---
title: "ステップ"
description: "コミットされたすべてのステップは、`kind` によって判別される `Step` の厳格なブランチであり、すべてのブランチは `id: StepId` を持つ。"
---

## Step 共用体 {#step-union}

コミットされたすべてのステップは、`kind` によって判別される `Step` の厳格なブランチであり、すべてのブランチは `id: StepId` を持つ。[src/core/ir/schema.ts:404](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L404), [src/core/ir/schema.ts:742](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L742)

### 確認参照 {#confirmation-references}

アサーションまたは `ai` ステップは、成功時にそのグラウンディングを確認する、先行する `click`、`press`、`fill`、`fill-secret`、または `capture` ステップの ID を、空でない任意の `confirms` 配列に指定できる。未知の ID は `confirms-unknown-step`、同じ位置または後続のステップは `confirms-not-earlier`、対象外のステップは `confirms-not-action`、重複 ID は `confirms-duplicate`、Plan の順序に対して昇順でない ID は `confirms-unsorted` として報告される。ターゲットの同一性は検査しない。

### `action` / `click` {#action-click}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | `/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/` | Stable step identifier. | [src/core/ir/schema.ts:41](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L41), [src/core/ir/schema.ts:436](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L436) |
| `kind` | string | required | literal `action` | Outer discriminator. | [src/core/ir/schema.ts:438](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L438) |
| `target` | string | required | name in Plan `targets` | Execution Target. | repo:src/core/ir/schema.ts |
| `action` | string | required | literal `click` | Action discriminator. | [src/core/ir/schema.ts:439](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L439) |
| `intent` | `ElementIntent` | required | [値型](/ambercast/ja/spec/value-types/#shared-types) | プロンプトの根拠に結び付いた要素の記述。 | repo:src/core/ir/schema.ts:540 |

```json
{"id":"click-login","kind":"action","action":"click","target":"app","intent":{"description":"Click Log in","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":13}}}
```

### `action` / `navigate` {#action-navigate}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | Stable ID. | [src/core/ir/schema.ts:455](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L455) |
| `kind` | string | required | literal `action` | Outer discriminator. | [src/core/ir/schema.ts:457](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L457) |
| `action` | string | required | literal `navigate` | Action discriminator. | [src/core/ir/schema.ts:458](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L458) |
| `url` | `InterpolatableText` | required | no `{{secrets.` marker | Navigation text. | [src/core/ir/schema.ts:455](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L455) |

```json
{"id":"open-home","kind":"action","action":"navigate","target":"app","url":"https://example.test"}
```

実行時において、すべての Plan ナビゲーション、キャッシュされたトレースナビゲーション、および新規のエージェントによるナビゲーションは、稼働中のターゲットの `baseUrl` に対して解決され、HTTP(S) を使用し、かつそのターゲットのオリジン上にとどまらなければならない（MUST）。解決不能、非 HTTP(S)、またはクロスオリジンの宛先は整合性の失敗（integrity failure）である。[src/usecases/run.ts:701](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L701) [src/usecases/run.ts:746](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L746)

### `action` / `press` {#action-press}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | Stable ID. | [src/core/ir/schema.ts:474](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L474) |
| `kind` | string | required | literal `action` | Outer discriminator. | [src/core/ir/schema.ts:476](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L476) |
| `target` | string | required | name in Plan `targets` | Execution Target. | repo:src/core/ir/schema.ts |
| `action` | string | required | literal `press` | Action discriminator. | [src/core/ir/schema.ts:477](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L477) |
| `intent` | `ElementIntent` | required | [値型](/ambercast/ja/spec/value-types/#shared-types) | プロンプトの根拠に結び付いた要素の記述。 | repo:src/core/ir/schema.ts:574-579 |
| `key` | string | required | enum `Enter`, `Tab`, `Escape`, `ArrowDown`, `ArrowUp` | Key. | [src/core/ir/schema.ts:474](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L474) |

```json
{"id":"submit","kind":"action","action":"press","target":"app","intent":{"description":"Press Enter in Email","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":21}},"key":"Enter"}
```

### `action` / `fill` {#action-fill}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | Stable ID. | [src/core/ir/schema.ts:493](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L493) |
| `kind` | string | required | literal `action` | Outer discriminator. | [src/core/ir/schema.ts:495](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L495) |
| `target` | string | required | name in Plan `targets` | Execution Target. | repo:src/core/ir/schema.ts |
| `action` | string | required | literal `fill` | Action discriminator. | [src/core/ir/schema.ts:496](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L496) |
| `intent` | `ElementIntent` | required | [値型](/ambercast/ja/spec/value-types/#shared-types) | プロンプトの根拠に結び付いた要素の記述。 | repo:src/core/ir/schema.ts:594-599 |
| `value` | `InterpolatableText` | required | no secret marker | Non-secret or run-state text. | [src/core/ir/schema.ts:493](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L493) |

```json
{"id":"fill-email","kind":"action","action":"fill","target":"app","intent":{"description":"Fill Email","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":11}},"value":"a@example.test"}
```

### `action` / `fill-secret` {#action-fill-secret}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | Stable ID. | [src/core/ir/schema.ts:499-504](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L499-L504) |
| `kind` | string | required | literal `action` | Outer discriminator. | [src/core/ir/schema.ts:499-504](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L499-L504) |
| `target` | string | required | name in Plan `targets` | Execution Target. | repo:src/core/ir/schema.ts |
| `action` | string | required | literal `fill-secret` | Action discriminator. | [src/core/ir/schema.ts:499-504](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L499-L504) |
| `intent` | `ElementIntent` | required | [値型](/ambercast/ja/spec/value-types/#shared-types) | プロンプトの根拠に結び付いた要素の記述。 | repo:src/core/ir/schema.ts:617-622 |
| `secretRef` | `SecretRef` | required | whole secret-ref grammar | Secret value reference. | [src/core/ir/schema.ts:396](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L396), [src/core/ir/schema.ts:499-504](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L499-L504) |

```json
{"id":"fill-password","kind":"action","action":"fill-secret","target":"app","intent":{"description":"Fill Password","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":14}},"secretRef":"{{secrets.LOGIN_PASSWORD}}"}
```

### `assert` / `text-visible` {#assert-text-visible}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | Stable ID. | [src/core/ir/schema.ts:556](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L556) |
| `kind` | string | required | literal `assert` | Outer discriminator. | [src/core/ir/schema.ts:558](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L558) |
| `check` | string | required | literal `text-visible` | Assertion discriminator. | [src/core/ir/schema.ts:559](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L559) |
| `timeoutMs` | integer | optional | 0–120000 | Assertion retry deadline in milliseconds. | repo:src/core/ir/schema.ts |
| `text` | `InterpolatableText` | required | no secret marker | Expected visible text. | [src/core/ir/schema.ts:556](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L556) |
| `confirms` | `StepId[]` | optional | non-empty; earlier action-kind or capture steps in ascending Plan order | 成功時にグラウンディングを確認するステップ。 | repo:src/core/ir/schema.ts:521,663 |

```json
{"id":"welcome-visible","kind":"assert","check":"text-visible","target":"app","text":"Welcome"}
```

### `assert` / `element-visible` {#assert-element-visible}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | Stable ID. | [src/core/ir/schema.ts:575](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L575) |
| `kind` | string | required | literal `assert` | Outer discriminator. | [src/core/ir/schema.ts:577](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L577) |
| `target` | string | required | name in Plan `targets` | Execution Target. | repo:src/core/ir/schema.ts |
| `check` | string | required | literal `element-visible` | Assertion discriminator. | [src/core/ir/schema.ts:578](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L578) |
| `timeoutMs` | integer | optional | 0–120000 | Assertion retry deadline in milliseconds. | repo:src/core/ir/schema.ts |
| `intent` | `QuotedElementIntent` | required | [値型](/ambercast/ja/spec/value-types/#shared-types) | プロンプトの根拠に結び付いた要素の記述。 | repo:src/core/ir/schema.ts:680 |
| `confirms` | `StepId[]` | optional | non-empty; earlier action-kind or capture steps in ascending Plan order | 成功時にグラウンディングを確認するステップ。 | repo:src/core/ir/schema.ts:521,684 |

```json
{"id":"menu-visible","kind":"assert","check":"element-visible","target":"app","intent":{"description":"Main navigation 「Main」","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":23},"quote":{"text":"Main","sourceSpan":{"startLine":1,"startColumn":18,"endLine":1,"endColumn":22}}}}
```

### `assert` / `text-equals` {#assert-text-equals}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | Stable ID. | [src/core/ir/schema.ts:594](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L594) |
| `kind` | string | required | literal `assert` | Outer discriminator. | [src/core/ir/schema.ts:596](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L596) |
| `target` | string | required | name in Plan `targets` | Execution Target. | repo:src/core/ir/schema.ts |
| `check` | string | required | literal `text-equals` | Assertion discriminator. | [src/core/ir/schema.ts:597](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L597) |
| `timeoutMs` | integer | optional | 0–120000 | Assertion retry deadline in milliseconds. | repo:src/core/ir/schema.ts |
| `intent` | `QuotedElementIntent` | required | [値型](/ambercast/ja/spec/value-types/#shared-types) | プロンプトの根拠に結び付いた要素の記述。 | repo:src/core/ir/schema.ts:703 |
| `text` | `InterpolatableText` | required | no secret marker | Exact expected text. | [src/core/ir/schema.ts:594](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L594) |
| `confirms` | `StepId[]` | optional | non-empty; earlier action-kind or capture steps in ascending Plan order | 成功時にグラウンディングを確認するステップ。 | repo:src/core/ir/schema.ts:521,707 |

```json
{"id":"title","kind":"assert","check":"text-equals","target":"app","intent":{"description":"Account heading 「Account」","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":26},"quote":{"text":"Account","sourceSpan":{"startLine":1,"startColumn":18,"endLine":1,"endColumn":25}}},"text":"Account overview"}
```

### `assert` / `url-matches` {#assert-url-matches}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | Stable ID. | [src/core/ir/schema.ts:614](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L614) |
| `kind` | string | required | literal `assert` | Outer discriminator. | [src/core/ir/schema.ts:616](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L616) |
| `check` | string | required | literal `url-matches` | Assertion discriminator. | [src/core/ir/schema.ts:617](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L617) |
| `timeoutMs` | integer | optional | 0–120000 | Assertion retry deadline in milliseconds. | repo:src/core/ir/schema.ts |
| `pattern` | `InterpolatableText` | required | no secret marker | Expected URL matching text. | [src/core/ir/schema.ts:614](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L614) |
| `confirms` | `StepId[]` | optional | non-empty; earlier action-kind or capture steps in ascending Plan order | 成功時にグラウンディングを確認するステップ。 | repo:src/core/ir/schema.ts:521,730 |

```json
{"id":"on-account","kind":"assert","check":"url-matches","target":"app","pattern":"/account"}
```

### `assert` / `element-count` {#assert-element-count}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | Stable ID. | [src/core/ir/schema.ts:633](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L633) |
| `kind` | string | required | literal `assert` | Outer discriminator. | [src/core/ir/schema.ts:635](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L635) |
| `target` | string | required | name in Plan `targets` | Execution Target. | repo:src/core/ir/schema.ts |
| `check` | string | required | literal `element-count` | Assertion discriminator. | [src/core/ir/schema.ts:636](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L636) |
| `timeoutMs` | integer | optional | 0–120000 | Assertion retry deadline in milliseconds. | repo:src/core/ir/schema.ts |
| `intent` | `QuotedElementIntent` | required | [値型](/ambercast/ja/spec/value-types/#shared-types) | プロンプトの根拠に結び付いた要素の記述。 | repo:src/core/ir/schema.ts:749 |
| `count` | integer | required | nonnegative | Expected count, including zero. | [src/core/ir/schema.ts:633](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L633) |
| `confirms` | `StepId[]` | optional | non-empty; earlier action-kind or capture steps in ascending Plan order | 成功時にグラウンディングを確認するステップ。 | repo:src/core/ir/schema.ts:521,753 |

```json
{"id":"one-alert","kind":"assert","check":"element-count","target":"app","intent":{"description":"Error alerts 「Error」","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":21},"quote":{"text":"Error","sourceSpan":{"startLine":1,"startColumn":15,"endLine":1,"endColumn":20}}},"count":1}
```

### `capture` {#capture}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | Stable ID. | [src/core/ir/schema.ts:672](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L672) |
| `kind` | string | required | literal `capture` | Step discriminator. | [src/core/ir/schema.ts:674](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L674) |
| `target` | string | required | name in Plan `targets` | Execution Target. | repo:src/core/ir/schema.ts |
| `intent` | `ElementIntent` | required | [値型](/ambercast/ja/spec/value-types/#shared-types) | プロンプトの根拠に結び付いた要素の記述。 | repo:src/core/ir/schema.ts:788 |
| `variable` | `RunVariableName` | required | `/^[a-z][a-zA-Z0-9]*$/` | Bare run-state variable name. | [src/core/ir/schema.ts:675](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L675) |

```json
{"id":"capture-code","kind":"capture","target":"app","intent":{"description":"Capture Code","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":13}},"variable":"code"}
```

### `ai` {#ai}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | Stable ID. | [src/core/ir/schema.ts:404](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L404), [src/core/ir/schema.ts:416-420](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L416-L420) |
| `kind` | string | required | literal `ai` | Step discriminator. | [src/core/ir/schema.ts:418](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L418) |
| `instruction` | `InterpolatableText` | required | no secret marker | Agent instruction. | [src/core/ir/schema.ts:419](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L419) |
| `secrets` | `AiStepSecretUse[]` | optional | strict entries | Committed secret uses. | [src/core/ir/schema.ts:688-692](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L688-L692) |
| `instructionCoverage` | `InstructionCriterion[]` | required | min 1 | Locally attributed criteria. | [src/core/ir/schema.ts:688-692](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L688-L692) |
| `confirms` | `StepId[]` | optional | non-empty; earlier action-kind or capture steps in ascending Plan order | 成功時にグラウンディングを確認するステップ。 | repo:src/core/ir/schema.ts:521,824 |

```json
{"id":"complete-flow","kind":"ai","target":"app","instruction":"Finish checkout.","instructionCoverage":[{"id":"finish","kind":"success","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":17}}]}
```

### コミット済み AI シークレット使用 {#committed-ai-secret-grants}

コミット済み AI ステップの任意の `secrets` 配列の各要素は厳格な `AiStepSecretUse` であり、解決済み参照のみを記録する。同意および許可リスト認可は Plan の永続化前に行われ、Plan の来歴フィールドではない。[src/core/ir/schema.ts:667-692](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L667-L692) [src/usecases/generate.ts:1405-1493](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/generate.ts#L1405-L1493)

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `ref` | `SecretRef` | required | whole secret-reference grammar | Committed secret reference. | [src/core/ir/schema.ts:674-675](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L674-L675) |

```json
{"id":"complete-flow","kind":"ai","target":"app","instruction":"Finish checkout.","secrets":[{"ref":"{{secrets.CARD_NUMBER}}"}],"instructionCoverage":[{"id":"finish","kind":"success","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":17}}]}
```

アサーションの `element-visible`、`text-equals`、`element-count` はグラウンディングを参照も更新もせず、AI も呼び出さない。`--resolve` の有無にかかわらず、期限まで `accessibilitySnapshot()` と `matchQuotedCandidates` を使って同じように評価する。

## 生成形式 {#generated-forms}

生成された `click`、`press`、`fill`、`fill-secret`、`capture` の形式は `GeneratedElementIntent` を持ち、生成された `element-visible`、`text-equals`、`element-count` の形式は `GeneratedQuotedElementIntent` を持つ。

| object | field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `GeneratedFillSecretAction` | `id`, `kind`, `action`, `target` | as committed fill-secret except `secretRef` | required | `kind: action`, `action: fill-secret` | ローカル命名を待つプロバイダー形式。 | [src/core/ir/schema.ts:773-805](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L773-L805) |
|  | `secret` | `SecretNameChoice` | optional | strict choice | 既存の許可リスト名の要求または新しい名前のヒント。 | [src/core/ir/schema.ts:104-115,779-785](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L104-L115) |
| `GeneratedAiStepSecretUse` | choice | `SecretNameChoice` or `{}` | required per array member | strict choice or no provider preference | ローカル解決を待つプロバイダー命名意図。 | [src/core/ir/schema.ts:813-821](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L813-L821) |
| `GeneratedAiStep` | `id`, `kind`, `instruction` | as committed AI | required | `kind: ai` | 共有AIコントラクト。 | [src/core/ir/schema.ts:814](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L814) |
|  | `secrets` | generated uses[] | optional | strict entries | 保留中のシークレット名解決。 | [src/core/ir/schema.ts:824-833](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L824-L833) |
|  | `instructionCoverage` | generated criteria[] | required | min 1 | 保留中の基準帰属。 | [src/core/ir/schema.ts:817](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L817) |
|  | `verificationIntent` | `VerificationIntent[]` | required | min 1 in strict form | 一時的な検証提案。 | [src/core/ir/schema.ts:818](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L818) |

## 設計根拠 {#rationale}

問題は、特に UI が誤った合格（wrong pass）を生じさせ得る箇所において、アクションが証明と誤認されるのを防ぐことである。明示的なアサーションブランチにより、観測された成功基準が検査可能になる。

選択された判別共用体により、すべてのオペコードに閉じたフィールド規約が与えられ、シークレットの投入が通常のテキストから分離される。プロバイダーの命名意図は、計画がコミットされる前にローカルで解決され同意される。

プロバイダが提供する anchor と列の座標は、各基準をローカルで解決された 1 つのプロンプト抜粋にバインドする。4 座標の `InstructionSourceSpan` へのローカル解決により、コミットされる帰属付けが正確なものとなる一方、プロバイダの `citation` はその解決を確認するチェックサムに過ぎず、結合キーとしては使われない。 [src/usecases/instruction-coverage-policy.ts:407-443](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/instruction-coverage-policy.ts#L407-L443)

末尾の `url-matches` は、引用された成功基準の独立した証明ではなく同義反復的な成功形式であるため、拒絶される。サポートされている重複のない末尾の `TraceAssert` を使用する。成功条件を表現できない場合、生成は失敗する。 [src/usecases/instruction-coverage-policy.ts:403-407](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/instruction-coverage-policy.ts#L403-L407) [src/usecases/instruction-coverage-policy.ts:622-625](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/instruction-coverage-policy.ts#L622-L625)

却下された代替案の 1 つは、任意のペイロードフィールドを持つ 1 つのアクションオブジェクトを使用するものであったが、無効な組み合わせがスキーマ上で不可視になるため却下された。もう 1 つは一般的なテキストにシークレットを含めることを許容するものであったが、シークレットの来歴とマスキング（redaction）が曖昧になるため却下された。 
