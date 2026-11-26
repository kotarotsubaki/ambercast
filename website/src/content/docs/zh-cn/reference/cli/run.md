---
title: ambercast run
description: 规范 ambercast run 的标志、回放路径、显式 AI 解析与运行写入行为。
---

`ambercast run` 负责测试的回放路径与运行写入。默认不调用 AI：定位缓存未命中会以 `grounding-unresolved` 失败关闭 (退出码 4)，并提示使用 `--resolve`。只有传入 `--resolve` 才会为未命中显式启用实时 AI 解析。

## 标志 {#flags}

| 标志 | 取值 | 作用 | 默认值 |
| --- | --- | --- | --- |
| files | path[] | 字面 prompt 路径；缺省时执行发现机制 | discovery |
| --grep | pattern | 路径的正则表达式过滤器 | omitted |
| --headed | boolean | 有头浏览器 | false |
| --resolve | boolean | 为定位缓存未命中显式启用实时 AI 解析 | false |
| --update-cache | boolean | 请求写入缓存 | false |
| --stale | fail\|regenerate | stale（已过期）策略解析值 | fail |
| --ai | claude\|codex | 解析提供商覆盖 | omitted |
| --allow-empty | boolean | 允许空选择 | false |
| --list | boolean | 仅列出而不执行回放 | false |
| --json | boolean | JSON 封套 | false |
| --no-color | boolean | 禁用 ANSI 颜色 | false |

`--resolve`、`--ai` 的行为见[解析缺失的定位缓存](#resolve)，`--update-cache` 见[定位缓存写回](#grounding-write-back)，`--stale=regenerate` 的拒绝时机见下一节。

<a id="replay-paths"></a>

## 回放 {#replay}

| 条件 | AI 提供商 | 结果路径 |
| --- | --- | --- |
| 定位缓存命中 | 该次回放无需提供商 | 确定性回放 |
| 定位缓存未命中，未传入 `--resolve` | 无 | 以 `grounding-unresolved` 失败关闭（退出码 4） |
| 定位缓存未命中，传入 `--resolve` | 解析器；`--ai` 可覆盖 | 实时 AI 解析并可能写回 |

运行时在加载配置或执行文件 I/O 之前，会直接拒绝 `--stale=regenerate`。

运行时负责组装浏览器、由环境变量支持的机密、配置以及可供 `--resolve` 使用的提供商解析器。机密值仅在允许的浏览器接收端从 `AMBERCAST_SECRET_<NAME>` 解析；`run` 从不请求生成同意。

## AI 调用 {#ai-calls}

`run` 始终持有提供商解析器，但具备定位缓存的回放即使没有可用提供商也能推进，并不会调用它。只有传入 `--resolve` 时，定位缓存未命中才会调用该解析器。

## 解析缺失的定位缓存 {#resolve}

`--resolve` 会显式启用 AI 解析路径。未传入时，定位缓存未命中会失败关闭，而不会分发提供商。

在默认的本地写回下，经过解析的运行可能保存重新解析出的指纹并通过。

## 定位缓存写回 {#grounding-write-back}

仅当解析后的写回门禁允许时，`run` 才会写入发生变更的定位缓存。`--update-cache` 是该门禁的显式输入之一：在 CI 环境中与 `ci.updateGroundingCache` 组合判定，在本地环境中与 `localWriteBack` 配置组合判定。有关本地与 CI 环境下的所有判定条件，请参见[配置](/ambercast/zh-cn/reference/configuration/#grounding)。

## 报告与退出状态 {#report-and-exits}

只有 run 会尝试在 `<runsDir>/<runId>/report.json` 执行报告持久化 (`reportPersistence`)。写入成功后状态为 `persisted`；写入失败且无可见的部分内容时状态为 `failed`；未尝试写入时状态为 `not-attempted` (包括在得出运行结果之前发生失败的情况)。

运行结果状态包括 `passed`、`failed`、`error`、`listed` 与 `skipped`；进程退出码的数值及其优先级由[退出码](/ambercast/zh-cn/reference/exit-codes/#aggregation-priority)确定。

用例为 `passed` 且 `replayReadiness.status` 为 `not-ready` 时，面向人的输出会在结果下方打印一行：

```text
  replay: not ready (run "ambercast run --resolve --update-cache <file>")
```

如果回写权限不允许保存更改，则改为打印：

```text
  replay: not ready (the grounding was not saved; rerun with --update-cache)
```

`<file>` 是提示词路径。`failed` 和 `error` 用例不显示此行。

在 JSON 中，取得执行计划后失败的用例也带可选的 `replayReadiness`。准备状态不会改变退出码。[报告](/ambercast/zh-cn/reference/reports/#run-results)定义了字段值及判定范围。

相关链接：[配置](/ambercast/zh-cn/reference/configuration/#grounding)、[报告](/ambercast/zh-cn/reference/reports/#run-results)、[文件布局](/ambercast/zh-cn/reference/file-layout/#run-artifacts)、[退出码](/ambercast/zh-cn/reference/exit-codes/#aggregation-priority)。

## 每次回放都变化的邻近文字 {#changing-neighbor-text}

已有成分且目标和结构不变时，如果只有邻近文字在每次回放间变化，首次无 AI 回放会停止一次。再次运行 `ambercast run --resolve`，并成功写回定位缓存后，后续回放该元素无需 AI。目标是否有无障碍名称都适用。

v5 之前写入的定位缓存没有成分，因此会多停止一次。第一次 resolve 只重建含成分的严格记录项。下一次 resolve 才添加忽略槽位。

邻近元素出现或消失等结构变化仍为不匹配，不会放宽匹配。不允许 resolve 的回放不会添加忽略槽位。操作前，ambercast 仍比较本次回放的完整指纹，包括忽略的名称。

resolve 文字变化前，先确认页面显示的是预期记录。[报告](/ambercast/zh-cn/reference/reports/#neighbor-name-warnings)说明本次新增的忽略槽位及保存结果。
