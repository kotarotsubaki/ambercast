---
title: ambercast run
description: 规范 ambercast run 的标志、回放路径、显式 AI 解析与运行写入行为。
---

`ambercast run` 负责测试的回放路径与运行写入。默认不调用 AI：grounding 未命中会以 `grounding-unresolved` 失败关闭（退出码 4），并提示使用 `--resolve`。只有传入 `--resolve` 才会为未命中显式启用实时 AI 解析。

## 标志 {#flags}

| 标志 | 取值 | 作用 | 默认值 |
| --- | --- | --- | --- |
| files | path[] | 字面 prompt 路径；缺省时执行发现机制 | discovery |
| --grep | pattern | 路径的正则表达式过滤器 | omitted |
| --target | name | 选择目标 | omitted |
| --headed | boolean | 有头浏览器 | false |
| --resolve | boolean | 为 grounding 未命中显式启用实时 AI 解析 | false |
| --update-cache | boolean | 请求写入缓存 | false |
| --stale | fail\|regenerate | stale（已过期）策略解析值 | fail |
| --ai | claude\|codex | 解析提供商覆盖 | omitted |
| --allow-empty | boolean | 允许空选择 | false |
| --list | boolean | 仅列出而不执行回放 | false |
| --json | boolean | JSON 封套 | false |
| --no-color | boolean | 禁用 ANSI 颜色 | false |

<a id="replay-paths"></a>

## 回放 {#replay}

| 条件 | AI 提供商 | 结果路径 |
| --- | --- | --- |
| grounding 命中 | 该次回放无需提供商 | 确定性回放 |
| grounding 未命中，未传入 `--resolve` | 无 | 以 `grounding-unresolved` 失败关闭（退出码 4） |
| grounding 未命中，传入 `--resolve` | 解析器；`--ai` 可覆盖 | 实时 AI 解析并可能写回 |

运行时在加载配置或执行文件 I/O 之前，会直接拒绝 `--stale=regenerate`。

运行时负责组装浏览器、机密信息（secrets）、配置以及可供 `--resolve` 使用的提供商解析器。

## AI 调用 {#ai-calls}

提供商解析器会被传递至运行用例，因此具备 grounding 的回放无需可用的提供商即可推进；仅在传入 `--resolve` 时，grounding 未命中才可使用该解析器。

## 解析缺失的 grounding {#resolve}

`--resolve` 会显式启用 AI 解析路径。未传入时，grounding 未命中会失败关闭，而不会分发提供商。

## Grounding 写回 {#grounding-write-back}

仅当解析后的写回门禁允许时，`run` 才会写入发生变更的 grounding；有关本地与 CI 环境下的所有判定条件，请参见 [配置](/ambercast/zh-cn/reference/configuration/#grounding)。

## 报告与退出状态 {#report-and-exits}

只有 run 会尝试在 `<runsDir>/<runId>/report.json` 执行报告持久化（`reportPersistence`）。写入成功后状态为 `persisted`；写入失败且无可见的部分内容时状态为 `failed`；未尝试写入时状态为 `not-attempted`（包括在得出运行结果之前发生失败的情况）。

运行结果状态包括 `passed`、`failed`、`error`、`listed` 与 `skipped`；进程退出码的数值及其优先级由 [退出码](/ambercast/zh-cn/reference/exit-codes/#aggregation-priority) 确定。

相关链接：[配置](/ambercast/zh-cn/reference/configuration/#grounding)、[报告](/ambercast/zh-cn/reference/reports/#run-results)、[文件布局](/ambercast/zh-cn/reference/file-layout/#run-artifacts)、[退出码](/ambercast/zh-cn/reference/exit-codes/#aggregation-priority)。
