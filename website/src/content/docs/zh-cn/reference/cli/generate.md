---
title: ambercast generate
description: 详细参考 ambercast generate 的命令行参数、AI 提供商调用逻辑、伴生产物映射及退出状态。
---

`ambercast generate` 命令用于根据提示词生成测试执行计划与伴生文件。您可以直接指定字面提示词路径，或在缺省时由命令执行自动发现；同时支持通过参数配置严格模式、强制生成、预览运行、AI 提供商覆盖以及输出格式。

## 命令行参数 {#flags}

| 参数 | 取值类型 | 效果 | 默认值 |
| --- | --- | --- | --- |
| files | path[] | 字面提示词路径；缺省时执行自动发现 | discovery |
| --strict | boolean | 严格生成策略 | false |
| --force | boolean | 强制执行生成 | false |
| --dry-run | boolean | 预览：仅在需要生成时返回 `would-generate`；未过期的 Plan 返回 `skipped-fresh`；两种结果均不写入产物 | false |
| --target | name | 选择目标 | omitted |
| --ai | claude\|codex | 覆盖提供商 | omitted |
| --allow-empty | boolean | 允许空选择集 | false |
| --list | boolean | 仅列出而不执行生成 | false |
| --json | boolean | JSON 封装输出 | false |
| --config | path | 显式指定配置文件 | omitted |
| --no-color | boolean | 禁用 ANSI 颜色 | false |

## AI 调用 {#ai-calls}

- Generate 仅通过其生成依赖解析提供商执行器；已配置的提供商与 `--ai` 覆盖参数将提供给该解析器。
- `--list` 返回发现行。在配合 `--dry-run` 时，需要生成的目标返回 `would-generate`；未过期的 Plan 返回 `skipped-fresh`。两种 dry-run 结果均不写入产物：未过期分支跳过 grounding 修复，而生成分支在写入前返回。

## 副作用与退出码 {#side-effects}

- 名为 `<name>.test.md` 的提示词映射到其同级的 plan 与 grounding 伴生文件。
- 结果状态包括 generated、would-generate、skipped-fresh、listed、failed 和 skipped。`would-generate` 仅作为需要生成的目标在 dry-run 时的状态；`skipped-fresh` 在 dry-run 模式下同样有效。
- 进程退出码的具体数值及其优先级由 [退出码](/ambercast/zh-cn/reference/exit-codes/#aggregation-priority) 确定；`--allow-empty` 控制空选择集是否产生退出码 5。

## 相关链接

- [文件布局](/ambercast/zh-cn/reference/file-layout/#companions)
- [报告](/ambercast/zh-cn/reference/reports/#generate-results)
- [退出码](/ambercast/zh-cn/reference/exit-codes/#exit-code-table)
- [配置](/ambercast/zh-cn/reference/configuration/#file-selection)
