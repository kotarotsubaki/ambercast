---
title: "ステップ"
description: "コミットされたすべてのステップは、`kind` によって判別される `Step` の厳格なブランチであり、すべてのブランチは `id: StepId` を持つ。"
---

## Step 共用体 {#step-union}

コミットされたすべてのステップは、`kind` によって判別される `Step` の厳格なブランチであり、すべてのブランチは `id: StepId` を持つ。[src/core/ir/schema.ts:404](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L404), [src/core/ir/schema.ts:742](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L742)

### `action` / `click` {#action-click}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | `/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/` | 安定したステップ識別子。 | [src/core/ir/schema.ts:41](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L41), [src/core/ir/schema.ts:436](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L436) |
| `kind` | string | required | literal `action` | 外部識別子。 | [src/core/ir/schema.ts:438](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L438) |
| `action` | string | required | literal `click` | アクション識別子。 | [src/core/ir/schema.ts:439](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L439) |
| `target` | `ElementRef` | required | accessibility branch currently | クリック対象のエレメント。 | [src/core/ir/schema.ts:436](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L436) |

```json
{"id":"click-login","kind":"action","action":"click","target":{"strategy":"accessibility","role":"button","name":"Log in"}}
```

### `action` / `navigate` {#action-navigate}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | 安定したID。 | [src/core/ir/schema.ts:455](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L455) |
| `kind` | string | required | literal `action` | 外部識別子。 | [src/core/ir/schema.ts:457](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L457) |
| `action` | string | required | literal `navigate` | アクション識別子。 | [src/core/ir/schema.ts:458](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L458) |
| `url` | `InterpolatableText` | required | no `{{secrets.` marker | ナビゲーションテキスト。 | [src/core/ir/schema.ts:455](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L455) |

```json
{"id":"open-home","kind":"action","action":"navigate","url":"https://example.test"}
```

実行時において、すべての Plan ナビゲーション、キャッシュされたトレースナビゲーション、および新規のエージェントによるナビゲーションは、稼働中のターゲットの `baseUrl` に対して解決され、HTTP(S) を使用し、かつそのターゲットのオリジン上にとどまらなければならない（MUST）。解決不能、非 HTTP(S)、またはクロスオリジンの宛先は整合性の失敗（integrity failure）である。[src/usecases/run.ts:701](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L701) [src/usecases/run.ts:746](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L746)

### `action` / `press` {#action-press}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | 安定したID。 | [src/core/ir/schema.ts:474](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L474) |
| `kind` | string | required | literal `action` | 外部識別子。 | [src/core/ir/schema.ts:476](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L476) |
| `action` | string | required | literal `press` | アクション識別子。 | [src/core/ir/schema.ts:477](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L477) |
| `target` | `ElementRef` | required | strict locator | 受信対象。 | [src/core/ir/schema.ts:474](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L474) |
| `key` | string | required | enum `Enter`, `Tab`, `Escape`, `ArrowDown`, `ArrowUp` | キー。 | [src/core/ir/schema.ts:474](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L474) |

```json
{"id":"submit","kind":"action","action":"press","target":{"strategy":"accessibility","role":"textbox","name":"Email"},"key":"Enter"}
```

### `action` / `fill` {#action-fill}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | 安定したID。 | [src/core/ir/schema.ts:493](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L493) |
| `kind` | string | required | literal `action` | 外部識別子。 | [src/core/ir/schema.ts:495](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L495) |
| `action` | string | required | literal `fill` | アクション識別子。 | [src/core/ir/schema.ts:496](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L496) |
| `target` | `ElementRef` | required | strict locator | フィールド。 | [src/core/ir/schema.ts:493](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L493) |
| `value` | `InterpolatableText` | required | no secret marker | 非シークレットまたは実行状態のテキスト。 | [src/core/ir/schema.ts:493](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L493) |

```json
{"id":"fill-email","kind":"action","action":"fill","target":{"strategy":"accessibility","role":"textbox","name":"Email"},"value":"a@example.test"}
```

