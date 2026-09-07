---
title: 退出码
description: ambercast 面向机器的进程状态退出码定义与聚合优先级参考。
---

ambercast 向系统环境提供面向机器的进程退出状态码。本参考页面定义了各个退出码的具体含义及多退出码聚合时的优先级规则。

## 退出码表 {#exit-code-table}

| 退出码 | 含义 | 优先级 |
| --- | --- | --- |
| 0 | 成功或无候选对象 | 5 |
| 1 | 命令领域负向结果 | 3 |
| 2 | 使用或配置错误 | 0 |
| 3 | 环境错误 | 1 |
| 4 | 不可信的计划或 grounding 制件 | 2 |
| 5 | 空选择集 | 4 |

## 聚合优先级 {#aggregation-priority}

优先级数值较小者胜出，确立了 2 > 3 > 4 > 1 > 5 > 0 的优先级规则。退出码的选择独立于遍历顺序；在没有候选对象时返回 0。

## 优先级兼容链接 {#priority}

本节保留用于兼容旧版锚点，请参阅 [退出码](/ambercast/zh-cn/reference/exit-codes/#aggregation-priority)。

相关链接：[错误代码](/ambercast/zh-cn/reference/error-codes/#code-vocabulary)、[报告](/ambercast/zh-cn/reference/reports/#envelope)、[常见故障排查](/ambercast/zh-cn/how-to/troubleshoot/)
