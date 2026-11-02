---
title: ambercast check
description: 检查执行计划与定位缓存新鲜度的 ambercast check 的标志、状态值、结果字段和只读约定。
---

`ambercast check` 检查 prompt、执行计划和定位缓存伴生文件，并报告各自是否新鲜、是否有效。它不调用 AI，不启动浏览器，不派发事件，也不向磁盘写入任何内容。

## 标志 {#flags}

你可以直接传入 prompt 路径，也可以让[配置的发现机制](/ambercast/zh-cn/reference/configuration/#file-selection)来选择。

| 标志 | 取值 | 作用 | 默认值 |
| --- | --- | --- | --- |
| files | path[] | 字面 prompt 路径；缺省时执行发现机制 | discovery |
| --allow-empty | boolean | 允许空选择 | false |
| --list | boolean | 只列出，不检查 | false |
| --json | boolean | JSON 封套 | false |
| --config | path | 显式指定配置 | omitted |
| --no-color | boolean | 禁用 ANSI 颜色 | false |

## 状态值 {#status-vocabulary}

`check` 为每条结果报告下列 12 个状态之一。`listed` 只在使用 `--list` 时出现，`skipped` 只在中断之后出现。

- `fresh`
- `stale`
- `missing-plan`
- `missing-grounding`
- `invalid-grounding`
- `stale-grounding`
- `fresh-without-grounding`
- `orphaned-plan`
- `orphaned-grounding`
- `invalid-artifact-name`
- `listed`
- `skipped`

每个状态如何推导、算通过还是失败，由[新鲜度与摘要](/ambercast/zh-cn/spec/freshness/#freshness-consequences)规定。

## 结果 {#results}

完整的检查发现包含 `id`、`file`、`planFile`、`status` 和 `reason`。`groundingFile` 或 `artifactFile` 只在作为该发现的证据时出现。状态为 `invalid-artifact-name` 的发现是例外：它没有 `planFile`，而是包含 `id`、`file`、`status`、`reason` 和 `artifactFile`，这些字段都指向产物本身。完整的字段定义和报告结构见[报告](/ambercast/zh-cn/reference/reports/#check-results)。

## 只读检查 {#read-only-contract}

`check` 是只读的。它的依赖不含 AI 运行时、浏览器驱动、事件派发器和写入存储。运行时它组合只读存储、文件布局规则和发现机制，详见[文件布局](/ambercast/zh-cn/reference/file-layout/#companions)与[配置](/ambercast/zh-cn/reference/configuration/#file-selection)。

进程退出码的取值及其优先级由[退出码](/ambercast/zh-cn/reference/exit-codes/#aggregation-priority)规定，完整对应关系见[退出码表](/ambercast/zh-cn/reference/exit-codes/#exit-code-table)。

- 不可信的产物贡献退出码 `4`。
- 未被允许的空选择贡献退出码 `5`。
