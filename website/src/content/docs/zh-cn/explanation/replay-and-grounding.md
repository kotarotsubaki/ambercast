---
title: 回放与定位缓存
description: 回放复用已记录的定位缓存，因此完全覆盖的运行无需调用 AI，未命中时默认失败关闭，只有加上 `--resolve` 才会实时解析。
---

回放复用 ambercast 已记录的内容。记录缺失或不可用时，除非你选择实时解析，否则回放会停止。

## 作为回放依据的定位缓存 {#grounding-as-replay-evidence}

`run` 为 `ai` 步骤和绑定元素的步骤读取定位缓存。绑定元素的步骤包括 click、press、fill、fill-secret 和 capture。导航和所有断言直接检查实时页面，不查询定位缓存。

元素条目保存定位器、指纹、意图摘要和出处。解析时使用保存的定位器并校验指纹。条目的结构见[定位缓存文档](/ambercast/zh-cn/spec/grounding-document/)。

解析器会区分命中与 `fingerprint-mismatch`、`element-not-found`、`ambiguous-match`、`snapshot-invalid`、`secret-contaminated`。已保存的忽略槽位允许按下述有限规则匹配。`snapshot-invalid` 和 `secret-contaminated` 会中止该用例。

回放随后走以下四条路径之一：

- 有效条目：不调用 AI，直接回放。
- 完整性失败：无论是否传入 `--resolve`，都失败关闭。
- 可恢复的未命中且带 `--resolve`：实时解析。
- 可恢复的未命中且不带 `--resolve`：以 `GROUNDING_UNRESOLVED` 停止，退出码为 4。

相关链接：[定位缓存文档](/ambercast/zh-cn/spec/grounding-document/)、[元素指纹](/ambercast/zh-cn/spec/fingerprint/)、[ambercast run](/ambercast/zh-cn/reference/cli/run/#ai-calls)

## 定位缓存命中时 {#grounding-hit}

已覆盖且有效的 AI 轨迹无需解析 AI 执行器即可回放。回放会先走这条路径，再考虑任何代理式回退。

元素解析命中时，回放使用本次观测到的完整指纹，不再请求新的解析。缓存完整时，运行无需探测提供方，命中也不会产生 AI 调用事件。

相关链接：[ambercast run](/ambercast/zh-cn/reference/cli/run/#replay)、[CI 中的确定性](/ambercast/zh-cn/explanation/determinism-in-ci/#bounded-side-effects)

## 显式解析下的未命中 {#miss-with-explicit-resolution}

完整性校验失败的定位缓存，即使带 `--resolve` 也会失败关闭，例如 JSON 无效，或覆盖证明、校验证明失败。

`--resolve` 只处理两类情况：定位缓存不存在，以及结构有效但可恢复的条目。由已淘汰格式版本写入的定位缓存也属于可恢复情况。对含有元素绑定步骤的执行计划，不带 `--resolve` 时 `run` 会将其报告为 `GROUNDING_UNRESOLVED`，而 `run --resolve --update-cache` 会重新生成它。

带 `--resolve` 时，元素未命中会实时解析。要在用例运行过程中确认绑定，至少一个步骤必须在 `confirms` 中列出该操作。当这些步骤都以有效依据通过时，ambercast 将条目列为待保存内容。

用例的所有步骤都通过后，剩余的操作和 capture 条目也会列入。操作包括 click、press、fill 和 fill-secret。其中包括未列在 `confirms` 中的操作，以及 `element-visible` 断言匹配到多个候选的操作。

用例中途失败或中断时，元素条目只有通过 `confirms` 确认后才可以保存。写入文件还需要回写开关允许。开关取决于 `localWriteBack`、`--update-cache` 和 `ci.updateGroundingCache`。

用例通过且定位缓存保存成功后，同一执行计划可从相同页面状态开始回放，无需调用 AI。`ai` 步骤仍然只有在通过且留下验证记录时才创建条目。没有留下记录的通过仍需要在回放时使用 `--resolve`。

相关链接：[ambercast run](/ambercast/zh-cn/reference/cli/run/#grounding-write-back)、[控制定位缓存回写](/ambercast/zh-cn/how-to/control-grounding-writeback/)

## 不解析时的未命中 {#unresolved-miss}

不带 `--resolve` 时，`run` 既不会实时解析冷启动未命中，也不会解析可恢复的未命中。在 AI 驱动的回放中，没有可用轨迹的 `ai` 步骤会以 `grounding-unresolved` 失败关闭，退出码为 4，并提示使用 `--resolve`。

元素未命中同样失败关闭，退出码为 4，不会实时解析元素。

相关链接：[ambercast run](/ambercast/zh-cn/reference/cli/run/#resolve)、[读取结构化输出](/ambercast/zh-cn/agents/reading-structured-output/#decision-tree)

## 每次回放都变化的邻近文字 {#changing-neighbor-text}

已有成分且目标和结构不变时，如果只有邻近文字在每次回放间变化，首次无 AI 回放会停止一次。再次运行 `ambercast run --resolve`，并成功写回定位缓存后，后续回放该元素无需 AI。目标是否有无障碍名称都适用。

v5 之前写入的定位缓存没有成分，因此会多停止一次。第一次 resolve 只重建含成分的严格记录项。下一次 resolve 才添加忽略槽位。

邻近元素出现或消失等结构变化仍为不匹配，不会放宽匹配。不允许 resolve 的回放不会添加忽略槽位。操作前，ambercast 仍比较本次回放的完整指纹，包括忽略的名称。

resolve 文字变化前，先确认页面显示的是预期记录。[报告](/ambercast/zh-cn/reference/reports/#neighbor-name-warnings)说明本次新增的忽略槽位及保存结果。

## 漂移的移交 {#drift-handoff}

`fingerprint-mismatch` 表示匹配到的元素当前指纹与保存的指纹不同。`run` 将其记录为独立的分类，与解析成功的情况区分开。

自愈先做一次失败关闭的基线回放，只有仍有失败时才尝试修复。

相关链接：[自愈模型](/ambercast/zh-cn/explanation/healing-model/#three-stages)、[UI 变更后的测试自愈](/ambercast/zh-cn/tutorials/repair-your-first-drift/)
