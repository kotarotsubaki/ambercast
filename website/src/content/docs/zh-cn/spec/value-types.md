---
title: "值类型"
description: "所有其他章节必须（MUST）使用这些定义，而不是重新陈述其形态。"
---

## 共享类型 {#shared-types}

所有其他章节必须（MUST）使用这些定义，而不是重新陈述其形态。下述每个对象都是严格的：未知属性必须（MUST）被拒绝。[src/core/ir/schema.ts:165](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L165) [src/core/ir/schema.ts:183](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L183) 正则表达式逐字引用自运行时权威定义。

| Type | field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `TargetDefinition` | `baseUrl` | string | required | `/^https?:\\/\\/[^\\s/?#]\\S*$/`; `/^(?![\\s\\S]*\\{\\{secrets\\.)[\\s\\S]*$/` | 无 secret 标记的已创作 HTTP(S) 基准 URL。 | [src/core/ir/schema.ts:37-38](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L37-L38), [src/core/ir/schema.ts:165-166](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L165-L166) |
|  | `browser` | string | required | literal `chromium` | 所选浏览器。 | [src/core/ir/schema.ts:167](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L167) |
|  | `secretSinkOrigins` | record `SecretRef` → `SecretSinkOrigin[]` | optional | See scalar table | 每个 secret 允许的源。 | [src/core/ir/schema.ts:168](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L168) |
| `AccessibilityElementRef` | `strategy` | string | required | literal `accessibility` | 定位器鉴别器。 | [src/core/ir/schema.ts:183](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L183) |
|  | `role` | string | required | min 1 | 精确的可访问性角色。 | [src/core/ir/schema.ts:185](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L185) |
|  | `name` | string | required | min 1 | 可访问名称。 | [src/core/ir/schema.ts:186](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L186) |
| `Fingerprint` | `algorithm` | string | required | literal `a11y-neighborhood-v2` | 定位器证据格式。 | [src/core/ir/schema.ts:221](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L221) |
|  | `hash` | string | required | `/^[0-9a-f]{64}$/` | 小写 SHA-256。 | [src/core/ir/schema.ts:35](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L35), [src/core/ir/schema.ts:223](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L223) |
| `SourceSpan` | `startLine` | integer | required | positive | 包含边界的、基于 1 的授权起始行。 | [src/core/ir/schema.ts:259](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L259) |
|  | `endLine` | integer | required | positive; `endLine >= startLine` | 包含边界的授权结束行。 | [src/core/ir/schema.ts:260](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L260), [src/core/ir/schema.ts:261](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L261) |
| `InstructionSourceSpan` | `startLine` | integer | required | positive | 基于 1 的 UTF-16 起始行。 | [src/core/ir/schema.ts:332](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L332) |
|  | `startColumn` | integer | required | positive | 基于 1 的 UTF-16 起始列。 | [src/core/ir/schema.ts:333](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L333) |
|  | `endLine` | integer | required | positive | 基于 1 的 UTF-16 结束行。 | [src/core/ir/schema.ts:334](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L334) |
|  | `endColumn` | integer | required | positive | 不包含边界的 UTF-16 结束列。 | [src/core/ir/schema.ts:335](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L335) |
| `GeneratedInstructionCriterion` | `id` | string | required | `STEP_ID_PATTERN` | 待归因的准则。 | [src/core/ir/schema.ts:350](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L350) |
|  | `kind` | string | required | enum `success`, `action` | 子句角色。 | [src/core/ir/schema.ts:351](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L351) |
|  | `citation` | string | required | min 1; max `4096` | 逐字引用的提供方摘录。 | [src/core/ir/schema.ts:352](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L352) |
| `InstructionCriterion` | `id` | string | required | `STEP_ID_PATTERN` | 已提交的准则 ID。 | [src/core/ir/schema.ts:366](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L366) |
|  | `kind` | string | required | enum `success`, `action` | 子句角色。 | [src/core/ir/schema.ts:367](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L367) |
|  | `sourceSpan` | `InstructionSourceSpan` | required | strict nested object | 本地派生的 prompt 位置。 | [src/core/ir/schema.ts:368](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L368) |

