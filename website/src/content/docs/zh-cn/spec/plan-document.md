---
title: "计划文档"
description: "`PlanDocument` 是一个严格对象。"
---

## 文档形态 {#document-shape}

`PlanDocument` 是一个严格对象。生成方必须（MUST）输出字面量版本 2，且消费方必须（MUST）拒绝未知属性及其他版本。[src/core/ir/schema.ts:1189](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1189)

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `schemaVersion` | integer | required | literal `2` | 计划格式版本。 | [src/core/ir/schema.ts:57](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L57), [src/core/ir/schema.ts:1190](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1190) |
| `source` | strict object | required | exactly `inputsDigest` | 新鲜度包装器。 | [src/core/ir/schema.ts:1191](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1191) |
| `source.inputsDigest` | string | required | `/^[0-9a-f]{64}$/` | 生成输入的摘要。 | [src/core/ir/schema.ts:35](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L35), [src/core/ir/schema.ts:1191](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1191) |
| `generatorMeta` | record string → `JsonValue` | optional | JSON only | 从 `planDigest` 中排除的元数据。 | [src/core/ir/schema.ts:1189-1193](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1189-L1193); [src/core/ir/digest.ts:128-131](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/digest.ts#L128-L131) |
| `targets` | record string → `TargetDefinition` | required | strict value; [值类型](/ambercast/zh-cn/spec/value-types/#shared-types) | 目标快照。 | [src/core/ir/schema.ts:1193](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1193) |
| `steps` | `Step[]` | required | ordered strict branches | 计划序列；[步骤](/ambercast/zh-cn/spec/steps/#step-union)。 | [src/core/ir/schema.ts:1194](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1194) |

对于 `generatorMeta`，省略与 `{}` 仍是不同的序列化 Plan 值，但二者均不影响 `planDigest`：摘要视图整体排除了 `generatorMeta`。[src/core/ir/schema.ts:1189-1193](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1189-L1193) [src/core/ir/digest.ts:128-131](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/digest.ts#L128-L131)

## 完整最小文档 {#complete-minimal-document}

摘要字符串为说明性占位符。Grounding 示例使用了相同的说明性 `planDigest`，并声明其指向该确切的 Plan 示例。

```json
{
  "schemaVersion": 2,
  "source": {"inputsDigest": "0000000000000000000000000000000000000000000000000000000000000000"},
  "targets": {"app": {"baseUrl": "https://example.test", "browser": "chromium"}},
  "steps": [{"id": "open-home", "kind": "action", "action": "navigate", "url": "https://example.test"}]
}
```

## 语义约束 {#semantic-constraints}

步骤 ID 必须唯一（MUST）；重复项会在靠后的 `steps[index].id` 处报告 `duplicate step id: <id>`。[src/core/ir/schema.ts:1180-1204](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1180-L1204) 指令覆盖率要求在 [符合性](/ambercast/zh-cn/spec/conformance/#semantic-validation) 中进行绑定提示词的本地归因与集合检查。[src/usecases/instruction-coverage-policy.ts:337-496](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/instruction-coverage-policy.ts#L337-L496)

## 仅提供方生成响应 {#provider-generation-response}

提供方不创作 `schemaVersion`、`source` 或 `targets`；本地生成会在已提交计划验证之前添加它们。[src/core/ir/schema.ts:1227](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1227)

| object | field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `GeneratedPlanResponse` | `steps` | `GeneratedStep[]` | required | generated forms in [步骤](/ambercast/zh-cn/spec/steps/#generated-forms) | 提供方提议。 | [src/core/ir/schema.ts:1234](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1234) |
|  | `generatorMeta` | record string → `JsonValue` | optional | JSON only | 提供方元数据。 | [src/core/ir/schema.ts:1236](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1236) |
|  | `ambiguities` | `JsonValue[]` | required | none | 歧义有效负载。 | [src/core/ir/schema.ts:1237](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1237) |
| `VerificationIntent` | `criterionId` | `InstructionCriterionId` | required | step-ID regex | 提议的成功准则。 | [src/core/ir/schema.ts:844](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L844) |
|  | `assertion` | `TraceAssert` | required | strict trace assertion | 瞬态终态证据。 | [src/core/ir/schema.ts:846](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L846) |

`GeneratedPlanResponseForPolicy` 将 AI 的 `verificationIntent` 断言放宽为 `JsonValue`；`GeneratedPlanResponseRequest` 允许空的 `verificationIntent`。二者均为瞬态形式，绝非已提交的 Plan 形式。[src/core/ir/schema.ts:1250](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1250), [src/core/ir/schema.ts:1286](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1286)

## 设计理由 {#rationale}

所面临的问题是在允许生成的执行细节具有可复现性的同时，保留经过评审的测试意图。计划是派生数据，因此它在暴露生成出处的同时不会变成源提示词。

所选定的严格且带版本的文档捕获了目标快照和有序步骤，同时将执行结果保留在文档之外。这使得计划摘要在重放时保持稳定，并在输入发生变更时显式重新生成。

一个被否决的替代方案是将 trace 合并到计划中；它之所以被否决，是因为成功的执行会改写经过评审的意图。另一个被否决的替代方案是就地迁移旧计划；它之所以被否决，是因为对于语义发生变更的派生构件而言，重新生成比隐式重新解释更加安全。 
