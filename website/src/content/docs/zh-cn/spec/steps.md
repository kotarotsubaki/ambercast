---
title: "步骤"
description: "每个已提交的步骤都是由 `kind` 辨识的 `Step` 的严格分支；每个分支都具有 `id: StepId`。"
---

## 步骤联合体 {#step-union}

每个已提交的步骤都是由 `kind` 辨识的 `Step` 的严格分支；每个分支都具有 `id: StepId`。[src/core/ir/schema.ts:404](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L404), [src/core/ir/schema.ts:742](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L742)

### `action` / `click` {#action-click}

| 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | `/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/` | Stable step identifier. | [src/core/ir/schema.ts:41](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L41), [src/core/ir/schema.ts:436](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L436) |
| `kind` | string | required | literal `action` | Outer discriminator. | [src/core/ir/schema.ts:438](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L438) |
| `target` | string | required | name in Plan `targets` | Execution Target. | repo:src/core/ir/schema.ts |
| `action` | string | required | literal `click` | Action discriminator. | [src/core/ir/schema.ts:439](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L439) |
| `element` | `ElementRef` | required | accessibility branch currently | Element to click. | [src/core/ir/schema.ts:436](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L436) |

```json
{"id":"click-login","kind":"action","action":"click","target":"app","element":{"strategy":"accessibility","role":"button","name":"Log in"}}
```

### `action` / `navigate` {#action-navigate}

| 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | Stable ID. | [src/core/ir/schema.ts:455](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L455) |
| `kind` | string | required | literal `action` | Outer discriminator. | [src/core/ir/schema.ts:457](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L457) |
| `action` | string | required | literal `navigate` | Action discriminator. | [src/core/ir/schema.ts:458](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L458) |
| `url` | `InterpolatableText` | required | no `{{secrets.` marker | Navigation text. | [src/core/ir/schema.ts:455](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L455) |

```json
{"id":"open-home","kind":"action","action":"navigate","target":"app","url":"https://example.test"}
```

在执行时，每个 Plan 导航、缓存的 trace 导航以及全新 agentic 导航都必须（MUST）针对实时目标的 `baseUrl` 进行解析，使用 HTTP(S)，并保持在该目标的原点（origin）上。不可解析、非 HTTP(S) 或跨原点的目标地址属于完整性故障。[src/usecases/run.ts:701](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L701) [src/usecases/run.ts:746](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L746)

### `action` / `press` {#action-press}

| 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | Stable ID. | [src/core/ir/schema.ts:474](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L474) |
| `kind` | string | required | literal `action` | Outer discriminator. | [src/core/ir/schema.ts:476](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L476) |
| `target` | string | required | name in Plan `targets` | Execution Target. | repo:src/core/ir/schema.ts |
| `action` | string | required | literal `press` | Action discriminator. | [src/core/ir/schema.ts:477](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L477) |
| `element` | `ElementRef` | required | strict locator | Recipient. | [src/core/ir/schema.ts:474](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L474) |
| `key` | string | required | enum `Enter`, `Tab`, `Escape`, `ArrowDown`, `ArrowUp` | Key. | [src/core/ir/schema.ts:474](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L474) |

```json
{"id":"submit","kind":"action","action":"press","target":"app","element":{"strategy":"accessibility","role":"textbox","name":"Email"},"key":"Enter"}
```

### `action` / `fill` {#action-fill}

| 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | Stable ID. | [src/core/ir/schema.ts:493](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L493) |
| `kind` | string | required | literal `action` | Outer discriminator. | [src/core/ir/schema.ts:495](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L495) |
| `target` | string | required | name in Plan `targets` | Execution Target. | repo:src/core/ir/schema.ts |
| `action` | string | required | literal `fill` | Action discriminator. | [src/core/ir/schema.ts:496](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L496) |
| `element` | `ElementRef` | required | strict locator | Field. | [src/core/ir/schema.ts:493](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L493) |
| `value` | `InterpolatableText` | required | no secret marker | Non-secret or run-state text. | [src/core/ir/schema.ts:493](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L493) |