### `action` / `fill-secret` {#action-fill-secret}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | 安定したID。 | [src/core/ir/schema.ts:515](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L515) |
| `kind` | string | required | literal `action` | 外部識別子。 | [src/core/ir/schema.ts:517](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L517) |
| `action` | string | required | literal `fill-secret` | アクション識別子。 | [src/core/ir/schema.ts:518](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L518) |
| `target` | `ElementRef` | required | strict locator | シークレット投入先フィールド。 | [src/core/ir/schema.ts:515](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L515) |
| `secretRef` | `SecretRef` | required | whole secret-ref grammar | シークレット値の参照。 | [src/core/ir/schema.ts:515](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L515) |

```json
{"id":"fill-password","kind":"action","action":"fill-secret","target":{"strategy":"accessibility","role":"textbox","name":"Password"},"secretRef":"{{secrets.LOGIN_PASSWORD}}"}
```

### `assert` / `text-visible` {#assert-text-visible}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | 安定したID。 | [src/core/ir/schema.ts:556](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L556) |
| `kind` | string | required | literal `assert` | 外部識別子。 | [src/core/ir/schema.ts:558](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L558) |
| `check` | string | required | literal `text-visible` | アサーション識別子。 | [src/core/ir/schema.ts:559](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L559) |
| `text` | `InterpolatableText` | required | no secret marker | 可視であることが期待されるテキスト。 | [src/core/ir/schema.ts:556](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L556) |

```json
{"id":"welcome-visible","kind":"assert","check":"text-visible","text":"Welcome"}
```

### `assert` / `element-visible` {#assert-element-visible}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | 安定したID。 | [src/core/ir/schema.ts:575](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L575) |
| `kind` | string | required | literal `assert` | 外部識別子。 | [src/core/ir/schema.ts:577](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L577) |
| `check` | string | required | literal `element-visible` | アサーション識別子。 | [src/core/ir/schema.ts:578](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L578) |
| `target` | `ElementRef` | required | strict locator | 可視であることが期待されるエレメント。 | [src/core/ir/schema.ts:575](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L575) |

```json
{"id":"menu-visible","kind":"assert","check":"element-visible","target":{"strategy":"accessibility","role":"navigation","name":"Main"}}
```

### `assert` / `text-equals` {#assert-text-equals}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | 安定したID。 | [src/core/ir/schema.ts:594](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L594) |
| `kind` | string | required | literal `assert` | 外部識別子。 | [src/core/ir/schema.ts:596](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L596) |
| `check` | string | required | literal `text-equals` | アサーション識別子。 | [src/core/ir/schema.ts:597](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L597) |
| `target` | `ElementRef` | required | strict locator | テスト対象のエレメント。 | [src/core/ir/schema.ts:594](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L594) |
| `text` | `InterpolatableText` | required | no secret marker | 期待される完全一致テキスト。 | [src/core/ir/schema.ts:594](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L594) |

```json
{"id":"title","kind":"assert","check":"text-equals","target":{"strategy":"accessibility","role":"heading","name":"Account"},"text":"Account"}
```

### `assert` / `url-matches` {#assert-url-matches}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | 安定したID。 | [src/core/ir/schema.ts:614](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L614) |
| `kind` | string | required | literal `assert` | 外部識別子。 | [src/core/ir/schema.ts:616](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L616) |
| `check` | string | required | literal `url-matches` | アサーション識別子。 | [src/core/ir/schema.ts:617](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L617) |
| `pattern` | `InterpolatableText` | required | no secret marker | 期待されるURL照合テキスト。 | [src/core/ir/schema.ts:614](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L614) |

```json
{"id":"on-account","kind":"assert","check":"url-matches","pattern":"/account"}
```

### `assert` / `element-count` {#assert-element-count}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | 安定したID。 | [src/core/ir/schema.ts:633](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L633) |
| `kind` | string | required | literal `assert` | 外部識別子。 | [src/core/ir/schema.ts:635](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L635) |
| `check` | string | required | literal `element-count` | アサーション識別子。 | [src/core/ir/schema.ts:636](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L636) |
| `target` | `ElementRef` | required | strict locator | 一致するエレメント。 | [src/core/ir/schema.ts:633](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L633) |
| `count` | integer | required | nonnegative | 期待されるカウント（0を含む）。 | [src/core/ir/schema.ts:633](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L633) |

