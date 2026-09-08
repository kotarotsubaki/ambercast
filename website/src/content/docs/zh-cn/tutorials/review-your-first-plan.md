---
title: 阅读您的首个 plan 与 grounding
description: 学习如何定位测试生成的 plan 与 grounding 文件，并检查其新鲜度。
---

本教程以 [5 分钟完成您的首个测试](/ambercast/zh-cn/tutorials/quick-start/) 为基础。在接下来的内容中，您将了解由测试提示词派生的 plan 与 grounding 文件的具体存放位置，并学习如何检查它们的新鲜度。

## 操作步骤 {#steps}

1. 打开 `tests/ambercast/sign-in.ambercast.plan.json`，阅读 `schemaVersion`、`source.inputsDigest` 与 `steps`。解析器通过精确替换 prompt 的 `.test.md` 后缀来派生该 plan 文件路径。
2. 打开 `tests/ambercast/sign-in.ambercast.grounding.json`，阅读其 `schemaVersion`、`planDigest` 与 `entries`。解析器同样从同一个 prompt 派生出这一配对的 grounding 路径。
3. 运行 `npx ambercast check tests/ambercast/sign-in.test.md --json`。check 会生成一个报告封套（report envelope）；处于新鲜状态的结果其状态为 `fresh` 或 `fresh-without-grounding`。

## 完成状态 {#completion-state}

- 该命令仅在整份报告没有 failure、case error 或 interruption 时才会以退出码 `0` 退出；选中的新鲜用例本身并不能保证退出码为 `0`，因为 check 还会扫描伴生文件是否存在孤立发现项（orphan findings）。JSON 报告会展示该新鲜度结果。

相关链接：[计划文档](/ambercast/zh-cn/spec/plan-document/)、[Grounding 文档](/ambercast/zh-cn/spec/grounding-document/)、[文件布局](/ambercast/zh-cn/reference/file-layout/)、[ambercast check](/ambercast/zh-cn/reference/cli/check/)、[审查生成的 diff](/ambercast/zh-cn/how-to/review-generated-diffs/)。
