---
title: 介绍
description: 了解 ambercast 如何将自然语言测试提示词转换为计划与 grounding 伴生文件，并在发生预期漂移时完成受控修复。
---

ambercast 是一个提示词原生的端到端测试工具。通过它，您可以将自然语言编写的测试提示词转换为可重放的计划与 grounding 伴生文件，并在发生预期漂移时完成受控修复。

## ambercast 保留的内容 {#what-ambercast-preserves}

为了保证测试的出处追溯性，提示词规范化仅修改前导的单个 BOM 以及 CR/CRLF 行尾换行符，其余所有内容均予以保留。

对于已提交的计划与 grounding 产物，运行时以 Zod IR 模式作为权威基准，JSON Schema 则直接由此派生。

## 生成、运行与修复循环 {#generate-run-heal-cycle}

该工作流展示了测试从输入到重放及修复的完整生命周期：由提示词输入开始，生成伴生文件，随后在重放中执行；若检测到需要修复，则由经确认的 heal 命令完成更新。面板采用带边框容器与状态标签展示，琥珀色代表激活提供商的节点，铜绿色代表重放成功。

**无障碍替代文本**：一个有向循环：提示词转化为计划与 grounding 伴生文件；在 grounding hit 时，运行过程无需解析提供商即可直接重放它们；若发生失败，则允许用户显式选择独立的 heal 命令；经授权的修复会更新伴生文件。

**节点说明**：
- `SIGN-IN.TEST.MD · PROMPT`：规范化后的提示词作为生成输入。
- `GENERATE · AI WHEN NEEDED`：生成过程组合了一个惰性 AI 执行器。
- `PLAN + GROUNDING`：伴生文件路径由 `.test.md` 路径派生。
- `RUN · REPLAY`：完全 grounding 的重放不需要可用的提供商。
- `GROUNDING HIT · 0 AI CALLS`：运行仅通过其回退端口解析提供商。
- `HEAL · APPROVAL BEFORE WRITE`：修复运行时负责确认与提交组合。

**流转关系**：
- `prompt → generate` (`ambercast generate`)
- `generate → artifacts` (`write companions`)
- `artifacts → run` (`ambercast run`)
- `run → replay` (`grounding hit`)
- `run → heal` (`repair needed`)
- `heal → artifacts` (`authorized update`)

## 三个文件 {#three-files}

ambercast 的文件组织以您编写的测试提示词为核心，派生出成对的结构化伴生文件，用于确定性记录执行计划与元素定位信息。

**无障碍替代文本**：一个编写的提示词分支为两个相邻的派生 JSON 伴生文件：计划与 grounding。

**节点说明**：
- `PROMPT · <name>.test.md`：仅精确以 `.test.md` 结尾的路径才具有伴生文件映射关系。
- `PLAN · <name>.ambercast.plan.json`：计划文件后缀为 `.ambercast.plan.json`。
- `GROUNDING · <name>.ambercast.grounding.json`：grounding 文件后缀为 `.ambercast.grounding.json`。

**流转关系**：
- `prompt-file → plan-file` (`generate`)
- `prompt-file → grounding-file` (`generate`)
- `plan-file ↔ grounding-file` (`paired derived artifacts`)

## AI 调用账本 {#ai-call-ledger}

该账本明确了各环节中提供商调用的发生边界：AI 提供商仅在生成阶段按需介入，完全 grounding 的重放无需调用提供商，而修复阶段则遵循显式确认机制。

**无障碍替代文本**：展示了生成期间的提供商工作、完全 grounding 重放时的零提供商调用，以及修复过程中的显式确认。

**节点说明**：
- `GENERATE · PROVIDER AS NEEDED`：生成接收一个惰性 AI 执行器解析器。
- `REPLAY · 0 AI CALLS WHEN GROUNDED`：运行仅通过其回退端口解析提供商。
- `HEAL · EXPLICIT REPAIR`：修复具有独立的确认与持久化组合。

**流转关系**：
- `generate → replay` (`committed companions`)
- `replay → heal` (`repair needed`)
- `heal → replay` (`authorized update`)

## 下一步 {#next}

相关链接：
- [5 分钟完成您的首个测试](/ambercast/zh-cn/tutorials/quick-start/)
- [设计哲学](/ambercast/zh-cn/philosophy/)
- [文件布局](/ambercast/zh-cn/reference/file-layout/)
- [ambercast generate](/ambercast/zh-cn/reference/cli/generate/)
- [ambercast run](/ambercast/zh-cn/reference/cli/run/)
- [ambercast heal](/ambercast/zh-cn/reference/cli/heal/)
