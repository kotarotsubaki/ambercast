---
title: "步骤"
description: "每个已提交的步骤都是由 `kind` 辨识的 `Step` 的严格分支；每个分支都具有 `id: StepId`。"
---

## 步骤联合体 {#step-union}

每个已提交的步骤都是由 `kind` 辨识的 `Step` 的严格分支；每个分支都具有 `id: StepId`。[src/core/ir/schema.ts:404](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L404), [src/core/ir/schema.ts:742](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L742)

### `action` / `click` {#action-click}

| 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | 必填 | `/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/` | 稳定的步骤标识符。 | [src/core/ir/schema.ts:41](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L41), [src/core/ir/schema.ts:436](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L436) |
| `kind` | string | 必填 | 字面量 `action` | 外部辨识符。 | [src/core/ir/schema.ts:438](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L438) |
| `action` | string | 必填 | 字面量 `click` | 动作辨识符。 | [src/core/ir/schema.ts:439](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L439) |
| `target` | `ElementRef` | 必填 | 目前为 accessibility 分支 | 要点击的元素。 | [src/core/ir/schema.ts:436](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L436) |

```json
{"id":"click-login","kind":"action","action":"click","target":{"strategy":"accessibility","role":"button","name":"Log in"}}
```

### `action` / `navigate` {#action-navigate}

| 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | 必填 | step-ID 正则表达式 | 稳定 ID。 | [src/core/ir/schema.ts:455](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L455) |
| `kind` | string | 必填 | 字面量 `action` | 外部辨识符。 | [src/core/ir/schema.ts:457](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L457) |
| `action` | string | 必填 | 字面量 `navigate` | 动作辨识符。 | [src/core/ir/schema.ts:458](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L458) |
| `url` | `InterpolatableText` | 必填 | 无 `{{secrets.` 标记 | 导航文本。 | [src/core/ir/schema.ts:455](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L455) |

```json
{"id":"open-home","kind":"action","action":"navigate","url":"https://example.test"}
```

在执行时，每个 Plan 导航、缓存的 trace 导航以及全新 agentic 导航都必须（MUST）针对实时目标的 `baseUrl` 进行解析，使用 HTTP(S)，并保持在该目标的原点（origin）上。不可解析、非 HTTP(S) 或跨原点的目标地址属于完整性故障。[src/usecases/run.ts:701](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L701) [src/usecases/run.ts:746](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L746)

### `action` / `press` {#action-press}

| 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | 必填 | step-ID 正则表达式 | 稳定 ID。 | [src/core/ir/schema.ts:474](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L474) |
| `kind` | string | 必填 | 字面量 `action` | 外部辨识符。 | [src/core/ir/schema.ts:476](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L476) |
| `action` | string | 必填 | 字面量 `press` | 动作辨识符。 | [src/core/ir/schema.ts:477](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L477) |
| `target` | `ElementRef` | 必填 | 严格定位器 | 接收目标。 | [src/core/ir/schema.ts:474](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L474) |
| `key` | string | 必填 | 枚举 `Enter`、`Tab`、`Escape`、`ArrowDown`、`ArrowUp` | 按键。 | [src/core/ir/schema.ts:474](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L474) |

```json
{"id":"submit","kind":"action","action":"press","target":{"strategy":"accessibility","role":"textbox","name":"Email"},"key":"Enter"}
```

### `action` / `fill` {#action-fill}

| 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | 必填 | step-ID 正则表达式 | 稳定 ID。 | [src/core/ir/schema.ts:493](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L493) |
| `kind` | string | 必填 | 字面量 `action` | 外部辨识符。 | [src/core/ir/schema.ts:495](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L495) |
| `action` | string | 必填 | 字面量 `fill` | 动作辨识符。 | [src/core/ir/schema.ts:496](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L496) |
| `target` | `ElementRef` | 必填 | 严格定位器 | 字段。 | [src/core/ir/schema.ts:493](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L493) |
| `value` | `InterpolatableText` | 必填 | 无机密标记 | 非机密或运行状态文本。 | [src/core/ir/schema.ts:493](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L493) |

```json
{"id":"fill-email","kind":"action","action":"fill","target":{"strategy":"accessibility","role":"textbox","name":"Email"},"value":"a@example.test"}
```

### `action` / `fill-secret` {#action-fill-secret}

| 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | 必填 | step-ID 正则表达式 | 稳定 ID。 | [src/core/ir/schema.ts:515](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L515) |
| `kind` | string | 必填 | 字面量 `action` | 外部辨识符。 | [src/core/ir/schema.ts:517](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L517) |
| `action` | string | 必填 | 字面量 `fill-secret` | 动作辨识符。 | [src/core/ir/schema.ts:518](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L518) |
| `target` | `ElementRef` | 必填 | 严格定位器 | 机密接收字段。 | [src/core/ir/schema.ts:515](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L515) |
| `secretRef` | `SecretRef` | 必填 | 完整 secret-ref 语法 | 机密值引用。 | [src/core/ir/schema.ts:515](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L515) |

