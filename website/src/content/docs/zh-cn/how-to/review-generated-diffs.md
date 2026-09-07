---
title: 审查生成的 diff
description: 按照实用的审查顺序，依次检查测试提示词以及派生的 plan 与 grounding 伴生文件变更。
---

本文向您介绍审查生成 diff 的实用审查顺序。解析器会将提示词映射为具有固定后缀的 plan 与 grounding 伴生文件。

## 前提条件 {#prerequisites}

- 解析器会将提示词映射为具有固定后缀的 plan 与 grounding 伴生文件。

## 操作步骤 {#steps}

1. 首先运行 `git status --short`。针对其中显示的每个未跟踪的提示词、plan 或 grounding 路径，检查其完整内容或运行 `git diff --no-index /dev/null <path>`；对于发生变更的受跟踪文件，使用 `git diff -- <path>`。此操作会在语义审查之前确立完整的候选文件集。
2. 审查 `tests/ambercast/<name>.test.md`，并在审查中说明预期的用户结果。提示词规范化除单个 BOM 和换行符表示外，会保留其余全部内容。
3. 审查 `tests/ambercast/<name>.ambercast.plan.json`，将生成的步骤与该预期结果进行比对。plan 是一个单独的派生伴生文件。
4. 审查 `tests/ambercast/<name>.ambercast.grounding.json`，区分解析变更与意图变更。grounding 是一个单独的派生伴生文件。
5. 运行 `npx ambercast check tests/ambercast/<name>.test.md`。check 不具备写入、浏览器或提供商能力。

## 验证 {#verification}

- 预期仅在被接受的配对为 fresh（非 `stale`（已过期））后，check 的退出码才为 `0`。

## 相关链接 {#related}

链接：[计划文档](/ambercast/zh-cn/spec/plan-document/)，[Grounding 文档](/ambercast/zh-cn/spec/grounding-document/)，[ambercast check](/ambercast/zh-cn/reference/cli/check/)，[文件布局](/ambercast/zh-cn/reference/file-layout/)，[在不同版本间升级](/ambercast/zh-cn/how-to/upgrade/)。
