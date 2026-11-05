---
title: "值类型"
description: "本章定义其他章节按名称引用的共享对象和标量契约。"
---

## 共享类型 {#shared-types}

所有其他章节必须 (MUST) 使用这些定义，而不是重述它们的形状。下列每个对象都是严格对象，必须 (MUST) 拒绝未知属性 (`src/core/ir/schema.ts:231`) (`src/core/ir/schema.ts:254`)。正则表达式逐字引自运行时的权威定义。

| Type | field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `TargetDefinition` | `baseUrl` | string | required | `/^https?:\/\/[^\s/?#]\S*$/`; `/^(?![\s\S]*\{\{secrets\.)[\s\S]*$/` | 无 secret 标记的已创作 HTTP(S) 基准 URL。 | `src/core/ir/schema.ts:37-38,233` |
|  | `surface` | string | required | literal `web` | 执行界面。 | `src/core/ir/schema.ts:232` |
|  | `secretSinkOrigins` | record `SecretRef` → `SecretSinkOrigin[]` | optional | See scalar table | 每个 secret 允许的源。 | `src/core/ir/schema.ts:234` |
|  | `locale` | string | optional | min length 1 | 由配置加载器规范化后的 BCP-47 格式 locale 标签。 | `src/core/ir/schema.ts:235` |
| `AccessibilityElementRef` | `strategy` | string | required | literal `accessibility` | 定位器鉴别器。 | `src/core/ir/schema.ts:254` |
|  | `role` | string | required | min 1 | 精确的可访问性角色。 | `src/core/ir/schema.ts:256` |
|  | `name` | string | required | min 1 | 可访问名称。 | `src/core/ir/schema.ts:257` |
| `GroundingElementLocator` | `strategy` | string | required | literal `accessibility` | 定位器鉴别器。 | `src/core/ir/schema.ts:276` |
|  | `role` | string | required | min 1 | 精确匹配的无障碍角色。 | `src/core/ir/schema.ts:278` |
|  | `name` | string | required | may be empty | 空字符串表示没有 accessible name 的元素，仅匹配规范化后名称为空的节点。 | `src/core/ir/schema.ts:279` |
| `Quote` | `text` | string | required | min 1; max 4096; no-secrets-literal pattern | 字面引用的摘录文本。 | `src/core/ir/schema.ts:407` |
|  | `sourceSpan` | `InstructionSourceSpan` | required | strict nested object | 引用摘录的位置。 | `src/core/ir/schema.ts:408` |
| `ElementIntent` | `description` | string | required | min 1; max 4096; no-secrets-literal pattern | 有来源依据的自然语言元素描述。 | `src/core/ir/schema.ts:415` |
|  | `sourceSpan` | `InstructionSourceSpan` | required | strict nested object | 描述摘录的位置。 | `src/core/ir/schema.ts:416` |
|  | `roleHint` | string | optional | `/^[a-z]+$/` | 可选的小写无障碍角色提示。 | `src/core/ir/schema.ts:417` |
|  | `quote` | `Quote` | optional | strict nested object | 可选的 UI 文本字面引用，在提示词中独立定位。 | `src/core/ir/schema.ts:418` |
| `QuotedElementIntent`（扩展 `ElementIntent`） | `quote` | `Quote` | required | strict nested object | 必需的 UI 文本字面引用。 | `src/core/ir/schema.ts:424` |
| `Fingerprint` | `algorithm` | string | required | literal `a11y-neighborhood-v2` | 定位器证据格式。 | `src/core/ir/schema.ts:320` |
|  | `hash` | string | required | `/^[0-9a-f]{64}$/` | 小写 SHA-256。 | `src/core/ir/schema.ts:35,321` |
| `InstructionSourceSpan` | `startLine` | integer | required | positive | 基于 1 的 UTF-16 起始行。 | `src/core/ir/schema.ts:372` |
|  | `startColumn` | integer | required | positive | 基于 1 的 UTF-16 起始列。 | `src/core/ir/schema.ts:373` |
|  | `endLine` | integer | required | positive | 基于 1 的 UTF-16 结束行。 | `src/core/ir/schema.ts:374` |
|  | `endColumn` | integer | required | positive | 不包含边界的 UTF-16 结束列。 | `src/core/ir/schema.ts:375` |
| `GeneratedInstructionCriterion` | `id` | string | required | `STEP_ID_PATTERN` | 待归因的准则。 | `src/core/ir/schema.ts:393` |
|  | `kind` | string | required | enum `success`, `action` | 子句角色。 | `src/core/ir/schema.ts:394` |
|  | `startAnchor` | string | required | none (format and range checked by usecase policy) | provider 声称的起始行锚点（`L<n>`）。 | `src/core/ir/schema.ts:395` |
|  | `startColumn` | integer | required | none (range checked by usecase policy) | provider 声称的基于 1 的 UTF-16 起始列。 | `src/core/ir/schema.ts:396` |
|  | `endAnchor` | string | required | none (format and range checked by usecase policy) | provider 声称的结束行锚点（`L<n>`）。 | `src/core/ir/schema.ts:397` |
|  | `endColumn` | integer | required | none (range checked by usecase policy) | provider 声称的不包含边界的 UTF-16 结束列。 | `src/core/ir/schema.ts:398` |
|  | `citation` | string | required | min 1; max `4096` | 逐字引用的提供方摘录(仅作校验和使用，不用于定位)。 | `src/core/ir/schema.ts:399` |
| `InstructionCriterion` | `id` | string | required | `STEP_ID_PATTERN` | 已提交的准则 ID。 | `src/core/ir/schema.ts:506` |
|  | `kind` | string | required | enum `success`, `action` | 子句角色。 | `src/core/ir/schema.ts:507` |
|  | `sourceSpan` | `InstructionSourceSpan` | required | strict nested object | 本地派生的 prompt 位置。 | `src/core/ir/schema.ts:508` |
| `SecretNameChoice` | `allowedName` | `SecretName` | exclusive alternative | strict one-field object | provider 请求复用已投影的允许列表名称。 | `src/core/ir/schema.ts:144-147` |
|  | `nameHint` | `SecretNameHint` | exclusive alternative | strict one-field object | provider 对新发现名称的提议。 | `src/core/ir/schema.ts:144-147` |

