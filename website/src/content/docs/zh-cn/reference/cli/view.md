---
title: ambercast view
description: ambercast view 命令参考，定义标志、交互门控、端口选择、主机绑定以及提供的路由。
---

`ambercast view` 启动一个只读的本地 HTTP 服务器，用于浏览持久化在已配置 runs 目录下的运行结果，开发者无需重新运行测试或产生任何 AI 调用，即可查看某次 run 的用例、步骤与截图。

## 标志 {#flags}

| 标志 | 值 | 效果 | 默认值 |
| --- | --- | --- | --- |
| `--port` | n | 首选端口；未指定时最多自动递增尝试 20 个候选端口 | 4600 |
| `--host` | addr | 绑定地址；必须是具体 IP 或 localhost，不允许通配地址 | 127.0.0.1 |
| `--allow-headless` | boolean | 允许在非交互式终端中运行 | false |
| `--config` | path | 显式配置路径 | 省略 |
| `--no-color` | boolean | 禁用 ANSI 输出 | false |

## 交互门控 {#interactive-gate}

`view` 遵循与其他带确认门控的命令相同的交互性判定：只有当 stdin 与 stderr 均连接到终端且未设置 `CI` 时才会启动。在未指定 `--allow-headless` 的非交互式调用中，命令将以退出码 2 终止，并输出：

```
view requires --allow-headless when no interactive terminal is attached.
```

`--allow-headless` 会解除该拒绝；若已处于交互式终端，则该标志为空操作。

## 端口选择 {#port-selection}

起始端口依次取自 `--port`、已配置的 `viewer.port`，最后回退到 4600。未指定 `--port` 时，`view` 会从起始端口开始最多尝试 20 个连续端口，仅在遇到 `EADDRINUSE` 时才前进到下一个候选，并打印实际绑定的端口。指定 `--port` 时，该端口按严格模式处理：若被占用，不会尝试其他端口，而是以退出码 3 终止。所有候选均耗尽，或出现 `EADDRINUSE` 以外的绑定失败，同样以退出码 3 终止。

## 主机绑定 {#host-binding}

`--host` 接受具体 IP 地址或 `localhost`（会被规范化为 `127.0.0.1`）。由于该服务器不提供任何身份验证，通配地址（`0.0.0.0`、`::`、`[::]`）会以退出码 2 被拒绝。每个请求都会依据绑定的主机与端口检查其 `Host` 请求头；指向其他主机的请求将被以 403 拒绝。绑定到非回环地址时，会打印一条警告，说明该服务器在无身份验证的情况下即可被访问。

## 路由 {#routes}

| 路由 | 提供内容 |
| --- | --- |
| `GET /` | 运行列表，按最新优先排序，包含状态、耗时与用例计数 |
| `GET /runs/<runId>` | 单次运行的用例、步骤、期望/实际值、说明文字与截图 |
| `GET /runs/<runId>/report.json` | 该次运行持久化的原始 report 字节内容 |
| `GET /runs/<runId>/screenshots/<ref>` | 该次运行的 report 实际引用的截图 |

每个响应都携带 `X-Content-Type-Options: nosniff` 与 `Cache-Control: no-store`；HTML 与原始数据响应还携带固定的 `Content-Security-Policy` 与 `Referrer-Policy: no-referrer`。页面完全在服务端渲染，不包含任何客户端 JavaScript 或外部请求。

缺少 `report.json` 的运行目录（例如写入过程中或持久化失败）会在列表中显示为仅有证据（evidence only），而不是一个失效链接。`report.json` 解析或校验失败的运行仍会保留在列表中，并提供指向其原始字节内容的链接，而不会从列表中消失。

相关链接：[CLI 概览](/ambercast/zh-cn/reference/cli/overview/#command-surface)，[报告](/ambercast/zh-cn/reference/reports/#envelope)，[配置](/ambercast/zh-cn/reference/configuration/#key-table)。
