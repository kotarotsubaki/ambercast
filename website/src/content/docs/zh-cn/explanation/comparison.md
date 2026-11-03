---
title: ambercast 的设计模型对比
description: ambercast 把自然语言提示词作为测试本身，并由它派生出经过审阅的执行计划，而其他模型保留的是脚本或实时会话。
---

比较测试方法时，应看各自把什么作为测试产物保留下来，而不是比较功能清单。ambercast 以提示词为源，执行计划由它派生。代码生成、录制回放和直接操作的代理，保留的是别的东西。

## 代码生成始于录制的交互 {#code-generation-model}

在代码生成模型中，测试产物来自捕获的交互。Playwright 文档把 codegen 描述为录制浏览器操作，并生成可复制到编辑器的代码。这时的产物是针对某个运行器编写的脚本。

ambercast 在中间放了一层产物：它先规范化提示词，派生执行计划的出处，再构建经过校验的执行计划。这样的设计倾向于不绑定特定工具的产物。

相关链接：[设计哲学](/ambercast/zh-cn/philosophy/)、[执行计划的生命周期与新鲜度](/ambercast/zh-cn/explanation/plan-lifecycle/)

## 录制回放保留观察到的交互 {#record-and-replay-model}

录制回放工具保留在浏览器会话中执行的操作。Cypress 文档把 Studio 描述为录制真实交互，并把它们转换成测试命令。录制下来的脚本就成为测试套件中的产物。

ambercast 把意图和元素绑定放在不同的契约下。执行计划记录 `inputsDigest`，定位缓存则绑定到 `planDigest`。因此，派生的执行计划和负责定位元素的定位缓存可以分别变化。

相关链接：[回放与定位缓存](/ambercast/zh-cn/explanation/replay-and-grounding/)、[设计哲学](/ambercast/zh-cn/philosophy/)

## 直接操作的代理依赖当前会话 {#direct-driving-agent-model}

直接操作的代理在实时浏览器会话中工作。它可能依据截图和实时工具调用行动，并且可能不留下已提交的执行计划或定位缓存。

ambercast 则依赖经过审阅并提交的产物。执行计划带有生成器捆绑包指纹和经过模式校验的步骤。由于 ambercast 在执行前就构建并校验这些内容，你得到的是可阅读、可检查的产物。

相关链接：[在 AI Agent 中使用 ambercast](/ambercast/zh-cn/agents/overview/)、[信任与安全](/ambercast/zh-cn/explanation/trust-and-security/)
