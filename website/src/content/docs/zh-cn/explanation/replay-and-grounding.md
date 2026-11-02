---
title: 回放与定位缓存
description: 回放复用已记录的定位缓存，因此完全覆盖的运行无需调用 AI，未命中时默认失败关闭，只有加上 `--resolve` 才会实时解析。
---

定位缓存覆盖全部步骤时，回放无需调用 AI。未命中默认失败关闭，只有加上 `--resolve`，ambercast 才会实时解析未命中的步骤。

## 作为回放依据的定位缓存 {#grounding-as-replay-evidence}

`run` 为 `ai` 步骤和绑定元素的步骤读取定位缓存。绑定元素的步骤包括 click、press、fill、fill-secret 和 capture。导航和所有断言直接检查实时页面，不查询定位缓存。

元素条目保存定位器、指纹、意图摘要和出处。解析时使用保存的定位器并校验指纹。条目的结构见 [Grounding 文档](/ambercast/zh-cn/spec/grounding-document/)。

解析器会区分命中与 `fingerprint-mismatch`、`element-not-found`、`ambiguous-match`、`snapshot-invalid`、`secret-contaminated`。指纹不匹配不会被当作命中。

回放随后走以下四条路径之一：

- 有效条目：不调用 AI，直接回放。
- 完整性失败：无论是否传入 `--resolve`，都失败关闭。
- 可恢复的未命中且带 `--resolve`：实时解析。
- 可恢复的未命中且不带 `--resolve`：以 `GROUNDING_UNRESOLVED` 停止，退出码为 4。

相关链接：[Grounding 文档](/ambercast/zh-cn/spec/grounding-document/)、[元素指纹](/ambercast/zh-cn/spec/fingerprint/)、[ambercast run](/ambercast/zh-cn/reference/cli/run/#ai-calls)

## 定位缓存命中时 {#grounding-hit}

已覆盖且有效的 AI 轨迹无需解析 AI 执行器即可回放。回放会先走这条路径，再考虑任何代理式回退。

元素解析命中时，回放直接使用保存的指纹，不再请求新的解析。缓存完整时，运行无需探测提供方，命中也不会产生 AI 调用事件。

相关链接：[ambercast run](/ambercast/zh-cn/reference/cli/run/#replay)、[CI 中的确定性](/ambercast/zh-cn/explanation/determinism-in-ci/#bounded-side-effects)

## 显式解析下的未命中 {#miss-with-explicit-resolution}

完整性校验失败的定位缓存，即使带 `--resolve` 也会失败关闭，例如 JSON 无效，或覆盖证明、校验证明失败。

`--resolve` 只处理两类情况：定位缓存不存在，以及结构有效但可恢复的条目。由已淘汰格式版本写入的定位缓存也属于可恢复情况。不带 `--resolve` 时，`run` 会将其报告为 `GROUNDING_UNRESOLVED`，而 `run --resolve --update-cache` 会重新生成它。

带 `--resolve` 时，元素未命中会实时解析。只有通过的 `confirms` 步骤确认了绑定，且回写开关允许时，ambercast 才会写入条目。开关取决于 `localWriteBack`、`--update-cache` 和 `ci.updateGroundingCache`。

相关链接：[ambercast run](/ambercast/zh-cn/reference/cli/run/#grounding-write-back)、[控制定位缓存回写](/ambercast/zh-cn/how-to/control-grounding-writeback/)

## 不解析时的未命中 {#unresolved-miss}

不带 `--resolve` 时，`run` 既不会实时解析冷启动未命中，也不会解析可恢复的未命中。在 AI 驱动的回放中，没有可用轨迹的 `ai` 步骤会以 `grounding-unresolved` 失败关闭，退出码为 4，并提示使用 `--resolve`。

元素未命中同样失败关闭，不会实时解析元素。

相关链接：[ambercast run](/ambercast/zh-cn/reference/cli/run/#resolve)、[读取结构化输出](/ambercast/zh-cn/agents/reading-structured-output/#decision-tree)

## 漂移的移交 {#drift-handoff}

`fingerprint-mismatch` 表示匹配到的元素当前指纹与保存的指纹不同。`run` 将其记录为独立的分类，与解析成功的情况区分开。

自愈先做一次失败关闭的基线回放，只有仍有失败时才尝试修复。

相关链接：[自愈模型](/ambercast/zh-cn/explanation/healing-model/#three-stages)、[UI 变更后的测试自愈](/ambercast/zh-cn/tutorials/repair-your-first-drift/)