```json
{"id":"fill-email","kind":"action","action":"fill","target":"app","element":{"strategy":"accessibility","role":"textbox","name":"Email"},"value":"a@example.test"}
```

### `action` / `fill-secret` {#action-fill-secret}

| 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | Stable ID. | [src/core/ir/schema.ts:499-504](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L499-L504) |
| `kind` | string | required | literal `action` | Outer discriminator. | [src/core/ir/schema.ts:499-504](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L499-L504) |
| `target` | string | required | name in Plan `targets` | Execution Target. | repo:src/core/ir/schema.ts |
| `action` | string | required | literal `fill-secret` | Action discriminator. | [src/core/ir/schema.ts:499-504](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L499-L504) |
| `element` | `ElementRef` | required | strict locator | Secret sink field. | [src/core/ir/schema.ts:396](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L396), [src/core/ir/schema.ts:499-504](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L499-L504) |
| `secretRef` | `SecretRef` | required | whole secret-ref grammar | Secret value reference. | [src/core/ir/schema.ts:396](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L396), [src/core/ir/schema.ts:499-504](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L499-L504) |

```json
{"id":"fill-password","kind":"action","action":"fill-secret","target":"app","element":{"strategy":"accessibility","role":"textbox","name":"Password"},"secretRef":"{{secrets.LOGIN_PASSWORD}}"}
```

### `assert` / `text-visible` {#assert-text-visible}

| 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | Stable ID. | [src/core/ir/schema.ts:556](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L556) |
| `kind` | string | required | literal `assert` | Outer discriminator. | [src/core/ir/schema.ts:558](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L558) |
| `check` | string | required | literal `text-visible` | Assertion discriminator. | [src/core/ir/schema.ts:559](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L559) |
| `timeoutMs` | integer | optional | 0–120000 | Assertion retry deadline in milliseconds. | repo:src/core/ir/schema.ts |
| `text` | `InterpolatableText` | required | no secret marker | Expected visible text. | [src/core/ir/schema.ts:556](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L556) |

```json
{"id":"welcome-visible","kind":"assert","check":"text-visible","target":"app","text":"Welcome"}
```

### `assert` / `element-visible` {#assert-element-visible}

| 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | Stable ID. | [src/core/ir/schema.ts:575](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L575) |
| `kind` | string | required | literal `assert` | Outer discriminator. | [src/core/ir/schema.ts:577](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L577) |
| `target` | string | required | name in Plan `targets` | Execution Target. | repo:src/core/ir/schema.ts |
| `check` | string | required | literal `element-visible` | Assertion discriminator. | [src/core/ir/schema.ts:578](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L578) |
| `timeoutMs` | integer | optional | 0–120000 | Assertion retry deadline in milliseconds. | repo:src/core/ir/schema.ts |
| `element` | `ElementRef` | required | strict locator | Expected visible element. | [src/core/ir/schema.ts:575](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L575) |

```json
{"id":"menu-visible","kind":"assert","check":"element-visible","target":"app","element":{"strategy":"accessibility","role":"navigation","name":"Main"}}
```

### `assert` / `text-equals` {#assert-text-equals}

| 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | Stable ID. | [src/core/ir/schema.ts:594](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L594) |
| `kind` | string | required | literal `assert` | Outer discriminator. | [src/core/ir/schema.ts:596](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L596) |
| `target` | string | required | name in Plan `targets` | Execution Target. | repo:src/core/ir/schema.ts |
| `check` | string | required | literal `text-equals` | Assertion discriminator. | [src/core/ir/schema.ts:597](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L597) |
| `timeoutMs` | integer | optional | 0–120000 | Assertion retry deadline in milliseconds. | repo:src/core/ir/schema.ts |
| `element` | `ElementRef` | required | strict locator | Element under test. | [src/core/ir/schema.ts:594](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L594) |
| `text` | `InterpolatableText` | required | no secret marker | Exact expected text. | [src/core/ir/schema.ts:594](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L594) |

