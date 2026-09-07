---
title: 计划生命周期与新鲜度
description: 解释计划产物的出处与新鲜度判定机制，帮助您判断某个产物是否可以安全重放。
---

理解测试产物的出处与新鲜度判定机制，能够帮助您确定既有产物是否可以被重放。在出处模型中，`inputsDigest` 基于规范 JSON 计算得出，整合了标准化提示词文本、Plan 模式版本、生成器模板指纹、生成器捆绑包指纹 `producerBundleFingerprint` 以及具名目标定义。这些输入共同构成了产物出处的基准。

## 出处输入 {#provenance-inputs}

`inputsDigest` 是对包含标准化提示词文本、Plan 模式版本、生成器模板指纹、生成器捆绑包指纹 `producerBundleFingerprint` 以及具名目标定义的规范（canonical）JSON 计算而来的 SHA-256 摘要。通过这一计算，系统界定了受保护的完整出处输入集合。

模式版本或生成器模板的变动会使现有的计划变为 `stale`（已过期），即使该计划的提示词和目标定义未发生任何改变。

生成器捆绑包指纹独立于模板指纹，因为生成器契约的变更可能会改变生成结果，而此时提示词、模式以及模板的字节内容可能保持不变。

相关链接：[新鲜度与摘要](/ambercast/zh-cn/spec/freshness/#inputs-digest)、[配置](/ambercast/zh-cn/reference/configuration/#targets)、[兼容性](/ambercast/zh-cn/reference/compatibility/)

## 新鲜计划决策 {#fresh-plan-decision}

在执行新鲜度检查时，`check` 会从标准化提示词文本以及所选的目标定义中推导出当前出处，随后将其与 `plan.source.inputsDigest` 进行比对。

比对结果决定了计划状态：若摘要匹配，则产生 `fresh` 判定；若摘要不匹配，则产生 `stale` 判定，并附带说明该计划针对当前的提示词或目标定义已过期的原因。

产物如果包含无效 JSON、模式校验失败、非规范序列化或指令覆盖无效，`check` 同样会产生 `stale` 判定，而不是可信的 fresh 结果。

相关链接：[ambercast check](/ambercast/zh-cn/reference/cli/check/#results)、[恢复 stale（已过期）产物](/ambercast/zh-cn/how-to/recover-stale-artifacts/#stale)

## Grounding 绑定与一一对应 {#grounding-binding}

计划本身处于 fresh 状态，并不等同于存在可用的重放伴生文件。`planDigest` 对计划中与重放相关的内容计算哈希，同时排除了 `generatorMeta`；伴生文件 grounding 只有在其记录的 `planDigest` 等于计算出的计划摘要时，才属于最新状态。

对于一份判定为 fresh 的计划，当 grounding 伴生文件缺失时，`check` 报告为 `missing-grounding`；当伴生文件无效时报告为 `invalid-grounding`；当伴生文件绑定到其他计划时则报告为 `stale-grounding`。

当代码仓库策略为 `uncommitted` 时，缺少有效 grounding 的 fresh 计划会被报告为 `fresh-without-grounding`，而不会被记为计划新鲜度失败。

此外，`check` 会反向扫描伴生文件产物：如果发现某个产物没有对应的测试，会将其报告为 `orphaned-plan` 或 `orphaned-grounding`；对于无法执行反向解析的产物名称，则会报告为 `invalid-artifact-name`。

相关链接：[Grounding 文档](/ambercast/zh-cn/spec/grounding-document/#plan-digest)、[报告](/ambercast/zh-cn/reference/reports/#check-results)

## 新鲜度移交的内容 {#freshness-handoff}

`check` 依赖只读存储以及目录布局和发现依赖；在其依赖契约中，不暴露 AI 执行器、浏览器驱动、密钥、时钟或事件端口。

判定计划处于 fresh 状态纯粹是一个出处结论，而对 grounding 的检查则补充了重放缓存生命周期的证据，并不会重新定义计划本身的新鲜度。

重放过程中的漂移属于独立的运行时状况：元素指纹解析可以将漂移归类为 `fingerprint-mismatch`，该状况会直接移交给重放回退机制或自愈处理，而不会修改 `inputsDigest`。

相关链接：[重放与 grounding](/ambercast/zh-cn/explanation/replay-and-grounding/#drift-handoff)、[自愈模型](/ambercast/zh-cn/explanation/healing-model/#three-stages)、[操作契约](/ambercast/zh-cn/agents/operating-contract/#command-contract)
