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

## 迁移机密授权 {#migrate-secret-grants}

为 Plan v2 创建的提示词可能包含旧版机密授权行。请从提示词中删除每一行授权；旧语法会被拒绝，不能原地迁移。

```markdown
@ambercast-secret {{secrets.password}}
```

然后运行 `npx ambercast generate --force <file>` 并响应新的同意提示。对于 CI 或其他非交互环境，请先将已审查的名称添加到 `secrets.allow`。重新生成的 Plan 使用 v3 同意／许可列表模型。

## 生成器变更后重新定位 {#reground-after-producer-change}

生成器指令或响应契约发生变化后，producer 指纹随之改变，早期版本生成的执行计划会过期。重新生成执行计划会把其定位缓存替换为空缓存，下面的步骤会让每个元素步骤重新绑定。Plan 5 和 Grounding 4 保持不变。

report 3.11 新增 `generator-assumption` 警告及 `healed` 行的可选 `warnings`。验证封闭 union 的使用者需要更新 report Schema。

CLI 的 `--strict` 选项和 MCP 的 `strict` 参数已移除。请从调用中删除这两个参数。`ambercast generate --strict` 因未知选项以退出码 2 结束，MCP 在输入验证时拒绝 `strict`。

1. 运行 `npx ambercast check --json`，确认受影响的执行计划报告为 `stale`。
2. 对每个过期的执行计划运行 `npx ambercast generate <file>`。查看 diff，确认体现某个输入效果的断言，其 `confirms` 列出了该输入。
   - 如果 generate 对某个输入给出 `action-unconfirmed` 警告，请不要继续第 3 步。
   - 普通的 run 会在该输入处以 `GROUNDING_UNRESOLVED` 失败。
   - 请加入能体现该输入效果的断言，例如登录后的用户名，然后重做第 2 步。
3. 在本机运行 `npx ambercast run --resolve --update-cache <file>`。重新生成后定位缓存为空，所以对每个没有逐字引用的元素步骤，ambercast 会调用一次 AI。CI 默认不保存定位缓存。
4. 运行 `npx ambercast check`，确认执行计划为 `fresh`。然后运行 `npx ambercast run <file>`，确认它通过且报告中的 `aiCalls` 为 0。执行计划始终提交；只有 `grounding.repositoryPolicy` 为 `committed` 时才将定位缓存与执行计划一起提交，为 `uncommitted` 时保留在本地。

## 验证 {#verification}

- 接受重新生成后，`npx ambercast check` 的退出代码为 `0`。

## 相关链接 {#related}

链接：[变更日志](/ambercast/zh-cn/reference/changelog/)、[新鲜度与摘要](/ambercast/zh-cn/spec/freshness/)、[ambercast check](/ambercast/zh-cn/reference/cli/check/)、[ambercast generate](/ambercast/zh-cn/reference/cli/generate/)、[审查生成的 diff](/ambercast/zh-cn/how-to/review-generated-diffs/)。
