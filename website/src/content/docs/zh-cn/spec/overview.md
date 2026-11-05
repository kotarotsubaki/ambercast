---
title: "Ambercast 执行计划规范"
description: "本规范描述了 ambercast 0.9.0 接受的工件。"
---

## 状态 {#status}

本规范描述了 ambercast 0.9.0 接受的工件。该实现接受执行计划模式版本 5 和定位缓存模式版本 4 (`src/core/ir/schema.ts:62`) (`src/core/ir/schema.ts:74`)。

## 规范性用语 {#normative-language}

词语 **MUST**、**SHOULD** 与 **MAY** 均按 RFC 2119 的要求用语解释。符合规范的生产者必须 (MUST) 只生成此处定义的版本和结构；消费者必须 (MUST) 拒绝其无法验证的结构。

## 依赖模型 {#dependency-model}

<figure class="ac-flow" aria-label="从规范化提示词到回放的依赖链。摘要绑定规范化提示词、模式、生产者输入和目标。执行计划把该摘要记录为 inputsDigest。planDigest 绑定与回放相关的执行计划内容。定位缓存文档绑定到 planDigest，只有与重新计算的摘要相等时才会被接受。回放读取已绑定的定位缓存。">
<div class="ac-flow-node"><div class="ac-flow-head"><span class="ac-flow-num">PROMPT</span></div><p class="ac-flow-title">规范化提示词</p></div>
<div class="ac-flow-link"><svg aria-hidden="true" viewbox="0 0 28 52" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2v46M8 42l6 6 6-6"></path></svg><span class="ac-flow-cond"><b>摘要绑定规范化提示词、模式、生产者输入和目标</b></span></div>
<div class="ac-flow-node"><div class="ac-flow-head"><span class="ac-flow-num">DIGEST</span></div><p class="ac-flow-title">inputsDigest</p></div>
<div class="ac-flow-link"><svg aria-hidden="true" viewbox="0 0 28 52" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2v46M8 42l6 6 6-6"></path></svg><span class="ac-flow-cond"><b>执行计划把该摘要记录为 inputsDigest</b></span></div>
<div class="ac-flow-node ac-flow-stage"><div class="ac-flow-head"><span class="ac-flow-num">PLAN</span><span class="ac-flow-chip ac-flow-chip-ai">可能调用 AI</span></div><p class="ac-flow-title">PlanDocument</p></div>
<div class="ac-flow-link"><svg aria-hidden="true" viewbox="0 0 28 52" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2v46M8 42l6 6 6-6"></path></svg><span class="ac-flow-cond"><b>planDigest 绑定与回放相关的执行计划内容</b></span></div>
<div class="ac-flow-node"><div class="ac-flow-head"><span class="ac-flow-num">DIGEST</span></div><p class="ac-flow-title">planDigest</p></div>
<div class="ac-flow-link"><svg aria-hidden="true" viewbox="0 0 28 52" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2v46M8 42l6 6 6-6"></path></svg><span class="ac-flow-cond"><b>定位缓存文档绑定到 planDigest，只有与重新计算的摘要相等时才会被接受</b></span></div>
<div class="ac-flow-node ac-flow-stage"><div class="ac-flow-head"><span class="ac-flow-num">GROUNDING</span></div><p class="ac-flow-title">GroundingDocument</p></div>
<div class="ac-flow-link"><svg aria-hidden="true" viewbox="0 0 28 52" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2v46M8 42l6 6 6-6"></path></svg><span class="ac-flow-cond"><b>回放读取已绑定的定位缓存</b></span></div>
<div class="ac-flow-node"><div class="ac-flow-head"><span class="ac-flow-num">REPLAY</span><span class="ac-flow-chip ac-flow-chip-replay">缓存的定位缓存可直接回放时不调用 AI</span></div><p class="ac-flow-title">回放</p></div>
</figure>

每条摘要路径都必须 (MUST) 使用[规范 JSON](/ambercast/zh-cn/spec/canonical-json/#digest-form)。`inputsDigest` 绑定规范化提示词、模式、生产者输入以及目标，`planDigest` 绑定与回放相关的执行计划内容 (`src/core/ir/digest.ts:130`) (`src/core/ir/digest.ts:153`)。

执行计划记录自己的 `inputsDigest`，`planDigest` 由执行计划计算得出。定位缓存文档只有在其 `planDigest` 与重新计算的摘要相等时才会被接受，定义见[定位缓存文档](/ambercast/zh-cn/spec/grounding-document/#authority-and-binding)。回放读取已绑定的定位缓存。

## 兼容性 {#compatibility}

| 产物 | 接受的值 | 证据 |
| --- | --- | --- |
| 执行计划的 `schemaVersion` | `5` | `src/core/ir/schema.ts:62` |
| 定位缓存的 `schemaVersion` | `4` | `src/core/ir/schema.ts:74` |
| 指纹算法 | `a11y-neighborhood-v2` | `src/core/ir/schema.ts:303` |
| Report `schemaVersion` | `3.11` | `src/report/schema.ts:58` |

## 阅读顺序 {#reading-order}

先阅读[执行计划文档](/ambercast/zh-cn/spec/plan-document/#document-shape)、[步骤](/ambercast/zh-cn/spec/steps/#step-union)与[值类型](/ambercast/zh-cn/spec/value-types/#shared-types)，再阅读[新鲜度与摘要](/ambercast/zh-cn/spec/freshness/#inputs-digest)、[定位缓存文档](/ambercast/zh-cn/spec/grounding-document/#grounding-shape)与[元素指纹](/ambercast/zh-cn/spec/fingerprint/#algorithm)。实现者必须 (MUST) 最后阅读[规范 JSON](/ambercast/zh-cn/spec/canonical-json/#digest-form)、[执行计划中的机密](/ambercast/zh-cn/spec/secrets/#authorization)和[符合性](/ambercast/zh-cn/spec/conformance/#semantic-validation)。

## 设计理由 {#rationale}

问题在于，读者在安全地解释各字段之前，必须先把作者的意图、派生出的执行和易变的定位缓存区分开。

所选的依赖优先的呈现方式，让摘要边界和兼容性版本先于详细模式显现出来。

被否决的备选方案之一是单一而无区分的产物，因为执行计划与 UI 证据的失效规则不同。另一个是各章各自维护版本，因为兼容性是文档体系级的契约。
