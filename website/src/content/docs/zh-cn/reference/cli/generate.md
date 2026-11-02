---
title: ambercast generate
description: ambercast generate 的标志、提供商解析、机密同意、伴生文件和退出状态参考。
---

`ambercast generate` 把测试 prompt 编译成执行计划和伴生产物。它处理字面文件路径，或发现机制选出的测试。

## 标志 {#flags}

| 标志 | 取值 | 作用 | 默认值 |
| --- | --- | --- | --- |
| files | path[] | 字面 prompt 路径；缺省时执行发现机制 | discovery |
| --force | boolean | 强制生成 | false |
| --dry-run | boolean | 不写入任何内容，只报告结果：需要生成时为 `would-generate`，执行计划仍新鲜时为 `skipped-fresh` | false |
| --target | name | 把可用于生成的目标限定为这一个 | omitted |
| --ai | claude\|codex | 覆盖提供商 | omitted |
| --allow-empty | boolean | 允许空选择 | false |
| --list | boolean | 只列出，不生成 | false |
| --json | boolean | JSON 封套 | false |
| --config | path | 显式指定配置 | omitted |
| --no-color | boolean | 禁用 ANSI 颜色 | false |

## AI 调用 {#ai-calls}

`generate` 只在生成路径上解析提供商执行器。配置的提供商和 `--ai` 覆盖值都交给这个解析器。

`--list` 不运行生成，只返回发现到的行。使用 `--dry-run` 时，需要生成的目标返回 `would-generate`，执行计划仍新鲜的目标返回 `skipped-fresh`。两种结果都不写产物：新鲜分支跳过定位缓存修复，生成分支在任何写入之前返回。

## 机密同意 {#secret-consent}

生成先构造候选，再征求同意。它先构造候选执行计划，找出不在 `secrets.allow` 中的机密名，并在写入执行计划或定位缓存之前请求交互式批准。`--force` 重新生成仍新鲜的执行计划时，同样遵守这条同意边界。`--dry-run` 不写产物，也不保存同意。

在非交互环境中，或你拒绝同意时，未被允许的候选会以 `SECRET_CONSENT_REQUIRED` 失败，退出码为 `2`。在 CI 中运行之前，先把审查过的名称加入 `secrets.allow`。值 `"*"` 跳过逐个名称的审查，接受 AI 提出的任何名称，因此风险很高。安全的做法见[管理机密](/ambercast/zh-cn/how-to/manage-secrets/)。

## 副作用与退出码 {#side-effects}

名为 `<name>.test.md` 的 prompt 对应同目录下的执行计划和定位缓存伴生文件，详见[文件布局](/ambercast/zh-cn/reference/file-layout/#companions)。

结果状态有 `generated`、`would-generate`、`skipped-fresh`、`listed`、`failed` 和 `skipped`，详见[报告](/ambercast/zh-cn/reference/reports/#generate-results)。`would-generate` 是需要生成的目标在 dry-run 下的状态，`skipped-fresh` 在 dry-run 模式下同样会出现。

进程退出码的取值及其优先级由[退出码](/ambercast/zh-cn/reference/exit-codes/#aggregation-priority)规定，各个退出码列在[退出码表](/ambercast/zh-cn/reference/exit-codes/#exit-code-table)中。`--allow-empty` 决定空选择是否贡献退出码 `5`，详见[配置](/ambercast/zh-cn/reference/configuration/#file-selection)。