```json
{"id":"title","kind":"assert","check":"text-equals","target":"app","element":{"strategy":"accessibility","role":"heading","name":"Account"},"text":"Account"}
```

### `assert` / `url-matches` {#assert-url-matches}

| 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | Stable ID. | [src/core/ir/schema.ts:614](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L614) |
| `kind` | string | required | literal `assert` | Outer discriminator. | [src/core/ir/schema.ts:616](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L616) |
| `check` | string | required | literal `url-matches` | Assertion discriminator. | [src/core/ir/schema.ts:617](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L617) |
| `timeoutMs` | integer | optional | 0–120000 | Assertion retry deadline in milliseconds. | repo:src/core/ir/schema.ts |
| `pattern` | `InterpolatableText` | required | no secret marker | Expected URL matching text. | [src/core/ir/schema.ts:614](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L614) |

```json
{"id":"on-account","kind":"assert","check":"url-matches","target":"app","pattern":"/account"}
```

### `assert` / `element-count` {#assert-element-count}

| 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | Stable ID. | [src/core/ir/schema.ts:633](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L633) |
| `kind` | string | required | literal `assert` | Outer discriminator. | [src/core/ir/schema.ts:635](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L635) |
| `target` | string | required | name in Plan `targets` | Execution Target. | repo:src/core/ir/schema.ts |
| `check` | string | required | literal `element-count` | Assertion discriminator. | [src/core/ir/schema.ts:636](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L636) |
| `timeoutMs` | integer | optional | 0–120000 | Assertion retry deadline in milliseconds. | repo:src/core/ir/schema.ts |
| `element` | `ElementRef` | required | strict locator | Matching element. | [src/core/ir/schema.ts:633](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L633) |
| `count` | integer | required | nonnegative | Expected count, including zero. | [src/core/ir/schema.ts:633](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L633) |

```json
{"id":"one-alert","kind":"assert","check":"element-count","target":"app","element":{"strategy":"accessibility","role":"alert","name":"Error"},"count":1}
```

### `capture` {#capture}

| 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | Stable ID. | [src/core/ir/schema.ts:672](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L672) |
| `kind` | string | required | literal `capture` | Step discriminator. | [src/core/ir/schema.ts:674](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L674) |
| `target` | string | required | name in Plan `targets` | Execution Target. | repo:src/core/ir/schema.ts |
| `element` | `ElementRef` | required | strict locator | Source element. | [src/core/ir/schema.ts:672](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L672) |
| `variable` | `RunVariableName` | required | `/^[a-z][a-zA-Z0-9]*$/` | Bare run-state variable name. | [src/core/ir/schema.ts:675](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L675) |

```json
{"id":"capture-code","kind":"capture","target":"app","element":{"strategy":"accessibility","role":"textbox","name":"Code"},"variable":"code"}
```

### `ai` {#ai}

| 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | Stable ID. | [src/core/ir/schema.ts:404](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L404), [src/core/ir/schema.ts:416-420](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L416-L420) |
| `kind` | string | required | literal `ai` | Step discriminator. | [src/core/ir/schema.ts:418](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L418) |
| `instruction` | `InterpolatableText` | required | no secret marker | Agent instruction. | [src/core/ir/schema.ts:419](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L419) |
| `secrets` | `AiStepSecretUse[]` | optional | strict entries | Committed secret uses. | [src/core/ir/schema.ts:688-692](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L688-L692) |
| `instructionCoverage` | `InstructionCriterion[]` | required | min 1 | Locally attributed criteria. | [src/core/ir/schema.ts:688-692](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L688-L692) |

```json
{"id":"complete-flow","kind":"ai","target":"app","instruction":"Finish checkout.","instructionCoverage":[{"id":"finish","kind":"success","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":17}}]}
```

### 已提交的 AI 机密使用 {#committed-ai-secret-grants}

