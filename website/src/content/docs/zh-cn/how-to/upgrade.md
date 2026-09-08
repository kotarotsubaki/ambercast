---
title: 在不同版本间升级
description: 跨版本安全升级 ambercast 的操作流程与验证方法。
---

本指南介绍了在不同版本之间升级 ambercast 的发布安全流程。当版本变动（如生成器指纹变更）导致既有的 plan 变为 `stale`（已过期）并需要重新生成时，请按照以下步骤处理。

## 前提条件 {#prerequisites}

- CHANGELOG 0.3.1 指出其生成器指纹（producer-fingerprint）变更会导致 0.1.0 版本的 plan 变为 `stale`（已过期），并需要重新生成。

## 操作步骤 {#steps}

1. 在更改依赖项之前，请阅读目标版本的 BREAKING 说明。0.3.1 版本的条目明确指出了对 `inputsDigest` 的影响。
2. 使用项目的包管理器升级 ambercast，然后运行 `npx ambercast check --json`。check 会返回一份报告，并在发现不可信结果时选择退出代码 `4`。
3. 如果 check 的退出代码为 `4`，请运行 `npx ambercast generate` 并审查 plan 与 grounding 的 diff。生成操作会组合生成器与报告结果。
4. 将依赖项与接受的伴生文件变动一同提交。随后重新运行 check，使最终状态可见。

## 验证 {#verification}

- 接受重新生成后，`npx ambercast check` 的退出代码为 `0`。

## 相关链接 {#related}

链接：[变更日志](/ambercast/zh-cn/reference/changelog/)、[新鲜度与摘要](/ambercast/zh-cn/spec/freshness/)、[ambercast check](/ambercast/zh-cn/reference/cli/check/)、[ambercast generate](/ambercast/zh-cn/reference/cli/generate/)、[审查生成的 diff](/ambercast/zh-cn/how-to/review-generated-diffs/)。
