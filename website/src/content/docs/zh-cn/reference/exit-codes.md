---
title: 退出码
description: ambercast 返回的进程退出码，以及把多个结果合并为一个退出码时的优先级。
---

CI 和脚本通过退出码判断运行如何结束。ambercast 使用 0 到 5 共六个退出码，每个都有优先级。

## 退出码表 {#exit-code-table}

| 退出码 | 含义 | 优先级（越小越优先） |
| --- | --- | --- |
| 0 | 成功，或没有候选 | 5 |
| 1 | 命令层面的否定结果 | 3 |
| 2 | 使用或配置错误 | 0 |
| 3 | 环境错误 | 1 |
| 4 | 不可信的执行计划或定位缓存产物 | 2 |
| 5 | 选择集为空 | 4 |

例如，[`PROMPT_PATH_INVALID`](/ambercast/zh-cn/reference/error-codes/#code-vocabulary) 是使用错误，退出码为 2。

## 聚合优先级 {#aggregation-priority}

一个命令有多个结果时，优先级数值最小的退出码胜出。顺序为 2 > 3 > 4 > 1 > 5 > 0。

结果与遍历顺序无关。没有候选时返回 0。

## 优先级兼容锚点 {#priority}

本节用于保留旧锚点。内容见[聚合优先级](/ambercast/zh-cn/reference/exit-codes/#aggregation-priority)。

## 另请参阅 {#see-also}

- [错误代码](/ambercast/zh-cn/reference/error-codes/#code-vocabulary)
- [报告](/ambercast/zh-cn/reference/reports/#envelope)
- [常见故障排查](/ambercast/zh-cn/how-to/troubleshoot/)
