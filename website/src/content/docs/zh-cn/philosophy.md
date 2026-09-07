---
title: 设计哲学
description: 阐述 ambercast 核心设计决策背后的持久理念与基本考量。
---

继 [介绍](/ambercast/zh-cn/introduction/) 之后，本页阐释 ambercast 架构与设计抉择背后的持久理念。在测试实践中，测试用例以自然语言 Markdown prompt 形式编写，使测试资产独立于具体的执行工具。正是随着 AI 技术的进步，这种自然语言资产模型才具备了工程上的可行性。

## 测试是不受工具绑定的资产 {#tests-without-lock-in}

在 ambercast 中，测试用例以自然语言 Markdown prompt 的形式编写。该设计期望将测试构建为独立于任何特定执行工具的长久资产。过去，端到端测试往往深度绑定特定的驱动代码或测试框架，一旦技术栈迁移便需要承担巨大的重写代价。得益于 AI 技术的长足进步，直接将自然语言作为测试资产的模型才得以在工程实践中真正成立，使业务意图与底层执行工具实现解耦。

## prompt 为本，plan 为衍生 {#prompt-primary-plan-derived}

ambercast 将 prompt 确立为单一事实来源，而生成的 plan 始终处于从属地位。这一设计类似于现代项目的包管理机制：prompt 所表达的测试意图对应于 `package.json`，而从中衍生出的、用于保障重现性的 plan 则类似于 lockfile。为了让 prompt 意图的演变清晰可见，规范化（normalization）处理刻意避免了修剪（trimming）和宽泛的清理，从而让每一次对 prompt 有意义的修改都在版本差异中一览无余。

## plan 生来即可被废弃与重建 {#scrap-and-build}

在 AI Agent 驱动的代码实现循环中，前端界面的频繁变更是一项既定假定。因此，plan 从一开始就被设计为允许随时废弃与重新生成的中间产物。在此演进模式下，ambercast 允许引入破坏性的 plan 格式变更，也允许次版本发布时要求重新生成 plan。

例如，CHANGELOG 0.2.0 中记录了一项破坏性的生成器指纹（producer-fingerprint）变更，该变更导致 0.1.0 版本的 plan 变为 `stale`（已过期），并要求运行 `ambercast generate` 或添加 `--force` 选项重新生成。

相关链接：[在不同版本间升级](/ambercast/zh-cn/how-to/upgrade/)、[变更日志](/ambercast/zh-cn/reference/changelog/)、[新鲜度与摘要](/ambercast/zh-cn/spec/freshness/)。

## 指引决策的五大痛点 {#five-pains}

ambercast 的各项设计决策，始终围绕端到端测试领域的五大顶层痛点展开：

一是端到端测试本身脆弱易碎；二是测试代码往往晦涩难懂；三是编写与维护测试需要投入繁重的人工交互成本；四是测试资产复用性较差；五是对依靠直觉交互写代码的开发者（vibe coders）而言，端到端测试存在极高的编写难度。

## 保注意图，降级实现细节 {#preserve-intent}

项目名称“ambercast”本身传达了其核心意象：如同琥珀（amber）定格形态，并浇铸（cast）持久的意图。为了在页面结构调整时保持 prompt 意图的稳定性，已解析的实现细节被抽离并隔离至独立的 grounding 缓存中。

在代码库结构上，严格的模式边界将已提交的代码仓库产物（包括 plan 与 grounding 产物）同运行时的 AI 生成器与重放执行器隔离开来，确保核心意图不被易变的底层细节所扰乱。

## 面向非工程师力求简明，面向工程师恪守严谨 {#simple-and-rigorous}

在面向非工程师用户时，ambercast 期望呈现的交互表面仅包含自然语言 prompt 以及直观的屏幕截图与测试结果。

与此同时，工程层面的严谨性并未被妥协：测试的可重现性、AI 执行中的非确定性以及模型调用成本，全部由结构化层负责承载与控制。作为中间表示的 IR 虽然兼具良好的可读性，但它并不被设定为日常使用中的必读内容，而是在需要深入审查时提供清晰的透明度。

## 错误通过是最大的风险 {#wrong-pass}

在测试体系中，测试发生错误通过（wrong pass）被视为最大的风险。为了降低错误通过的风险，系统优先保障断言质量。

出于相同的审慎考量，CI 默认失败而非自动修复。在无人值守的自动化集成环境中，直接暴露故障远比通过不可预测的自动修复来掩盖潜在问题更为安全。

## 将编码 Agent 视为一等用户 {#agents-first-class}

ambercast 将编码 Agent 视为一等用户。为了让 Agent 能够顺畅融入自动化循环，CLI、MCP 以及官方 skill 被规划为核心的交互接口。

在技术文档与规范的规划中，AI Agent 用户群体拥有专属的阅读顺序与分支流程，而非通过复制多份冗余的规范文档来实现支持，从而在避免规范漂移的同时为 Agent 提供连贯的指引。

## BYOK 与本地执行 {#byok-and-local}

ambercast 采用本地执行与 BYOK（Bring Your Own Key）模型。所有 AI 执行均依赖于您自有的 Claude 或 Codex 协议，工具自身绝不持有或保留任何凭据。

在自动选择 AI 提供商时，系统会优先探测 Claude，随后再探测 Codex。同时，作为在本地运行的开源 CLI，ambercast 本身定位于可完全免费运行，为开发者保留完整的掌控权与透明度。
