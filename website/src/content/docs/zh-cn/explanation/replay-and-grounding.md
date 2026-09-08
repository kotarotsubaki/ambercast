---
title: 重放与 grounding
description: 解释重放路径及其安全边界。
---

本文旨在阐明测试重放的执行路径及其安全边界。在 ambercast 中，缓存的 grounding 为重放执行提供凭据。运行流程会针对 AI 步骤以及元素 grounding 步骤变体消费 grounding 数据；而导航（navigation）、文本可见（text-visible）、URL 匹配（URL-match）与元素计数（element-count）等步骤变体则不进行 grounding 查找。一条被覆盖且有效的 AI trace 无需解析 AI 执行器即可直接重放。

## Grounding 作为重放凭据 {#grounding-as-replay-evidence}

在运行流程中，缓存的 grounding 充当了重放判定的凭据。`run` 流程针对 AI 步骤与元素 grounding 步骤变体消费 grounding；而 navigation、text-visible、URL-match 以及 element-count 步骤变体不进行 grounding 查找。如果一条 AI trace 被覆盖且有效，系统即可在无需解析 AI 执行器的情况下直接执行重放。

针对元素 grounding，其中存储了可访问性指纹（accessibility fingerprint）。在解析匹配节点时，系统会将存储的算法与哈希值与当前节点生成的新指纹进行比对。

解析器能够将命中与 `fingerprint-mismatch`、`element-not-found`、`ambiguous-match` 以及 `snapshot-invalid` 明确区分开来；比对不匹配不会被当作命中来处理。

相关链接：
- [Grounding 文档](/ambercast/zh-cn/spec/grounding-document/)
- [元素指纹](/ambercast/zh-cn/spec/fingerprint/)
- [ambercast run](/ambercast/zh-cn/reference/cli/run/#ai-calls)

## 重放路径：grounding 命中 {#grounding-hit}

当既有凭据有效时，系统将进入命中路径。在 AI-directed replay 中，一条被覆盖且有效的 AI trace 会在选择任何惰性智能体回退（lazy agentic fallback）之前执行重放。

在元素处理层面，一次成功的元素分类会将已存储的指纹提供给重放上下文，而不是请求新的实时解析（live resolution）。

运行流水线的设计使一份完整的缓存可以在不探测提供商（provider）的情况下执行。

相关链接：
- [ambercast run](/ambercast/zh-cn/reference/cli/run/#replay)
- [CI 中的确定性](/ambercast/zh-cn/explanation/determinism-in-ci/#bounded-side-effects)

## 重放路径：未命中与回退 {#miss-with-ai-fallback}

当凭据不足以支持直接重放时，系统将评估未命中路径。缺失 grounding、来源处于 `stale`（已过期）状态、JSON 无效以及缓存未命中，均会在惰性智能体回退之前完成分类。

当未启用 cache-only 模式时，元素 grounding 的未命中可以进行实时解析，并使用解析出的元素指纹更新对应的 grounding 条目。

智能体回退仅在未命中路径之后才会开始；缓存命中不会发出任何 AI 调用事件（AI-call event）。

相关链接：
- [ambercast run](/ambercast/zh-cn/reference/cli/run/#grounding-write-back)
- [控制 grounding 回写](/ambercast/zh-cn/how-to/control-grounding-writeback/)

## 重放路径：cache-only 未命中 {#cache-only-miss}

如果需要禁止回退行为，您可以使用 `--cache-only` 模式。`--cache-only` 会同时抑制冷启动（cold-start）与可恢复未命中（recoverable-miss）的 AI 回退。

在启用 cache-only 模式时：
- 缺少可用 trace 的 AI 导向步骤（AI-directed step）会直接中止（abort）。
- 元素 grounding 未命中同样会在 cache-only 模式下直接中止，而不是对元素进行实时解析。

相关链接：
- [ambercast run](/ambercast/zh-cn/reference/cli/run/#cache-only)
- [读取结构化输出](/ambercast/zh-cn/agents/reading-structured-output/#decision-tree)

## 漂移交接 {#drift-handoff}

当重放检测到界面变化时，执行将脱离重放的缓存决策，转入自愈范畴。如果匹配节点当前的可访问性指纹与存储的指纹不同，即判定为 `fingerprint-mismatch`。

运行用例将 `fingerprint-mismatch` 记录为一种独立的分类情况，与成功的 grounded 解析截然区分。

自愈流程首先从一次 cache-only 基线重放开始；如果在重放后仍然存在失败，流程可以尝试进行 grounding 修复（grounding repair）。

相关链接：
- [自愈模型](/ambercast/zh-cn/explanation/healing-model/#three-stages)
- [UI 变更后的测试自愈](/ambercast/zh-cn/tutorials/repair-your-first-drift/)
