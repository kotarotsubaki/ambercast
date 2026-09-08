---
title: 常见故障排查
description: 按故障症状排查原因并执行对应的处置操作。
---

本指南为您提供常见故障从症状到下一步处置操作的速查索引。若您的命令调用本身存在格式或参数问题，ambercast 会在生成报告前直接向 stderr 输出用法说明并中止。

## 前提条件 {#prerequisites}

- 传入无效标志（flags）、格式错误的命令参数或缺失选项值时，命令会将用法说明写入 stderr 并以退出状态码 `2` 退出，且不会生成报告封装体（report envelope）。

## 操作步骤 {#steps}

| 症状 | 原因 | 下一步操作 |
| --- | --- | --- |
| 无效配置、未解析的密钥或目标 | 需要修正配置或调用边界。 | 查阅 [错误代码](/ambercast/zh-cn/reference/error-codes/)，随后直接修正对应的配置项，切勿随意猜测其取值。 |
| 缺失、`stale`（已过期）或不可信的伴生文件 | 已提交的工件无法作为当前有效凭据使用。 | 使用 [恢复 stale（已过期）产物](/ambercast/zh-cn/how-to/recover-stale-artifacts/) 中对应的行。 |
| 字面量密钥或无法归属的授权 | 受保护的 IR 拒绝了密钥处理边界。 | 查阅 [管理机密](/ambercast/zh-cn/how-to/manage-secrets/)；切勿在提示词中直接放置字面量。 |
| 浏览器、提供商、存储故障或崩溃 | 执行环境发生故障。 | 保留 JSON 输出，修复执行环境，随后重新运行最小受影响范围的命令。 |
| 工作中断 | 批处理工作未完成。 | 待中断问题解决后重新运行。 |
| 断言失败 | 回放的用例存在失败凭据。 | 检查报告，修复应用程序或提示词，随后重新运行。 |
| 选区为空 | 没有提示词与所请求的选区匹配。 | 修正选区，或者仅在确认有意为空时使用 `--allow-empty`。 |

准确的错误词汇表请查阅 [错误代码](/ambercast/zh-cn/reference/error-codes/)，进程状态码取值及其优先级请查阅 [退出码](/ambercast/zh-cn/reference/exit-codes/#priority)。

## 验证 {#verification}

- 重新运行受影响的最小命令；只有在不再存在更高优先级条件时，才应当返回退出状态码 `0`。

## 相关链接 {#related}

链接：[错误代码](/ambercast/zh-cn/reference/error-codes/)、[退出码](/ambercast/zh-cn/reference/exit-codes/)、[ambercast check](/ambercast/zh-cn/reference/cli/check/)、[ambercast generate](/ambercast/zh-cn/reference/cli/generate/)、[ambercast run](/ambercast/zh-cn/reference/cli/run/)、[ambercast heal](/ambercast/zh-cn/reference/cli/heal/)、[恢复 stale（已过期）产物](/ambercast/zh-cn/how-to/recover-stale-artifacts/)、[管理机密](/ambercast/zh-cn/how-to/manage-secrets/)、[配置目标环境](/ambercast/zh-cn/how-to/configure-targets/)。
