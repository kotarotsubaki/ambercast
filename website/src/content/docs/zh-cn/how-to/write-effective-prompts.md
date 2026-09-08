---
title: 编写高效的 Prompt
description: 掌握编写清晰、聚焦的测试用例 Prompt 的推荐做法，并通过预检安全验证生成流程。
---

编写高质量的 Prompt 能让测试用例在团队审查时清晰明了，也能帮助生成结构严谨、执行确定的测试计划。本指南提供编写测试 Prompt 的推荐实践以及首轮生成前的验证流程。

## 前置条件 {#prerequisites}

Prompt 文件名必须严格以 `.test.md` 结尾，才能建立有效的伴生映射。

## 操作步骤 {#steps}

1. **创建测试文件**：创建 `tests/ambercast/checkout.test.md`，在文件中包含一个 H1 标题、用例所需的前置准备（setup），并在每个句子中表达一个可观察到的结果（observable outcome）。这些约定属于便于代码审查的编写建议，并非解析器的语法限制。
2. **保持用例聚焦**：若存在不相关的用户预期结果，请拆分至独立的 `<name>.test.md` 文件中。
3. **按需声明密钥授权**：仅在确实需要时，使用单独成行的 `@ambercast-secret {{secrets.name}}`。解析器仅会识别位于代码块之外、独立成行的完整授权语句。一行授权仅授权一次使用；同一机密需要多次使用时，每次使用都重复一行。关于具体的语法定义，请查阅 [提示词文件格式](/ambercast/zh-cn/reference/prompt-format/) 与 [计划中的机密](/ambercast/zh-cn/spec/secrets/)。
4. **运行生成预检**：

   有效的预览结果其状态为 `would-generate` 且 `dryRun: true`；预检过程不会声明已提交磁盘写入。

## 结果验证 {#verification}

审查预检（dry-run）的输出信息，确认无误后去除 `--dry-run` 执行正式生成：



执行成功时，进程退出码应为 `0`，并输出状态为 `generated` 的生成结果。

## 相关文档 {#related}

- [提示词文件格式](/ambercast/zh-cn/reference/prompt-format/)
- [计划中的机密](/ambercast/zh-cn/spec/secrets/)
- [ambercast generate](/ambercast/zh-cn/reference/cli/generate/)
- [计划文档](/ambercast/zh-cn/spec/plan-document/)
- [审查生成的 diff](/ambercast/zh-cn/how-to/review-generated-diffs/)
