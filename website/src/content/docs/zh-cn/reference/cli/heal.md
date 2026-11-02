---
title: ambercast heal
description: ambercast heal 的标志、修复阶段、限制、授权、CI 规则和写入行为参考。
---

`ambercast heal` 修复执行计划及其定位缓存伴生文件。你可以选择要处理的 prompt，在不提交的情况下测量修复，也可以授权写入。

## 标志 {#flags}

不传 `files` 时，heal 通过发现机制选择 prompt。

| 标志 | 取值 | 作用 | 默认值 |
| --- | --- | --- | --- |
| files | path[] | 字面 prompt 路径；缺省时执行发现机制 | discovery |
| --dry-run | boolean | 只测量修复，不提交已缓冲的执行计划和定位缓存改动 | false |
| --yes, -y | boolean | 授权以非交互方式提交 | false |
| --ai | claude\|codex | 覆盖提供商 | omitted |
| --allow-empty | boolean | 允许空选择 | false |
| --list | boolean | 只列出，不修复 | false |
| --json | boolean | JSON 封套 | false |
| --no-color | boolean | 禁用 ANSI 颜色 | false |

## 修复模型 {#repair-model}

完成的修复结果是 `healed`、`partially-healed`、`unresolved` 或 `no-changes-needed` 之一。每种结果的 `application` 和 `stopReason` 取值都受到约束。

heal 最多分三个阶段修复：

1. 先修复定位缓存。
2. 再修复单个步骤或执行计划的后半部分。
3. 只有前面的阶段没能修好该用例，并且尚未到达用例期限时，才修复整份执行计划。

第三阶段会解析 AI 执行器并调用生成，因此可能调用真实的提供商。

heal 从不做新的机密同意决定。第二阶段的候选如果含有无效的机密名、违反允许列表或与环境变量冲突，heal 以 `secret-name-invalid` 拒绝它。第三阶段的候选如果改变了完整的逻辑机密名集合，heal 以 `stage3Rejection.reason: "secret-set-changed"` 拒绝它。这种拒绝不会写入任何执行计划或定位缓存更新。

CLI 面向人的输出随后会打印 `hint: ` 和下面的提示，其中的 `<file>` 会被替换成实际的 prompt 路径。`--json` 输出包含 `stage3Rejection`，不含提示。

`秘匿値の構成が変わった。ambercast generate --force <file> で再生成し同意を取り直す`

## 限制 {#limits}

- `heal.maxStepRepairs` 设置后是一个正数硬上限，限制增量修复中真实的提供商调用次数。它计入元素确认，不计入失败关闭的基线测量和第三阶段。
- `heal.caseTimeoutMs` 是整个用例的受理期限，取正数，默认值为 `300000` ms。

## 确认 {#confirmation}

除 `--dry-run` 外，heal 只有在获得授权之后才会提交修复产物。`--yes` 以非交互方式授权。

## CI {#ci}

除 `--list` 外，在 CI 中运行 heal 会被拒绝，除非 `ci.heal` 为 `true`。

## 前置条件与写入 {#preconditions}

除 `--list` 外，加载某个 prompt 的执行计划之后，该执行计划引用的每个目标都必须设置 `healReplayIsolation: "idempotent"`，否则 heal 会让这个 prompt 以 `CONFIG_INVALID` 失败，退出码为 `2`。`healReplayIsolation` 的默认值是 `stateful`。执行计划没有引用的其他目标不会阻止 heal。

heal 会缓冲执行计划和定位缓存的写入，直到获得授权后才结算。不过每次测量仍可能通过 `runsDir` 内的存储写入尝试证据，这可能发生在授权之前，也可能发生在 `--dry-run` 期间。

进程退出码的取值及其优先级由[退出码](/ambercast/zh-cn/reference/exit-codes/#aggregation-priority)规定，各个退出码列在[退出码表](/ambercast/zh-cn/reference/exit-codes/#exit-code-table)中。

相关页面：[配置](/ambercast/zh-cn/reference/configuration/#grounding)、[报告](/ambercast/zh-cn/reference/reports/#heal-results)、[文件布局](/ambercast/zh-cn/reference/file-layout/#run-artifacts)
