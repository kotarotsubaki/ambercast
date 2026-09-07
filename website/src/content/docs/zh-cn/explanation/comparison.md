---
title: ambercast 的设计模型对比
description: 对比 ambercast 与代码生成、录制测试及直接驱动型 Agent 的核心设计模型。
---

在评估端到端测试方案时，考察其背后的设计模型往往比单纯对比功能更有价值。ambercast 的设计重点在于优先考虑不绑定于特定工具的测试资产。通过规范化提示词文本、推导计划来源并构建经过校验的 PlanDocument，ambercast 将测试的核心意图转化为独立的衍生计划，这与代码生成、录制回放以及直接驱动型 Agent 所依托的设计模型有着明确的区别。

## 代码生成始于录制交互 {#code-generation-model}

Playwright 将 `codegen` 阐述为录制浏览器操作并生成代码，供用户复制到编辑器中。在该模型下，生成的产物直接体现为特定运行环境下的测试源代码，测试逻辑与具体的测试框架实现紧密交织。

与之相对，ambercast 的设计考量优先关注不锁定于特定工具的测试资产。在生成阶段，ambercast 会规范化提示词文本，推导计划来源，并构建经过校验的 PlanDocument。测试意图借此被沉淀为结构化的衍生计划，而非直接捆绑在某一个具体工具的代码脚本中。

相关链接：[设计哲学](/ambercast/zh-cn/philosophy/)、[计划生命周期与新鲜度](/ambercast/zh-cn/explanation/plan-lifecycle/)

## 录制测试保留观察到的交互 {#record-and-replay-model}

在 Cypress 的文档中，Studio 被描述为录制真实交互并将其转换为测试命令。传统的录制回放模型侧重于保留所观察到的操作步骤，并将其转换为连续的测试命令。

ambercast 则将明确的意图与可替换的交互定位区分开来。在 ambercast 中，PlanDocument 记录 inputsDigest，而 grounding 则独立绑定至 planDigest，因此两者的来源契约是相互独立的。这种分离使测试所声明的意图不会直接与某次观察到的具体界面定位强行绑定。

相关链接：[重放与 grounding](/ambercast/zh-cn/explanation/replay-and-grounding/)、[设计哲学](/ambercast/zh-cn/philosophy/)

## 直接驱动型 Agent 基于当前会话行动 {#direct-driving-agent-model}

直接驱动型 Agent 通常依赖当前会话中的即时交互进行动态操作。一般的直接驱动型 Agent 模型可能会使用屏幕截图和实时工具调用，而不生成与 ambercast 等效的、已提交的计划与 grounding 资产；不过，这一特征是否适用于所有具体的 Agent 产品，目前尚未确认。

相比之下，ambercast 在完成 Schema 校验后，生成的计划会明确携带 producer-bundle 指纹以及规范化步骤。它并不在每次测试执行时依赖实时的会话驱动循环，而是产出可供审查与提交的固定测试资产。

相关链接：[在 AI Agent 中使用 ambercast](/ambercast/zh-cn/agents/overview/)、[信任与安全](/ambercast/zh-cn/explanation/trust-and-security/)
