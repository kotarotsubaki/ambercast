---
title: "新鲜度与摘要"
description: "`inputsDigest` 必须（MUST）是对新构建对象的规范 JSON（canonical JSON）计算得出的小写 SHA-256，该对象精确包含以下五个成员：`normalizedTestMd`、`schemaVersion`、`generatorPromptTemplateFingerprint`、`planProducerBundleFingerprint` 和 `targetDefinitions`。"
---

## 输入摘要 {#inputs-digest}

`inputsDigest` 必须（MUST）是对新构建对象的规范 JSON（canonical JSON）计算得出的小写 SHA-256，该对象精确包含以下五个成员：`normalizedTestMd`、`schemaVersion`、`generatorPromptTemplateFingerprint`、`planProducerBundleFingerprint` 和 `targetDefinitions`。成员插入顺序没有任何意义，因为规范 JSON 会对对象键进行排序。[src/core/ir/digest.ts:93](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/digest.ts#L93) [src/core/ir/digest.ts:105](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/digest.ts#L105) [src/core/ir/canonical-json.ts:147](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/canonical-json.ts#L147) 不得直接对输入对象本身进行哈希计算（MUST NOT）。[src/core/ir/digest.ts:97](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/digest.ts#L97) 生成器包指纹独立表示计划语义的生成器配置，因此单凭模板字节是不充分的。[src/core/ir/digest.ts:70](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/digest.ts#L70)

## 计划摘要 {#plan-digest}

`planDigest` 必须（MUST）对排除了 `generatorMeta` 的 PlanDocument 计算哈希。[src/core/ir/digest.ts:118](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/digest.ts#L118) Grounding 的当前有效性是指其存储的 `planDigest` 与计算出的计划摘要完全相等。[src/core/ir/digest.ts:145](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/digest.ts#L145)

要计算 `planDigest`，复制除 `generatorMeta` 外的所有 Plan 字段，按照 [规范 JSON](/ambercast/zh-cn/spec/canonical-json/#digest-form) 规范化剩余对象，对其 UTF-8 字节进行 SHA-256 计算，并将摘要编码为小写十六进制。[src/core/ir/digest.ts:128](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/digest.ts#L128) 规范化提示词、模式版本、模板指纹、生成器包指纹、目标名称或目标定义的变更，都会使存储的 `inputsDigest` 变陈旧。[src/core/ir/digest.ts:52](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/digest.ts#L52), [src/core/ir/digest.ts:60](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/digest.ts#L60), [src/core/ir/digest.ts:68](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/digest.ts#L68), [src/core/ir/digest.ts:77](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/digest.ts#L77), [src/core/ir/digest.ts:87](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/digest.ts#L87)

## 新鲜度后果 {#freshness-consequences}

当存储的 `inputsDigest` 与当前值不同时，消费者必须（MUST）将计划标记为 `stale`。[src/usecases/check.ts:500](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/check.ts#L500) 生成器包指纹是独立的新鲜度输入，因此即使提示词和目标数据未发生变化，实现的变更也会使计划变陈旧。[src/core/ir/digest.ts:70](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/digest.ts#L70) 当 `planDigest` 不同时，消费者必须（MUST）将 plan/grounding 配对视为未绑定。[src/core/ir/digest.ts:145](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/digest.ts#L145)

本节是 `check` 状态推导的规范权威（canonical owner）。参考页面必须仅（MUST）出于其局部目的对其进行概述，并链接至此处。下表对 `check` 结果值具有规范性约束。下方的 `missing`、`invalid` 和 `stale` 是 grounding 检查分类，而非报告 `status` 值。[src/usecases/check-grounding.ts:18](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/check-grounding.ts#L18) [src/report/schema.ts:525](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/report/schema.ts#L525)

| id | `check` 状态 | 推导 | 结果分类 |
| --- | --- | --- | --- |
| CHK-01 | `fresh` | Plan 解析成功、符合规范格式、具有有效的已提交覆盖范围，其 `inputsDigest` 匹配且其伴生项有效。 | pass |
| CHK-02 | `stale` | Plan 为无效 JSON/模式/规范格式或已提交覆盖范围无效，或其 `inputsDigest` 不一致。 | fail |
| CHK-03 | `fresh-without-grounding` | Plan 为 fresh；伴生项无效；仓库策略为 `uncommitted`。 | pass |
| CHK-04 | `missing-grounding` | Plan 为 fresh；伴生项检查结果为 `missing`；策略要求已提交的 grounding。 | fail |
| CHK-05 | `invalid-grounding` | Plan 为 fresh；伴生项检查结果为 `invalid`（JSON/模式/规范覆盖范围失败）。 | fail |
| CHK-06 | `stale-grounding` | Plan 为 fresh；伴生项检查结果为 `stale`（存在另一个 `planDigest`）。 | fail |
| CHK-07 | `missing-plan` | 选定的测试没有 plan 制品。 | fail |
| CHK-08 | `orphaned-plan` | 范围内的 plan 反向映射到不存在的测试路径。 | fail |
| CHK-09 | `orphaned-grounding` | 范围内的 grounding 制品反向映射到不存在对应测试提示词的路径。 | fail |
| CHK-10 | `invalid-artifact-name` | 制品路径无法反向推导出测试标识。 | fail |
| CHK-11 | `listed` | 仅发现式的列出操作不检查选定的路径。 | skipped |
| CHK-12 | `skipped` | 中断留下了仅包含标识的待处理行。 | skipped |

`fresh` 与 `fresh-without-grounding` 行判定为 pass；上方分类为 fail 的所有行均计入 failure；`listed` 与 `skipped` 为 skipped。[src/usecases/check-report.ts:71](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/check-report.ts#L71)

## 设计理由 {#rationale}

所面临的问题在于判定派生计划是否仍能代表创建它的输入与生成器契约。仅对比提示词无法察觉生成器的语义变更。

所选取的封闭原像包含了生成器包的出处以及独立的 plan 到 grounding 摘要连接。它使每一项失效输入都明确化，并维持了一对一的单个计划与单个当前 grounding 关联。

一个被否决的替代方案省略了生成器出处；该方案之所以被否决，是因为改变后的生成行为可能会伪装成 fresh。另一个替代方案使用了时间戳；该方案被否决是因为时间戳既不能标识内容，也不允许确定性的缓存复用。 