`ElementRef` 目前只有 `AccessibilityElementRef`。`HexSha256` 是 `/^[0-9a-f]{64}$/`。`StepId` 和 `InstructionCriterionId` 是 `/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/`。`RunVariableName` 是 `/^[a-z][a-zA-Z0-9]*$/`。`RunRef` 是 `/^\{\{run\.[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*\}\}$/` (`src/core/ir/schema.ts:35,41,42,43,290,335,353,520,535`)。

## 标量与引用契约 {#scalar-contracts}

| Type | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `SecretRef` | string | value | `/^\{\{secrets\.[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*\}\}$/` | 完整的 secret 引用。 | `src/core/ir/schema.ts:32,33,108` |
| `SecretName` | string | value | `/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/` | 供同意和配置使用的裸逻辑名称。 | `src/core/ir/schema.ts:32,123` |
| `SecretNameHint` | string | value | `/^[a-z][a-z0-9_]{0,63}$/` | provider 的回退命名候选，而非已提交引用。 | `src/core/ir/schema.ts:133` |
| `SecretSinkOrigin` | string | value | `/^https?:\/\/[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*(?::(?:6553[0-5]\|655[0-2][0-9]\|65[0-4][0-9]{2}\|6[0-4][0-9]{3}\|[1-5][0-9]{4}\|[1-9][0-9]{0,3}))?$/`; no-secret pattern | 仅限 HTTP(S) 源。 | `src/core/ir/schema.ts:40,163-165` |
| `InterpolatableText` | string | value | `/^(?![\s\S]*\{\{secrets\.)[\s\S]*$/` | 文本可包含 run 插值，但不得包含 secret 令牌。 | `src/core/ir/schema.ts:37,193` |
| `Citation` | string | value | min 1; max `4096` | 归因前精确的 prompt 子字符串。 | `src/core/ir/schema.ts:342,399` |
| `JsonValue` | JSON scalar/array/object | value | RFC 8259 recursive union | 元数据或提供方歧义值。 | `src/core/ir/schema.ts:1516` |

`secretSinkOrigins` 中没有某个机密的条目时，该机密默认使用 `baseUrl`；显式的空数组拒绝所有来源；非空数组则替换默认值 (`src/core/ir/schema.ts:220-223`)。`InstructionSourceSpan` 的所有提示词坐标检查都属于语义校验 (`src/usecases/instruction-coverage-policy.ts:501-531`)。

## 示例 {#examples}

```json
{"strategy":"accessibility","role":"button","name":"Sign in"}
```

```json
{"algorithm":"a11y-neighborhood-v2","hash":"0000000000000000000000000000000000000000000000000000000000000000"}
```

## 设计理由 {#rationale}

共享对象解决的问题是：执行计划、生成响应和定位缓存会逐渐引入互不兼容的定位器、引用和溯源信息。该设计把严格的运行时定义放进同一个模式，并由它派生 JSON Schema。

所选设计把整值的机密引用和运行引用与普通文本分开，也把提供方的命名意图与已提交的机密引用分开。对持久授权具有权威的是本地命名和同意，而不是 AI 生成的引用。

被否决的备选方案之一是在每个文档中独立定义定位器和机密语法，因为评审无法发现看似兼容的漂移。另一个是把引文当作持久的权威，因为针对提示词的验证必须是确定性的，并且在本地完成。
