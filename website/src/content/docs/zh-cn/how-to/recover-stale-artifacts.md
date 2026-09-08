---
title: 恢复 stale（已过期）产物
description: 查阅 check 状态至后续操作的对照表，以恢复处于 stale 或异常状态的产物。
---

本指南提供了从检查状态到后续操作的对照，指导您在产物处于 `stale`（已过期）或异常状态时采取确切的操作进行恢复。

## 前提条件 {#prerequisites}

- `check` 是只读的：其依赖项省略了提供商、浏览器、事件接收器与可变存储。

## 操作步骤 {#stale}

| check 状态 | 确切的后续操作 | 预期可观察结果 |
| --- | --- | --- |
| `fresh` | 运行 `npx ambercast check`；不对产物做任何修改。 | 退出 `0`。 |
| `fresh-without-grounding` | 运行 `npx ambercast generate tests/ambercast/<name>.test.md`。 | `generate` 会在磁盘上修复相邻的 Grounding 文件，然后报告 `skipped-fresh` 且仅包含 `planFile`；它不会报告 grounding 路径。 |
| `stale` | 运行 `npx ambercast generate tests/ambercast/<name>.test.md`，随后审查 diff。 | 全新的生成可以退出 `0`；仍不受信任的检查退出 `4`。 |
| `missing-plan` | 从版本控制中恢复 Plan，或运行 `npx ambercast generate tests/ambercast/<name>.test.md`。 | 生成的结果包含 `planFile`。 |
| `missing-grounding` | 运行 `npx ambercast generate tests/ambercast/<name>.test.md`。 | 当 Plan 处于 fresh 状态时，`generate` 会在磁盘上创建其相邻的 Grounding 文件并返回仅包含 `planFile` 的 `skipped-fresh`；`groundingFile` 并不是 Generate 的结果字段。 |
| `stale-grounding` | 运行 `npx ambercast generate tests/ambercast/<name>.test.md`，随后审查新的 grounding。 | 校验有效时，check 不再发出失败的完整性发现项。 |
| `invalid-grounding` | 根据 prompt 重新生成并审查新的 grounding。 | 校验有效时，check 不再发出失败的完整性发现项。 |
| `orphaned-plan` | 恢复其 prompt，或通过项目的正常审查流程移除该孤立文件。 | 下一次 check 不再包含该孤立项发现。 |
| `orphaned-grounding` | 恢复其 prompt，或通过项目的正常审查流程移除该孤立文件。 | 下一次 check 不再包含该孤立项发现。 |
| `invalid-artifact-name` | 通过正常审查流程重命名或移除该无效伴生文件。 | 下一次 check 不再报告该无法逆向解析的产物。 |
| `listed` | 在不带 `--list` 的情况下重新运行以检查新鲜度。 | `--list` 未执行任何 Plan 或 Grounding 读取。 |
| `skipped` | 解决中断后重新运行。 | 运行作用域内的 `INTERRUPTED` 错误会导致退出码 `3`。 |

## 验证 {#verification}

- 运行 `npx ambercast check --json`；仅在没有更高优先级的候选状态保留时，预期退出 `0`。

## 相关链接 {#related}

链接：[ambercast check](/ambercast/zh-cn/reference/cli/check/)、[ambercast generate](/ambercast/zh-cn/reference/cli/generate/)、[错误代码](/ambercast/zh-cn/reference/error-codes/)、[退出码](/ambercast/zh-cn/reference/exit-codes/)、[ambercast heal](/ambercast/zh-cn/reference/cli/heal/)、[审查生成的 diff](/ambercast/zh-cn/how-to/review-generated-diffs/)。
