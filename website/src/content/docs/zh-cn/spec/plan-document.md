---
title: "执行计划文档"
description: "本章定义已提交的执行计划文件的顶层对象 `PlanDocument`、它的最小示例，以及本地生成据以转换为该对象的生成响应。"
---

## 文档形态 {#document-shape}

`PlanDocument` 是一个严格对象。生产者必须 (MUST) 输出字面量 `5`，消费者必须 (MUST) 拒绝未知属性和其他版本 (`src/core/ir/schema.ts:62`) (`src/core/ir/schema.ts:1541-1546`)。

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `schemaVersion` | integer | required | literal `5` | 执行计划格式版本。 | `src/core/ir/schema.ts:62,1542` |
| `source` | strict object | required | exactly `inputsDigest` | 新鲜度包装器。 | `src/core/ir/schema.ts:1543` |
| `source.inputsDigest` | string | required | `/^[0-9a-f]{64}$/` | 生成输入的摘要。 | `src/core/ir/schema.ts:35,1543` |
| `generatorMeta` | record string → `JsonValue` | optional | JSON only | 从 `planDigest` 中排除的元数据。 | `src/core/ir/schema.ts:1544`、`src/core/ir/digest.ts:153-157` |
| `targets` | record string → `TargetDefinition` | required | strict value; [值类型](/ambercast/zh-cn/spec/value-types/#shared-types) | 被引用的目标快照；每个键都必须被某个步骤使用。 | `src/core/ir/schema.ts:1545,1569-1578` |
| `steps` | `Step[]` | required | ordered strict branches | 执行计划序列；[步骤](/ambercast/zh-cn/spec/steps/#step-union)。 | `src/core/ir/schema.ts:1546` |

对于 `generatorMeta`，省略与 `{}` 仍是不同的序列化值，但二者都不影响 `planDigest`，因为摘要视图整体排除了 `generatorMeta` (`src/core/ir/schema.ts:1544`) (`src/core/ir/digest.ts:153-157`)。

## 完整最小文档 {#complete-minimal-document}

摘要字符串只是示意用的占位符。定位缓存示例使用同一个示意用的 `planDigest`，并声明它指向这个执行计划示例。

```json
{
  "schemaVersion": 5,
  "source": {"inputsDigest": "0000000000000000000000000000000000000000000000000000000000000000"},
  "targets": {"app": {"surface": "web", "baseUrl": "https://example.test"}},
  "steps": [{"id": "open-home", "kind": "action", "action": "navigate", "target": "app", "url": "https://example.test"}]
}
```

## 语义约束 {#semantic-constraints}

步骤 ID 必须 (MUST) 唯一；出现重复时，会在靠后的 `steps[index].id` 处报告 `duplicate step id: <id>` (`src/core/ir/schema.ts:1551-1558`)。指令覆盖要求进行[符合性](/ambercast/zh-cn/spec/conformance/#semantic-validation)中规定的、与提示词绑定的本地归属和集合检查 (`src/usecases/instruction-coverage-policy.ts:379-538`)。

## 仅提供方生成响应 {#provider-generation-response}

提供方不编写 `schemaVersion`、`source` 或 `targets`。在校验已提交的执行计划之前，本地生成会补上这些字段。提供方对机密命名的意图，会在形成已提交的 `SecretRef` 之前于本地解析 (`src/core/ir/schema.ts:1611-1624`) (`src/core/ir/schema.ts:1022-1029,1146`)。

提供方为含元素的步骤提议的形式，使用瞬态的 `GeneratedElementIntent` 和 `GeneratedQuotedElementIntent`，而不是已提交的 `ElementIntent` 和 `QuotedElementIntent`。它们的锚点坐标与 `GeneratedInstructionCriterion` 一致 (`src/core/ir/schema.ts:392-400,435-457`)。

| object | field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `GeneratedPlanResponse` | `steps` | `GeneratedStep[]` | required | generated forms in [步骤](/ambercast/zh-cn/spec/steps/#generated-forms) | 提供方提议。 | `src/core/ir/schema.ts:1612` |
|  | `generatorMeta` | record string → `JsonValue` | optional | JSON only | 提供方元数据。 | `src/core/ir/schema.ts:1613` |
|  | `ambiguities` | `JsonValue[]` | required | none | 无法分配目标的步骤。 | `src/core/ir/schema.ts:1622` |
|  | `assumptions` | `string[]` | optional | string items only | 提示词未说明的其他假设。作为报告警告，不保存到执行计划中。 | `src/core/ir/schema.ts:1623` |
| `VerificationIntent` | `criterionId` | `InstructionCriterionId` | required | step-ID regex | 提议的成功准则。 | `src/core/ir/schema.ts:1187` |
|  | `assertion` | `TraceAssert` | required | strict trace assertion | 瞬态终态证据。 | `src/core/ir/schema.ts:1188` |

`GeneratedPlanResponseForPolicy` 把 AI 的 `verificationIntent` 断言放宽为 `JsonValue`。`GeneratedPlanResponseRequest` 允许空的 `verificationIntent`。两者都是瞬态形式，绝不会成为已提交的执行计划形式 (`src/core/ir/schema.ts:1636,1672`)。

## 设计理由 {#rationale}

问题在于，既要保留经过评审的测试意图，又要让生成出的执行细节可以复现。执行计划是派生数据，所以它记录生成来源，但不会取代源提示词。

所选的严格、带版本的文档记录目标快照和有序步骤，把结果留在文档之外。这使执行计划摘要在多次回放之间保持稳定，也让输入变化时的重新生成变得明确。

被否决的备选方案之一是把轨迹合并进执行计划，因为一次成功的执行就会改写经过评审的意图。另一个是原地迁移旧的执行计划，因为语义已变化的派生产物，重新生成比悄悄重新解释更安全。
