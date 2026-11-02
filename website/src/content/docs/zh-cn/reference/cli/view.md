---
title: ambercast view
description: ambercast view 的标志、交互门控、端口选择、主机绑定和所提供路由的参考。
---

`ambercast view` 针对配置中的运行目录，启动一个只读的本地 HTTP 服务器。你无需重新运行测试，就能查看某次运行的用例、步骤和截图。它不调用 AI。

## 标志 {#flags}

`view` 不接受位置参数。

| 标志 | 取值 | 作用 | 默认值 |
| --- | --- | --- | --- |
| --port | n | 首选端口；未指定时依次尝试 20 个候选端口 | 4600 |
| --host | addr | 绑定地址；具体的 IP 或 localhost，不接受通配地址 | 127.0.0.1 |
| --allow-headless | boolean | 允许在非交互终端中启动 | false |
| --config | path | 显式指定配置 | omitted |
| --no-color | boolean | 禁用 ANSI 颜色 | false |

## 交互门控 {#interactive-gate}

除非 stdin 和 stderr 都是终端，并且 `CI` 未生效，否则 `view` 拒绝启动。`init` 在确认提示之前也做同样的终端加 `CI` 检查。没有 `--allow-headless` 的非交互调用，会输出下面的消息并以退出码 `2` 结束：

```text
view requires --allow-headless when no interactive terminal is attached.
```

`--allow-headless` 解除这个拒绝。在终端中启动时，它不改变任何行为。

## 端口选择 {#port-selection}

起始端口依次取 `--port`、配置中的 `viewer.port`，最后是 `4600`。未指定 `--port` 时，`view` 从该端口起最多尝试 20 个连续端口。它只在遇到 `EADDRINUSE` 时才换下一个端口，并打印实际绑定的端口。

指定 `--port` 时，只严格使用这一个端口：端口被占用，`view` 就以退出码 `3` 结束。用尽所有候选端口，或出现 `EADDRINUSE` 以外的绑定失败，同样以退出码 `3` 结束。

## 主机绑定 {#host-binding}

`--host` 接受具体的 IP 地址或 `localhost`，`localhost` 会规范化为 `127.0.0.1`。服务器没有认证，所以通配地址 `0.0.0.0`、`::` 和 `[::]` 会以退出码 `2` 被拒绝。每个请求的 `Host` 头都必须指向绑定的主机和端口，否则服务器返回 `403`。绑定的地址不是 `127.0.0.1` 或 `::1` 时，`view` 会打印警告，说明无需认证即可访问该服务器。

## 路由 {#routes}

| 路由 | 提供的内容 |
| --- | --- |
| `GET /` | 按时间倒序排列的运行列表，含状态、耗时和用例数量。 |
| `GET /runs/<runId>` | 某次运行的用例、步骤、期望值与实际值、说明和截图。 |
| `GET /runs/<runId>/report.json` | 该次运行持久化报告的原始字节。 |
| `GET /runs/<runId>/screenshots/<ref>` | 该次运行的报告所引用的截图。 |

每个响应都带有 `X-Content-Type-Options: nosniff` 和 `Cache-Control: no-store`。HTML 和原始响应还带有固定的 `Content-Security-Policy` 和 `Referrer-Policy: no-referrer`。页面在服务端渲染，不使用客户端 JavaScript，也不发出外部请求。

缺少 `report.json` 的运行目录，例如写入中途或持久化失败之后，会作为仅有证据的行出现在列表中。`report.json` 解析或校验失败的运行仍会出现在列表中，其原始字节仍可访问。

`view` 读取所有 `schemaVersion` 为 3.x 的报告。其他次版本写出的报告，会在运行详情的标题中显示 Schema `<version>`。其他主版本的报告列为 Unsupported version `<version>`，无法打开。

`view` 是 ambercast 中唯一使用网络端口的命令。MCP 服务器使用 stdio。

相关页面：[CLI 概览](/ambercast/zh-cn/reference/cli/overview/#command-surface)、[报告](/ambercast/zh-cn/reference/reports/#envelope)、[配置](/ambercast/zh-cn/reference/configuration/#key-table)、[ambercast mcp](/ambercast/zh-cn/reference/cli/mcp/#usage)
