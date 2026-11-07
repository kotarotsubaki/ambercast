---
title: 执行计划的生命周期与新鲜度
description: 说明执行计划何时仍可回放，以及 `check` 如何在不运行任何内容的情况下作出判断。
---

`check` 先判定新鲜度，只对 `fresh` 的执行计划检查定位缓存，因此 `stale` 的执行计划没有定位缓存状态。

## 出处输入 {#provenance-inputs}

`inputsDigest` 是记录执行计划由什么生成的 SHA-256 摘要，对规范 JSON 计算得出。规范 JSON 包含以下输入：

- 标准化后的提示词
- 执行计划的模式版本
- 生成器模板指纹
- 生成器捆绑包指纹，即 `producerBundleFingerprint`
- 执行计划所引用目标的定义，范围是执行计划的 `targets` 中列出的名称，按名称排序

修改执行计划未引用的目标，既不会改变摘要，也不会改变新鲜度。`executor` 不参与哈希。

提示词不变时，模式、模板或生成器契约的变化仍会使执行计划变为 `stale`。生成器捆绑包指纹与模板指纹分开记录，因为仅契约变化就可能改变生成结果。

相关链接：[新鲜度与摘要](/ambercast/zh-cn/spec/freshness/#inputs-digest)、[配置](/ambercast/zh-cn/reference/configuration/#targets)、[兼容性](/ambercast/zh-cn/reference/compatibility/)

## `check` 如何判定新鲜度 {#fresh-plan-decision}

`check` 根据当前提示词和执行计划引用的目标，重新计算 `inputsDigest`，再与 `plan.source.inputsDigest` 比较。一致时结果为 `fresh`，不一致时结果为 `stale`。

摘要一致并不够。出现以下任一情况，执行计划同样为 `stale`：

- JSON 无效
- 模式校验失败
- 序列化不是规范形式
- 指令覆盖无效
- 元素意图或源码区间无效
- 使用了已淘汰的 `schemaVersion` 4
- 执行计划引用的目标在配置中不存在

这样可以避免把已损坏的执行计划报告为 `fresh`。

相关链接：[ambercast check](/ambercast/zh-cn/reference/cli/check/#results)、[恢复过期的产物](/ambercast/zh-cn/how-to/recover-stale-artifacts/#stale)

## 定位缓存如何绑定执行计划 {#grounding-binding}

`fresh` 的执行计划仍可能无法回放，因为回放还需要定位缓存。

`planDigest` 对执行计划中与回放相关的内容计算哈希，不含 `generatorMeta`。只有定位缓存记录的 `planDigest` 与根据执行计划算出的值相等，它才算当前有效。执行计划的新鲜度与定位缓存的绑定，是分开判定的。

定位缓存缺失时，`check` 报告 `missing-grounding`；无效时报告 `invalid-grounding`；绑定到其他执行计划时报告 `stale-grounding`。仓库策略为 `uncommitted` 时，没有有效定位缓存的 `fresh` 执行计划会报告为 `fresh-without-grounding`，这不是新鲜度失败。

`check` 还会反向扫描。没有对应测试的产物会报告为 `orphaned-plan` 或 `orphaned-grounding`；无法反查到测试的名称会报告为 `invalid-artifact-name`。

相关链接：[定位缓存文档](/ambercast/zh-cn/spec/grounding-document/#plan-digest)、[报告](/ambercast/zh-cn/reference/reports/#check-results)

## 新鲜度判定移交什么 {#freshness-handoff}

`check` 不调用 AI，不启动浏览器，也不写入任何内容。它的新鲜度结论只说明执行计划是否与当前输入一致。

回放期间出现的问题另行处理。UI 变化导致元素指纹不再匹配时，结果是 `fingerprint-mismatch`。这属于漂移，是运行时状态，不会改变 `inputsDigest`。

之后由回放或自愈接手。

相关链接：[回放与定位缓存](/ambercast/zh-cn/explanation/replay-and-grounding/#drift-handoff)、[自愈模型](/ambercast/zh-cn/explanation/healing-model/#three-stages)、[操作契约](/ambercast/zh-cn/agents/operating-contract/#command-contract)
