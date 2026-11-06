---
title: "新鲜度与摘要"
description: "本章定义 `inputsDigest` 和 `planDigest`，它们决定执行计划及其定位缓存是否仍然有效，并由此推导出 `check` 的状态。"
---

## 输入摘要 {#inputs-digest}

`inputsDigest` 必须 (MUST) 是对新构建对象的规范 JSON 计算得出的小写 SHA-256。该对象恰好包含五个成员：`normalizedTestMd`、`schemaVersion`、`generatorPromptTemplateFingerprint`、`planProducerBundleFingerprint` 和 `targetDefinitions` (`src/core/ir/digest.ts:130-139`)。

`targetDefinitions` 只投影 `Plan.targets` 所引用的 Target 定义，并按名称排序 (`src/core/target/resolve.ts:12-43`)。修改未被引用的 Target，不会使执行计划过期，也不会改变其摘要。配置中的 `executor` 值不计入摘要。

规范 JSON 会对对象键排序，所以成员的插入顺序没有意义 (`src/core/ir/canonical-json.ts:153`)。不得直接对输入对象本身计算哈希 (MUST NOT) (`src/core/ir/digest.ts:118-125`)。生成器包指纹独立表示与执行计划语义相关的生成器配置，因此仅靠模板字节是不够的 (`src/core/ir/digest.ts:95-102`)。

## 执行计划摘要 {#plan-digest}

`planDigest` 必须 (MUST) 对排除了 `generatorMeta` 的 PlanDocument 计算哈希 (`src/core/ir/digest.ts:153-156`)。定位缓存是否为最新，取决于其存储的 `planDigest` 是否与计算出的执行计划摘要完全相等 (`src/core/ir/digest.ts:170-175`)。

计算 `planDigest` 分四步 (`src/core/ir/digest.ts:153-156`)。

1. 复制除 `generatorMeta` 之外的所有执行计划字段。
2. 对剩余对象做规范化，规则见[规范 JSON](/ambercast/zh-cn/spec/canonical-json/#digest-form)。
3. 对其 UTF-8 字节计算 SHA-256。
4. 将摘要编码为小写十六进制。

下列任一项发生变化，都会使存储的 `inputsDigest` 过期：规范化后的提示词、模式版本、模板指纹、生成器包指纹、目标名称和目标定义 (`src/core/ir/digest.ts:77,85,93,102,112`)。

## 新鲜度后果 {#freshness-consequences}

当存储的 `inputsDigest` 与当前值不同时，消费者必须 (MUST) 将执行计划标记为 `stale` (`src/usecases/check.ts:461-465,535`)。生成器包指纹是独立的新鲜度输入。因此，即使提示词和目标数据没有变化，实现的变更也可能使执行计划过期 (`src/core/ir/digest.ts:95-102`)。

当 `planDigest` 不同时，消费者必须 (MUST) 把执行计划与定位缓存的配对视为未绑定 (`src/core/ir/digest.ts:170-175`)。

本节是 `check` 状态推导的规范权威。参考页面只能概述它以满足各自的局部目的，并且必须 (MUST) 链接到这里。下表对 `check` 的结果值具有规范性。表中的 `missing`、`invalid` 和 `stale` 是定位缓存的检查分类，不是报告的 `status` 值 (`src/usecases/check-grounding.ts:18`) (`src/report/schema.ts:1111-1117`)。

| id | `check` 状态 | 推导 | 结果分类 |
| --- | --- | --- | --- |
| CHK-01 | `fresh` | 执行计划可解析，是规范形式，已提交的覆盖范围有效，`inputsDigest` 一致，且配套的定位缓存有效。 | pass |
| CHK-02 | `stale` | 执行计划的 JSON、模式、规范形式或已提交的覆盖范围无效，或使用已废弃的 `schemaVersion: 4`，或已提交的 `ElementIntent` 或 `QuotedElementIntent` 的源码范围无效，或 `inputsDigest` 不同。 | fail |
| CHK-03 | `fresh-without-grounding` | 执行计划是 fresh，配套的定位缓存无效，且仓库策略为 `uncommitted`。 | pass |
| CHK-04 | `missing-grounding` | 执行计划是 fresh，定位缓存的检查结果为 `missing`，且策略要求已提交的定位缓存。 | fail |
| CHK-05 | `invalid-grounding` | 执行计划是 fresh，定位缓存的检查结果为 `invalid`（JSON 或模式的检查失败，或规范形式的覆盖范围检查失败）。 | fail |
| CHK-06 | `stale-grounding` | 执行计划是 fresh，定位缓存的检查结果为 `stale`（`planDigest` 不同，或使用已废弃的定位缓存 `schemaVersion: 2` 或 `3`；后者先于模式形状校验检查）。 | fail |
| CHK-07 | `missing-plan` | 所选测试没有执行计划产物。 | fail |
| CHK-08 | `orphaned-plan` | 范围内的执行计划反向映射到一个不存在的测试路径。 | fail |
| CHK-09 | `orphaned-grounding` | 范围内的定位缓存产物反向映射到一个没有对应测试提示词的路径。 | fail |
| CHK-10 | `invalid-artifact-name` | 无法从产物路径反向推出测试标识。 | fail |
| CHK-11 | `listed` | 仅做发现的列表不检查所选路径。 | skipped |
| CHK-12 | `skipped` | 中断留下一个只含标识的待处理行。 | skipped |

对于其余方面有效且最新的定位缓存文档，只要某个条目有下列任一缺陷，文档级分类就保持不变：

- `intentDigest` 不一致。
- ID 不在执行计划中。
- 该条目对应的步骤不是动作类型。

`run` 在自己的逐步骤边界上，把这样的条目当作不存在。

`fresh` 和 `fresh-without-grounding` 两行是 pass；上面所有归为 fail 的行都计入失败；`listed` 和 `skipped` 是 skipped (`src/usecases/check-report.ts:72-75`)。

## 设计依据 {#rationale}

问题在于判断一份派生出来的执行计划，是否仍然代表生成它的输入和生成器约定。只比较提示词，无法发现生成器语义的变化。

所选的封闭原像包含生成器包的来源信息，以及一个独立的执行计划到定位缓存的摘要关联。这样每个失效输入都是明确的，并且保持一份执行计划对应一份有效定位缓存的关联。

被否决的方案有两个。一个省略了生成器的来源信息，因为生成行为变化后，它仍会显示为 fresh，所以被否决。另一个使用时间戳，因为时间戳既不能标识内容，也不能支持确定性的缓存复用，所以被否决。