已提交的 AI 步骤的可选 `secrets` 数组中的每个成员都是严格的 `AiStepSecretUse`；它仅记录已解析的引用。同意和允许列表授权在 Plan 持久化之前进行，而非 Plan 溯源字段。[src/core/ir/schema.ts:667-692](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L667-L692) [src/usecases/generate.ts:1405-1493](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/generate.ts#L1405-L1493)

| 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `ref` | `SecretRef` | required | whole secret-reference grammar | Committed secret reference. | [src/core/ir/schema.ts:674-675](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L674-L675) |

```json
{"id":"complete-flow","kind":"ai","target":"app","instruction":"Finish checkout.","secrets":[{"ref":"{{secrets.CARD_NUMBER}}"}],"instructionCoverage":[{"id":"finish","kind":"success","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":17}}]}
```

## 生成形式 {#generated-forms}

| 对象 | 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| `GeneratedFillSecretAction` | `id`, `kind`, `action`, `target` | as committed fill-secret except `secretRef` | required | `kind: action`, `action: fill-secret` | 等待本地命名的提供商形式。 | [src/core/ir/schema.ts:773-805](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L773-L805) |
|  | `secret` | `SecretNameChoice` | optional | strict choice | 瞬态验证提议。 | [src/core/ir/schema.ts:104-115](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L104-L115), [src/core/ir/schema.ts:779-785](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L779-L785) |
| `GeneratedAiStepSecretUse` | choice | `SecretNameChoice` or `{}` | required per array member | strict choice or no provider preference | 等待本地解析的提供商命名意图。 | [src/core/ir/schema.ts:813-821](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L813-L821) |
| `GeneratedAiStep` | `id`, `kind`, `instruction` | as committed AI | required | `kind: ai` | 共享的 AI 契约。 | [src/core/ir/schema.ts:814](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L814) |
|  | `secrets` | generated uses[] | optional | strict entries | 瞬态验证提议。 | [src/core/ir/schema.ts:824-833](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L824-L833) |
|  | `instructionCoverage` | generated criteria[] | required | min 1 | 瞬态验证提议。 | [src/core/ir/schema.ts:817](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L817) |
|  | `verificationIntent` | `VerificationIntent[]` | required | min 1 in strict form | 瞬态验证提议。 | [src/core/ir/schema.ts:818](https://github.com/kotarotsubaki/ambercast/blob/v0.6.0/src/core/ir/schema.ts#L818) |

## 设计理由 {#rationale}

该问题在于防止将动作误认为是证据，特别是在 UI 可能会产生错误通过（wrong pass）的情况下。显式断言分支使观察到的成功准则具备可检查性。

所选定的可辨识联合体为每个操作码（opcode）赋予了封闭的字段契约，并将机密填充与普通文本分离开来。提供商命名意图会在计划提交前于本地解析并取得同意。

provider 提供的锚点与列坐标将每个准则绑定到一个经本地解析的提示词摘录；本地解析为四坐标 `InstructionSourceSpan` 使得提交的归属变得精确，而 provider 返回的 `citation` 仅是确认该解析结果的校验和，并不作为结合键使用。 [src/usecases/instruction-coverage-policy.ts:407-443](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/instruction-coverage-policy.ts#L407-L443)

终结性 `url-matches` 被否决，因为它是同义反复的成功形式，而不是所引用的成功准则的独立证明。请使用受支持且非重复的终结性 `TraceAssert`；如果无法表示成功条件，则生成失败。 [src/usecases/instruction-coverage-policy.ts:403-407](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/instruction-coverage-policy.ts#L403-L407) [src/usecases/instruction-coverage-policy.ts:622-625](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/instruction-coverage-policy.ts#L622-L625)

一种被否决的备选方案曾使用带有可选负载字段的单个 action 对象；该方案被否决是因为无效组合在模式（schema）层面变得不可见。另一种备选方案允许通用文本携带机密；它被否决是因为机密出处和脱敏（redaction）将变得模棱两可。 