`ElementRef` 目前仅有 `AccessibilityElementRef`。`HexSha256` 为 `/^[0-9a-f]{64}$/`；`StepId` 与 `InstructionCriterionId` 为 `/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/`；`RunVariableName` 为 `/^[a-z][a-zA-Z0-9]*$/`；`RunRef` 为 `/^\\{\\{run\\.[A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)*\\}\\}$/`。[src/core/ir/schema.ts:35](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L35), [src/core/ir/schema.ts:41](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L41), [src/core/ir/schema.ts:198](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L198), [src/core/ir/schema.ts:237](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L237), [src/core/ir/schema.ts:311](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L311), [src/core/ir/schema.ts:381](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L381), [src/core/ir/schema.ts:396](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L396)

## 标量与引用契约 {#scalar-contracts}

| Type | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `SecretRef` | string | value | `/^\\{\\{secrets\\.[A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)*\\}\\}$/` | 完整的 secret 引用。 | [src/core/ir/schema.ts:31](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L31), [src/core/ir/schema.ts:33](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L33), [src/core/ir/schema.ts:74](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L74) |
| `SecretSinkOrigin` | string | value | `/^https?:\\/\\/[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*(?::(?:6553[0-5]|655[0-2][0-9]|65[0-4][0-9]{2}|6[0-4][0-9]{3}|[1-5][0-9]{4}|[1-9][0-9]{0,3}))?$/`; no-secret pattern | 仅限 HTTP(S) 源。 | [src/core/ir/schema.ts:40](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L40), [src/core/ir/schema.ts:95-97](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L95-L97) |
| `InterpolatableText` | string | value | `/^(?![\\s\\S]*\\{\\{secrets\\.)[\\s\\S]*$/` | 文本可包含 run 插值，但不得包含 secret 令牌。 | [src/core/ir/schema.ts:37](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L37), [src/core/ir/schema.ts:125](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L125) |
| `Citation` | string | value | min 1; max `4096` | 归因前精确的 prompt 子字符串。 | [src/core/ir/schema.ts:273](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L273), [src/core/ir/schema.ts:279](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L279) |
| `JsonValue` | JSON scalar/array/object | value | RFC 8259 recursive union | 元数据或提供方歧义值。 | [src/core/ir/schema.ts:1167](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1167) |

`secretSinkOrigins` 中缺失的 secret 条目默认将该 secret 指向 `baseUrl`；显式的空数组拒绝所有源；非空数组则替换默认值。[src/core/ir/schema.ts:152-157](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L152-L157) `SourceSpan` 顺序以及所有 `InstructionSourceSpan` 的 prompt 坐标检查均属于语义验证。[src/core/ir/schema.ts:254](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L254), [src/core/ir/schema.ts:328](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L328)

## 示例 {#examples}

```json
{"strategy":"accessibility","role":"button","name":"Sign in"}
```

```json
{"algorithm":"a11y-neighborhood-v2","hash":"0000000000000000000000000000000000000000000000000000000000000000"}
```

## 设计理由 {#rationale}

共享对象解决了计划（plan）、生成响应（generation response）与 grounding逐渐引入互不兼容的定位器、引用和溯源信息的问题。该设计将严格的运行时定义统一置于一个 schema 中，并从中派生 JSON Schema。

所选设计将完整值的 secret 和 run 引用与普通文本分离开来，并将提供方引文与已提交的源区间分离开来。因此，本地代码而非 AI 生成的摘录对持久溯源信息具有权威性。

一个被否决的备选方案是在每个文档中独立定义定位器和 secret 语法；该方案被否决是因为审查无法发现看似兼容的漂移。另一个被否决的方案是将引文视为持久权威；该方案被否决是因为相对于 prompt 的验证必须具有确定性且在本地进行。 
