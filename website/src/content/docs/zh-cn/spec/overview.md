---
title: "Ambercast 计划规范"
description: "本规范描述了 ambercast 0.3.1 接受的工件。"
---

## 状态 {#status}

本规范描述了 ambercast 0.3.1 接受的工件。该实现接受 Plan 模式版本 2 和 Grounding 模式版本 1。[src/core/ir/schema.ts:57](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L57) [src/core/ir/schema.ts:64](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L64)

## 规范性用语 {#normative-language}

词语 **MUST**、**SHOULD** 与 **MAY** 均按 RFC 2119 要求用语进行解释。符合规范的生产者必须（MUST）仅生成此处定义的版本和结构；消费者必须（MUST）拒绝其无法验证的结构。

## 依赖模型 {#dependency-model}

```mermaid
flowchart LR
  P[normalized prompt] --> I[inputsDigest]
  I --> D[PlanDocument]
  D --> PD[planDigest]
  PD --> G[GroundingDocument]
  G --> R[replay]
```

每条摘要路径都必须（MUST）使用 [规范 JSON](/ambercast/zh-cn/spec/canonical-json/#digest-form)。`inputsDigest` 绑定规范化提示词、模式、生产者输入以及目标；`planDigest` 绑定与重放相关的计划内容。[src/core/ir/digest.ts:91](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/digest.ts#L91) [src/core/ir/digest.ts:118](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/digest.ts#L118)

## 兼容性 {#compatibility}

| 工件 | 接受的值 | 证据 |
| --- | --- | --- |
| Plan `schemaVersion` | `2` | [src/core/ir/schema.ts:57](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L57) |
| Grounding `schemaVersion` | `1` | [src/core/ir/schema.ts:64](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L64) |
| 指纹算法 | `a11y-neighborhood-v2` | [src/core/ir/schema.ts:221](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L221) |
| Report `schemaVersion` | `3.1` | [src/report/schema.ts:22](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/report/schema.ts#L22) |

## 阅读顺序 {#reading-order}

先阅读 [计划文档](/ambercast/zh-cn/spec/plan-document/#document-shape)、[步骤](/ambercast/zh-cn/spec/steps/#step-union) 与 [值类型](/ambercast/zh-cn/spec/value-types/#shared-types)；然后阅读 [新鲜度与摘要](/ambercast/zh-cn/spec/freshness/#inputs-digest)、[Grounding 文档](/ambercast/zh-cn/spec/grounding-document/#grounding-shape) 与 [元素指纹](/ambercast/zh-cn/spec/fingerprint/#algorithm)。实现者必须（MUST）以 [规范 JSON](/ambercast/zh-cn/spec/canonical-json/#digest-form)、[计划中的机密](/ambercast/zh-cn/spec/secrets/#authorization) 和 [符合性](/ambercast/zh-cn/spec/conformance/#semantic-validation) 结束。

## 设计理由 {#rationale}

问题在于，读者在能够安全地解释各字段之前，必须区分编写意图、派生执行与易失的 grounding。

所选用的依赖优先呈现方式，使得在展示详细模式之前，摘要边界与兼容性版本就已经清晰可见。

一个被否决的备选方案是单一无差别的工件；它被否决是因为计划与 UI 证据具有不同的失效规则。另一个被否决的方案是章节局部版本控制；它被否决是因为兼容性属于文档系统级的契约。 