```json
{"id":"fill-password","kind":"action","action":"fill-secret","target":{"strategy":"accessibility","role":"textbox","name":"Password"},"secretRef":"{{secrets.LOGIN_PASSWORD}}"}
```

### `assert` / `text-visible` {#assert-text-visible}

| 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | 必填 | step-ID 正则表达式 | 稳定 ID。 | [src/core/ir/schema.ts:556](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L556) |
| `kind` | string | 必填 | 字面量 `assert` | 外部辨识符。 | [src/core/ir/schema.ts:558](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L558) |
| `check` | string | 必填 | 字面量 `text-visible` | 断言辨识符。 | [src/core/ir/schema.ts:559](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L559) |
| `text` | `InterpolatableText` | 必填 | 无机密标记 | 期望可见的文本。 | [src/core/ir/schema.ts:556](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L556) |

```json
{"id":"welcome-visible","kind":"assert","check":"text-visible","text":"Welcome"}
```

### `assert` / `element-visible` {#assert-element-visible}

| 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | 必填 | step-ID 正则表达式 | 稳定 ID。 | [src/core/ir/schema.ts:575](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L575) |
| `kind` | string | 必填 | 字面量 `assert` | 外部辨识符。 | [src/core/ir/schema.ts:577](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L577) |
| `check` | string | 必填 | 字面量 `element-visible` | 断言辨识符。 | [src/core/ir/schema.ts:578](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L578) |
| `target` | `ElementRef` | 必填 | 严格定位器 | 期望可见的元素。 | [src/core/ir/schema.ts:575](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L575) |

```json
{"id":"menu-visible","kind":"assert","check":"element-visible","target":{"strategy":"accessibility","role":"navigation","name":"Main"}}
```

### `assert` / `text-equals` {#assert-text-equals}

| 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | 必填 | step-ID 正则表达式 | 稳定 ID。 | [src/core/ir/schema.ts:594](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L594) |
| `kind` | string | 必填 | 字面量 `assert` | 外部辨识符。 | [src/core/ir/schema.ts:596](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L596) |
| `check` | string | 必填 | 字面量 `text-equals` | 断言辨识符。 | [src/core/ir/schema.ts:597](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L597) |
| `target` | `ElementRef` | 必填 | 严格定位器 | 被测元素。 | [src/core/ir/schema.ts:594](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L594) |
| `text` | `InterpolatableText` | 必填 | 无机密标记 | 精确的期望文本。 | [src/core/ir/schema.ts:594](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L594) |

```json
{"id":"title","kind":"assert","check":"text-equals","target":{"strategy":"accessibility","role":"heading","name":"Account"},"text":"Account"}
```

### `assert` / `url-matches` {#assert-url-matches}

| 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | 必填 | step-ID 正则表达式 | 稳定 ID。 | [src/core/ir/schema.ts:614](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L614) |
| `kind` | string | 必填 | 字面量 `assert` | 外部辨识符。 | [src/core/ir/schema.ts:616](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L616) |
| `check` | string | 必填 | 字面量 `url-matches` | 断言辨识符。 | [src/core/ir/schema.ts:617](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L617) |
| `pattern` | `InterpolatableText` | 必填 | 无机密标记 | 期望的 URL 匹配文本。 | [src/core/ir/schema.ts:614](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L614) |

```json
{"id":"on-account","kind":"assert","check":"url-matches","pattern":"/account"}
```

### `assert` / `element-count` {#assert-element-count}

| 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | 必填 | step-ID 正则表达式 | 稳定 ID。 | [src/core/ir/schema.ts:633](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L633) |
| `kind` | string | 必填 | 字面量 `assert` | 外部辨识符。 | [src/core/ir/schema.ts:635](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L635) |
| `check` | string | 必填 | 字面量 `element-count` | 断言辨识符。 | [src/core/ir/schema.ts:636](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L636) |
| `target` | `ElementRef` | 必填 | 严格定位器 | 匹配的元素。 | [src/core/ir/schema.ts:633](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L633) |
| `count` | integer | 必填 | 非负 | 期望计数，包含零。 | [src/core/ir/schema.ts:633](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L633) |

```json
{"id":"one-alert","kind":"assert","check":"element-count","target":{"strategy":"accessibility","role":"alert","name":"Error"},"count":1}
```

### `capture` {#capture}

| 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | 必填 | step-ID 正则表达式 | 稳定 ID。 | [src/core/ir/schema.ts:672](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L672) |
| `kind` | string | 必填 | 字面量 `capture` | 步骤辨识符。 | [src/core/ir/schema.ts:674](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L674) |
| `target` | `ElementRef` | 必填 | 严格定位器 | 源元素。 | [src/core/ir/schema.ts:672](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L672) |
| `variable` | `RunVariableName` | 必填 | `/^[a-z][a-zA-Z0-9]*$/` | 裸运行状态变量名。 | [src/core/ir/schema.ts:675](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L675) |

```json
{"id":"capture-code","kind":"capture","target":{"strategy":"accessibility","role":"textbox","name":"Code"},"variable":"code"}
```

### `ai` {#ai}

