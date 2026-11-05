---
title: "步骤"
description: "本章定义每一种已提交的步骤类型及其字段和示例，以及本地生成据以转换为已提交步骤的生成形式。"
---

## 步骤联合体 {#step-union}

每个已提交的步骤都是 `Step` 的严格分支，由 `kind` 辨识。每个分支都有 `id: StepId` 和必填的 `target`，后者指向 `Plan.targets` 中的某个键 (`src/core/ir/schema.ts:561,930`)。

## 确认引用 {#confirmation-references}

断言或 `ai` 步骤可以带有非空的 `confirms` 数组，指向此前的 `click`、`press`、`fill`、`fill-secret` 或 `capture` 步骤；断言或步骤通过时，会确认这些步骤的定位缓存。`generate` 和 `heal` 在校验前会删除指向 `navigate` 步骤的 `confirms` 引用。校验会报告以下五种代码之一，详见[符合性](/ambercast/zh-cn/spec/conformance/#semantic-validation)。目标的一致性不做检查 (`src/core/ir/confirms-validation.ts:45`) (`src/core/ir/confirms-validation.ts:96`)。

- `confirms-unknown-step`：ID 未知。
- `confirms-not-earlier`：引用的是同一个或之后的步骤。
- `confirms-not-action`：引用的步骤不符合条件。
- `confirms-duplicate`：ID 重复。
- `confirms-unsorted`：ID 没有按执行计划中的升序排列。

## `action` / `click` {#action-click}

| 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | `/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/` | 稳定的步骤标识符。 | `src/core/ir/schema.ts:41,561` |
| `kind` | string | required | literal `action` | 外层辨识符。 | `src/core/ir/schema.ts:613` |
| `target` | string | required | name in Plan `targets` | 执行目标。 | `src/core/ir/schema.ts:561` |
| `action` | string | required | literal `click` | 动作辨识符。 | `src/core/ir/schema.ts:614` |
| `intent` | `ElementIntent` | required | [值类型](/ambercast/zh-cn/spec/value-types/#shared-types) | 有来源依据、用于首次绑定的点击元素描述。 | `src/core/ir/schema.ts:573` |

```json
{"id":"click-login","kind":"action","action":"click","target":"app","intent":{"description":"Click Log in","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":13}}}
```

## `action` / `navigate` {#action-navigate}

| 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | 稳定 ID。 | `src/core/ir/schema.ts:41,561` |
| `kind` | string | required | literal `action` | 外层辨识符。 | `src/core/ir/schema.ts:632` |
| `action` | string | required | literal `navigate` | 动作辨识符。 | `src/core/ir/schema.ts:633` |
| `url` | `InterpolatableText` | required | no `{{secrets.` marker | 导航文本。 | `src/core/ir/schema.ts:566` |

```json
{"id":"open-home","kind":"action","action":"navigate","target":"app","url":"https://example.test"}
```

执行时，每一次执行计划导航、缓存的轨迹导航和全新的智能体导航，都必须 (MUST) 满足以下条件 (`src/usecases/run.ts:993`)：

- 以运行中目标的 `baseUrl` 为基准解析。
- 使用 HTTP(S)。
- 保持在该目标的来源之内。

无法解析、非 HTTP(S) 或跨来源的目的地属于完整性失败。

## `action` / `press` {#action-press}

| 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | 稳定 ID。 | `src/core/ir/schema.ts:41,561` |
| `kind` | string | required | literal `action` | 外层辨识符。 | `src/core/ir/schema.ts:652` |
| `target` | string | required | name in Plan `targets` | 执行目标。 | `src/core/ir/schema.ts:561` |
| `action` | string | required | literal `press` | 动作辨识符。 | `src/core/ir/schema.ts:653` |
| `intent` | `ElementIntent` | required | [值类型](/ambercast/zh-cn/spec/value-types/#shared-types) | 有来源依据、用于首次绑定的按键接收元素描述。 | `src/core/ir/schema.ts:574` |
| `key` | string | required | enum `Enter`, `Tab`, `Escape`, `ArrowDown`, `ArrowUp` | 按键。 | `src/core/ir/schema.ts:569` |

```json
{"id":"submit","kind":"action","action":"press","target":"app","intent":{"description":"Press Enter in Email","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":21}},"key":"Enter"}
```

## `action` / `fill` {#action-fill}

| 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | 稳定 ID。 | `src/core/ir/schema.ts:41,561` |
| `kind` | string | required | literal `action` | 外层辨识符。 | `src/core/ir/schema.ts:672` |
| `target` | string | required | name in Plan `targets` | 执行目标。 | `src/core/ir/schema.ts:561` |
| `action` | string | required | literal `fill` | 动作辨识符。 | `src/core/ir/schema.ts:673` |
| `intent` | `ElementIntent` | required | [值类型](/ambercast/zh-cn/spec/value-types/#shared-types) | 有来源依据、用于首次绑定的字段描述。 | `src/core/ir/schema.ts:575` |
| `value` | `InterpolatableText` | required | no secret marker | 非机密文本或运行状态文本。 | `src/core/ir/schema.ts:571` |

```json
{"id":"fill-email","kind":"action","action":"fill","target":"app","intent":{"description":"Fill Email","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":11}},"value":"a@example.test"}
```

## `action` / `fill-secret` {#action-fill-secret}

| 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | 稳定 ID。 | `src/core/ir/schema.ts:41,561` |
| `kind` | string | required | literal `action` | 外层辨识符。 | `src/core/ir/schema.ts:695` |
| `target` | string | required | name in Plan `targets` | 执行目标。 | `src/core/ir/schema.ts:561` |
| `action` | string | required | literal `fill-secret` | 动作辨识符。 | `src/core/ir/schema.ts:696` |
| `intent` | `ElementIntent` | required | [值类型](/ambercast/zh-cn/spec/value-types/#shared-types) | 有来源依据、用于首次绑定的 secret 接收字段描述。 | `src/core/ir/schema.ts:576` |
| `secretRef` | `SecretRef` | required | whole secret-ref grammar | 机密值引用。 | `src/core/ir/schema.ts:108,572` |

```json
{"id":"fill-password","kind":"action","action":"fill-secret","target":"app","intent":{"description":"Fill Password","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":14}},"secretRef":"{{secrets.LOGIN_PASSWORD}}"}
```

## `assert` / `text-visible` {#assert-text-visible}

| 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | 稳定 ID。 | `src/core/ir/schema.ts:41,561` |
| `kind` | string | required | literal `assert` | 外层辨识符。 | `src/core/ir/schema.ts:735` |
| `check` | string | required | literal `text-visible` | 断言辨识符。 | `src/core/ir/schema.ts:736` |
| `timeoutMs` | integer | optional | 0–120000 | 断言重试的截止时间，单位为毫秒。 | `src/core/ir/schema.ts:601` |
| `text` | `InterpolatableText` | required | no secret marker | 期望可见的文本。 | `src/core/ir/schema.ts:587` |
| `confirms` | `StepId[]` | optional | non-empty; earlier action-kind or capture steps in ascending Plan order | 此断言通过时确认其定位缓存的步骤。 | `src/core/ir/schema.ts:597` |

```json
{"id":"welcome-visible","kind":"assert","check":"text-visible","target":"app","text":"Welcome"}
```
## `assert` / `element-visible` {#assert-element-visible}

| 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | 稳定 ID。 | `src/core/ir/schema.ts:41,561` |
| `kind` | string | required | literal `assert` | 外层辨识符。 | `src/core/ir/schema.ts:756` |
| `target` | string | required | name in Plan `targets` | 执行目标。 | `src/core/ir/schema.ts:561` |
| `check` | string | required | literal `element-visible` | 断言辨识符。 | `src/core/ir/schema.ts:757` |
| `timeoutMs` | integer | optional | 0–120000 | 断言重试的截止时间，单位为毫秒。 | `src/core/ir/schema.ts:601` |
| `intent` | `QuotedElementIntent` | required | [值类型](/ambercast/zh-cn/spec/value-types/#shared-types) | 有来源依据的被引用元素描述。 | `src/core/ir/schema.ts:594` |
| `confirms` | `StepId[]` | optional | non-empty; earlier action-kind or capture steps in ascending Plan order | 此断言通过时确认其定位缓存的步骤。 | `src/core/ir/schema.ts:597` |

```json
{"id":"menu-visible","kind":"assert","check":"element-visible","target":"app","intent":{"description":"Main navigation 「Main」","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":23},"quote":{"text":"Main","sourceSpan":{"startLine":1,"startColumn":18,"endLine":1,"endColumn":22}}}}
```
## `assert` / `text-equals` {#assert-text-equals}

| 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | 稳定 ID。 | `src/core/ir/schema.ts:41,561` |
| `kind` | string | required | literal `assert` | 外层辨识符。 | `src/core/ir/schema.ts:779` |
| `target` | string | required | name in Plan `targets` | 执行目标。 | `src/core/ir/schema.ts:561` |
| `check` | string | required | literal `text-equals` | 断言辨识符。 | `src/core/ir/schema.ts:780` |
| `timeoutMs` | integer | optional | 0–120000 | 断言重试的截止时间，单位为毫秒。 | `src/core/ir/schema.ts:601` |
| `intent` | `QuotedElementIntent` | required | [值类型](/ambercast/zh-cn/spec/value-types/#shared-types) | 有来源依据的被引用测试元素。 | `src/core/ir/schema.ts:595` |
| `text` | `InterpolatableText` | required | no secret marker | 期望的精确文本。 | `src/core/ir/schema.ts:591` |
| `confirms` | `StepId[]` | optional | non-empty; earlier action-kind or capture steps in ascending Plan order | 此断言通过时确认其定位缓存的步骤。 | `src/core/ir/schema.ts:597` |

```json
{"id":"title","kind":"assert","check":"text-equals","target":"app","intent":{"description":"Account heading 「Account」","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":26},"quote":{"text":"Account","sourceSpan":{"startLine":1,"startColumn":18,"endLine":1,"endColumn":25}}},"text":"Account overview"}
```
## `assert` / `url-matches` {#assert-url-matches}

| 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | 稳定 ID。 | `src/core/ir/schema.ts:41,561` |
| `kind` | string | required | literal `assert` | 外层辨识符。 | `src/core/ir/schema.ts:802` |
| `check` | string | required | literal `url-matches` | 断言辨识符。 | `src/core/ir/schema.ts:803` |
| `timeoutMs` | integer | optional | 0–120000 | 断言重试的截止时间，单位为毫秒。 | `src/core/ir/schema.ts:601` |
| `pattern` | `InterpolatableText` | required | no secret marker | 期望匹配的 URL 文本。 | `src/core/ir/schema.ts:592` |
| `confirms` | `StepId[]` | optional | non-empty; earlier action-kind or capture steps in ascending Plan order | 此断言通过时确认其定位缓存的步骤。 | `src/core/ir/schema.ts:597` |

```json
{"id":"on-account","kind":"assert","check":"url-matches","target":"app","pattern":"/account"}
```
## `assert` / `element-count` {#assert-element-count}

| 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | 稳定 ID。 | `src/core/ir/schema.ts:41,561` |
| `kind` | string | required | literal `assert` | 外层辨识符。 | `src/core/ir/schema.ts:825` |
| `target` | string | required | name in Plan `targets` | 执行目标。 | `src/core/ir/schema.ts:561` |
| `check` | string | required | literal `element-count` | 断言辨识符。 | `src/core/ir/schema.ts:826` |
| `timeoutMs` | integer | optional | 0–120000 | 断言重试的截止时间，单位为毫秒。 | `src/core/ir/schema.ts:601` |
| `intent` | `QuotedElementIntent` | required | [值类型](/ambercast/zh-cn/spec/value-types/#shared-types) | 有来源依据的被引用匹配元素。 | `src/core/ir/schema.ts:596` |
| `count` | integer | required | nonnegative | 期望的数量，包括零。 | `src/core/ir/schema.ts:593` |
| `confirms` | `StepId[]` | optional | non-empty; earlier action-kind or capture steps in ascending Plan order | 此断言通过时确认其定位缓存的步骤。 | `src/core/ir/schema.ts:597` |

```json
{"id":"one-alert","kind":"assert","check":"element-count","target":"app","intent":{"description":"Error alerts 「Error」","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":21},"quote":{"text":"Error","sourceSpan":{"startLine":1,"startColumn":15,"endLine":1,"endColumn":20}}},"count":1}
```
## 断言轮询 {#assertion-polling}

断言检查在观测失败后，以最多 100ms 的间隔轮询，直到步骤截止时间。`timeoutMs` 会覆盖目标的 `resolveTimeoutMs` 作为该截止时间；取值为零时仍会求值一次。

轮询适用于首次绑定的第一阶段、执行计划中的断言，以及由 AI 指挥的断言工具。它也适用于轨迹回放的两种判定，即事件判定和验证判定。执行计划中的断言包括三种带引文元素的检查，以及 `text-visible` 和 `url-matches` 的浏览器检查路径。由 AI 指挥的断言工具和轨迹回放使用目标的 `resolveTimeoutMs`。这些位置在等待到达截止时间后，各自做最后一次观测，由这次观测决定结果。

`element-visible`、`text-equals` 和 `element-count` 从不查询或更新定位缓存，也不调用 AI：无论是否带 `--resolve`，它们都会轮询 `accessibilitySnapshot()` 和 `matchQuotedCandidates`，直到截止时间 (`src/usecases/run.ts:3071-3184`)。

## `capture` {#capture}

| 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | 稳定 ID。 | `src/core/ir/schema.ts:41,561` |
| `kind` | string | required | literal `capture` | 步骤辨识符。 | `src/core/ir/schema.ts:866` |
| `target` | string | required | name in Plan `targets` | 执行目标。 | `src/core/ir/schema.ts:561` |
| `intent` | `ElementIntent` | required | [值类型](/ambercast/zh-cn/spec/value-types/#shared-types) | 有来源依据、用于首次绑定的捕获元素描述。 | `src/core/ir/schema.ts:867` |
| `variable` | `RunVariableName` | required | `/^[a-z][a-zA-Z0-9]*$/` | 不带前缀的运行状态变量名。 | `src/core/ir/schema.ts:868` |

```json
{"id":"capture-code","kind":"capture","target":"app","intent":{"description":"Capture Code","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":13}},"variable":"code"}
```

## `ai` {#ai}

| 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | 稳定 ID。 | `src/core/ir/schema.ts:41,561` |
| `kind` | string | required | literal `ai` | 步骤辨识符。 | `src/core/ir/schema.ts:582` |
| `instruction` | `InterpolatableText` | required | no secret marker | 智能体指令。 | `src/core/ir/schema.ts:583` |
| `secrets` | `AiStepSecretUse[]` | optional | strict entries | 已提交的机密使用。 | `src/core/ir/schema.ts:901` |
| `instructionCoverage` | `InstructionCriterion[]` | required | min 1 | 在本地归属的准则。 | `src/core/ir/schema.ts:902` |
| `confirms` | `StepId[]` | optional | non-empty; earlier action-kind or capture steps in ascending Plan order | 通过时此智能体执行所确认定位缓存的步骤。 | `src/core/ir/schema.ts:900` |

```json
{"id":"complete-flow","kind":"ai","target":"app","instruction":"Finish checkout.","instructionCoverage":[{"id":"finish","kind":"success","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":17}}]}
```
## 已提交的 AI 机密使用 {#committed-ai-secret-grants}

已提交的 AI 步骤的可选 `secrets` 数组中的每个成员都是严格的 `AiStepSecretUse`，只记录解析后的引用。同意和允许列表授权发生在执行计划持久化之前，不是执行计划的溯源字段 (`src/core/ir/schema.ts:883,898-903`) (`src/usecases/generate.ts:1652-1728`)。

| 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `ref` | `SecretRef` | required | whole secret-reference grammar | 已提交的机密引用。 | `src/core/ir/schema.ts:883` |

```json
{"id":"complete-flow","kind":"ai","target":"app","instruction":"Finish checkout.","secrets":[{"ref":"{{secrets.CARD_NUMBER}}"}],"instructionCoverage":[{"id":"finish","kind":"success","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":17}}]}
```

## 生成形式 {#generated-forms}

生成的 click、press、fill、fill-secret 和 capture 形式携带 `GeneratedElementIntent`；生成的 `element-visible`、`text-equals` 和 `element-count` 形式携带 `GeneratedQuotedElementIntent`。二者都在本地归属到[值类型](/ambercast/zh-cn/spec/value-types/#shared-types)中的共享已提交形状 (`src/core/ir/schema.ts:435-457,985-1166`)。

| 对象 | 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| `GeneratedFillSecretAction` | `id`, `kind`, `action`, `target` | as committed fill-secret except `secretRef` | required | `kind: action`, `action: fill-secret` | 等待本地命名的提供商形式。 | `src/core/ir/schema.ts:1022-1029` |
|  | `secret` | `SecretNameChoice` | optional | strict choice | 瞬态验证提议。 | `src/core/ir/schema.ts:144-147,1028` |
| `GeneratedAiStepSecretUse` | choice | `SecretNameChoice` or `{}` | required per array member | strict choice or no provider preference | 等待本地解析的提供商命名意图。 | `src/core/ir/schema.ts:1146` |
| `GeneratedAiStep` | `id`, `kind`, `instruction` | as committed AI | required | `kind: ai` | 共享的 AI 契约。 | `src/core/ir/schema.ts:1156` |
|  | `secrets` | generated uses[] | optional | strict entries | 瞬态验证提议。 | `src/core/ir/schema.ts:1157` |
|  | `instructionCoverage` | generated criteria[] | required | min 1 | 瞬态验证提议。 | `src/core/ir/schema.ts:1158` |
|  | `verificationIntent` | `VerificationIntent[]` | required | min 1 in strict form | 瞬态验证提议。 | `src/core/ir/schema.ts:1159` |

## 设计理由 {#rationale}

问题在于防止把动作误当作证据，尤其是在 UI 可能产生错误通过 (wrong pass) 的场景。明确的断言分支让观测到的成功准则可以被检查。

所选的可辨识联合体为每个操作码赋予封闭的字段契约，并把机密填写与普通文本分开。提供方的命名意图在本地解析并取得同意之后，执行计划才会被提交。

提供方给出的锚点和列坐标，把每条准则绑定到一段经本地解析的提示词摘录。针对四坐标 `InstructionSourceSpan` 的本地解析，使已提交的归属足够精确。提供方的 `citation` 只是用来确认该解析的校验和，绝不是连接键 (`src/usecases/instruction-coverage-policy.ts:405-479`)。

终结的 `url-matches` 被否决，因为它是同义反复的成功形式，不能独立证明所引用的成功准则。应使用受支持且不重复的终结 `TraceAssert`；如果成功条件无法表示，生成就会失败 (`src/usecases/instruction-coverage-policy.ts:468-469`) (`src/usecases/instruction-coverage-policy.ts:630-631`)。

被否决的备选方案之一是用带可选负载字段的单个动作对象，因为无效组合在模式中不可见。另一个是让普通文本承载机密，因为同意边界和脱敏会变得含混。