```json
{"id":"one-alert","kind":"assert","check":"element-count","target":{"strategy":"accessibility","role":"alert","name":"Error"},"count":1}
```

### `capture` {#capture}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | 安定したID。 | [src/core/ir/schema.ts:672](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L672) |
| `kind` | string | required | literal `capture` | ステップ識別子。 | [src/core/ir/schema.ts:674](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L674) |
| `target` | `ElementRef` | required | strict locator | ソースエレメント。 | [src/core/ir/schema.ts:672](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L672) |
| `variable` | `RunVariableName` | required | `/^[a-z][a-zA-Z0-9]*$/` | プレーンな実行状態変数名。 | [src/core/ir/schema.ts:675](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L675) |

```json
{"id":"capture-code","kind":"capture","target":{"strategy":"accessibility","role":"textbox","name":"Code"},"variable":"code"}
```

### `ai` {#ai}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | 安定したID。 | [src/core/ir/schema.ts:404](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L404), [src/core/ir/schema.ts:416-420](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L416-L420) |
| `kind` | string | required | literal `ai` | ステップ識別子。 | [src/core/ir/schema.ts:418](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L418) |
| `instruction` | `InterpolatableText` | required | no secret marker | エージェントへの指示。 | [src/core/ir/schema.ts:419](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L419) |
| `secrets` | `AiStepSecretUse[]` | optional | strict entries | コミット済みシークレット使用。 | [src/core/ir/schema.ts:688-692](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L688-L692) |
| `instructionCoverage` | `InstructionCriterion[]` | required | min 1 | ローカルに帰属付けられた基準。 | [src/core/ir/schema.ts:714](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L714) |

```json
{"id":"complete-flow","kind":"ai","instruction":"Finish checkout.","instructionCoverage":[{"id":"finish","kind":"success","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":17}}]}
```

### コミット済み AI シークレット使用 {#committed-ai-secret-grants}

コミット済み AI ステップの任意の `secrets` 配列の各要素は厳格な `AiStepSecretUse` であり、解決済み参照のみを記録する。同意および許可リスト認可は Plan の永続化前に行われ、Plan の来歴フィールドではない。[src/core/ir/schema.ts:667-692](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L667-L692) [src/usecases/generate.ts:1405-1493](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/generate.ts#L1405-L1493)

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `ref` | `SecretRef` | required | whole secret-reference grammar | コミット済みシークレット参照。 | [src/core/ir/schema.ts:674-675](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L674-L675) |

```json
{"id":"complete-flow","kind":"ai","instruction":"Finish checkout.","secrets":[{"ref":"{{secrets.CARD_NUMBER}}"}],"instructionCoverage":[{"id":"finish","kind":"success","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":17}}]}
```

## 生成形式 {#generated-forms}

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

プロバイダが提供する anchor と列の座標は、各基準をローカルで解決された 1 つのプロンプト抜粋にバインドする。4 座標の `InstructionSourceSpan` へのローカル解決により、コミットされる帰属付けが正確なものとなる一方、プロバイダの `citation` はその解決を確認するチェックサムに過ぎず、結合キーとしては使われない。 [src/usecases/instruction-coverage-policy.ts:369-399](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/instruction-coverage-policy.ts#L369-L399)

末尾の `url-matches` は、引用された成功基準の独立した証明ではなく同義反復的な成功形式であるため、拒絶される。サポートされている重複のない末尾の `TraceAssert` を使用する。成功条件を表現できない場合、生成は失敗する。 [src/usecases/instruction-coverage-policy.ts:361-365](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/instruction-coverage-policy.ts#L361-L365) [src/usecases/instruction-coverage-policy.ts:589-606](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/instruction-coverage-policy.ts#L589-L606)

却下された代替案の 1 つは、任意のペイロードフィールドを持つ 1 つのアクションオブジェクトを使用するものであったが、無効な組み合わせがスキーマ上で不可視になるため却下された。もう 1 つは一般的なテキストにシークレットを含めることを許容するものであったが、シークレットの来歴とマスキング（redaction）が曖昧になるため却下された。 