| 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | 必填 | step-ID 正则表达式 | 稳定 ID。 | [src/core/ir/schema.ts:404](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L404), [src/core/ir/schema.ts:416-420](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L416-L420) |
| `kind` | string | 必填 | 字面量 `ai` | 步骤辨识符。 | [src/core/ir/schema.ts:418](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L418) |
| `instruction` | `InterpolatableText` | 必填 | 无机密标记 | 代理指令。 | [src/core/ir/schema.ts:419](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L419) |
| `secrets` | `AiStepSecretUse[]` | 可选 | 严格项 | 已提交的机密使用。 | [src/core/ir/schema.ts:688-692](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L688-L692) |
| `instructionCoverage` | `InstructionCriterion[]` | 必填 | 至少 1 项 | 本地归属的准则。 | [src/core/ir/schema.ts:714](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L714) |

```json
{"id":"complete-flow","kind":"ai","instruction":"Finish checkout.","instructionCoverage":[{"id":"finish","kind":"success","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":17}}]}
```

### 已提交的 AI 机密使用 {#committed-ai-secret-grants}

已提交的 AI 步骤的可选 `secrets` 数组中的每个成员都是严格的 `AiStepSecretUse`；它仅记录已解析的引用。同意和允许列表授权在 Plan 持久化之前进行，而非 Plan 溯源字段。[src/core/ir/schema.ts:667-692](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L667-L692) [src/usecases/generate.ts:1405-1493](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/generate.ts#L1405-L1493)

| 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `ref` | `SecretRef` | 必填 | 完整 secret-reference 语法 | 已提交的机密引用。 | [src/core/ir/schema.ts:674-675](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L674-L675) |

```json
{"id":"complete-flow","kind":"ai","instruction":"Finish checkout.","secrets":[{"ref":"{{secrets.CARD_NUMBER}}"}],"instructionCoverage":[{"id":"finish","kind":"success","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":17}}]}
```

## 生成形式 {#generated-forms}

| 对象 | 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| `GeneratedFillSecretAction` | `id`, `kind`, `action`, `target` | 除 `secretRef` 外同已提交的 fill-secret | 必填 | `kind: action`, `action: fill-secret` | 等待本地命名的提供商形式。 | [src/core/ir/schema.ts:773-805](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L773-L805) |
|  | `secret` | `SecretNameChoice` | 可选 | 严格 choice | 已有允许列表名称请求或新名称提示。 | [src/core/ir/schema.ts:104-115,779-785](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L104-L115) |
| `GeneratedAiStepSecretUse` | choice | `SecretNameChoice` or `{}` | 数组成员必填 | 严格 choice 或无提供商偏好 | 等待本地解析的提供商命名意图。 | [src/core/ir/schema.ts:813-821](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L813-L821) |
| `GeneratedAiStep` | `id`, `kind`, `instruction` | 同已提交的 AI | 必填 | `kind: ai` | 共享的 AI 契约。 | [src/core/ir/schema.ts:814](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L814) |
|  | `secrets` | generated uses[] | 可选 | 严格项 | 待定的机密名称解析。 | [src/core/ir/schema.ts:824-833](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L824-L833) |
|  | `instructionCoverage` | generated criteria[] | 必填 | 至少 1 项 | 待定的准则归属。 | [src/core/ir/schema.ts:817](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L817) |
|  | `verificationIntent` | `VerificationIntent[]` | 必填 | 严格形式下至少 1 项 | 瞬态验证提议。 | [src/core/ir/schema.ts:818](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L818) |

## 设计理由 {#rationale}

该问题在于防止将动作误认为是证据，特别是在 UI 可能会产生错误通过（wrong pass）的情况下。显式断言分支使观察到的成功准则具备可检查性。

所选定的可辨识联合体为每个操作码（opcode）赋予了封闭的字段契约，并将机密填充与普通文本分离开来。提供商命名意图会在计划提交前于本地解析并取得同意。

provider 提供的锚点与列坐标将每个准则绑定到一个经本地解析的提示词摘录；本地解析为四坐标 `InstructionSourceSpan` 使得提交的归属变得精确，而 provider 返回的 `citation` 仅是确认该解析结果的校验和，并不作为结合键使用。 [src/usecases/instruction-coverage-policy.ts:407-443](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/instruction-coverage-policy.ts#L407-L443)

终结性 `url-matches` 被否决，因为它是同义反复的成功形式，而不是所引用的成功准则的独立证明。请使用受支持且非重复的终结性 `TraceAssert`；如果无法表示成功条件，则生成失败。 [src/usecases/instruction-coverage-policy.ts:403-407](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/instruction-coverage-policy.ts#L403-L407) [src/usecases/instruction-coverage-policy.ts:622-625](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/instruction-coverage-policy.ts#L622-L625)

一种被否决的备选方案曾使用带有可选负载字段的单个 action 对象；该方案被否决是因为无效组合在模式（schema）层面变得不可见。另一种备选方案允许通用文本携带机密；它被否决是因为机密出处和脱敏（redaction）将变得模棱两可。 
