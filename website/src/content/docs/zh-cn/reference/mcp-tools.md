---
title: MCP 工具
description: ambercast MCP 工作流的工具、输入、结果与错误契约。
---

MCP 服务器依次提供六个工具：`ambercast_generate`、`ambercast_run`、`ambercast_check`、`ambercast_heal`、`ambercast_job_status`、`ambercast_job_cancel`。名称使用 ambercast 前缀和 snake_case，并非复制所有 CLI 命令。

## 工具列表 {#tool-table}

注解依次为 readOnly / destructive / idempotent / openWorld。四个值均明确给出，它们只是提示而非授权。generate 的幂等提示是弱承诺：最新 Plan 会被跳过，效果趋于收敛，但 AI 输出可能变化。

| 工具 | 对应 CLI | 注解 | `isError: true` | `isError: false` 的否定结果 |
| --- | --- | --- | --- | --- |
| `ambercast_generate` | generate | false / false / true（弱）/ false | 退出码 2、3 | 退出码 1（strict 歧义）、5 |
| `ambercast_run` | run | false / false / false / true | 退出码 2、3、4（MISSING_PLAN / STALE_PLAN / INTEGRITY_VIOLATION / GROUNDING_UNRESOLVED） | 退出码 1（断言失败）、5 |
| `ambercast_check` | check | true / false / true / false | 退出码 2、3 | 退出码 4（stale 是 results[].status 中的正常结果）、5 |
| `ambercast_heal` | heal | false / true / false / true | 退出码 2（含 CI 拒绝）、3、4；`HEAL_APPLY_TOKEN_INVALID`；`HEAL_APPLY_FAILED` | 退出码 1（未解决或拒绝）、5 |
| `ambercast_job_status` | — | true / false / true / false | `JOB_NOT_FOUND`；failed 时的 `JOB_FAILED`；有结果的 completed/cancelled 按原工具映射 | 未终结 record、列表、排队取消的 record |
| `ambercast_job_cancel` | — | false / false / true / false | `JOB_NOT_FOUND` | — |

`isError` 由报告的聚合退出码决定，不重新分类单个报告错误。heal 还提供 Claude Code 交互提示，但提示不能作为批准证据。

## 输入 {#inputs}

输入是严格对象。未知键、类型不匹配和 refine 违规由 SDK 返回 `Input validation error` 文本及 `isError: true`。没有参数时传入 `{}`。

| 范围 | 属性与默认值 |
| --- | --- |
| 通用工作流输入 | `files?: string[]`（省略和 `[]` 都使用配置发现；相对路径以 session root 为基准）、`allowEmpty?: boolean`（false） |
| `ambercast_generate` | `target?: string`（限制生成器可用的 Target 定义）、`strict?: boolean`（false）、`force?: boolean`（false）、`dryRun?: boolean`（false）、`ai?: 'claude' \| 'codex'` |
| `ambercast_run` | `grep?: string`（有效正则表达式）、`resolve?: boolean`（false）、`updateCache?: boolean`（false）、`ai?: 'claude' \| 'codex'` |
| `ambercast_check` | 仅通用输入 |
| `ambercast_heal` | `dryRun?: boolean`（true）、`applyToken?: string`、`ai?: 'claude' \| 'codex'` |
| `ambercast_job_status` | `jobId?: string`（省略时列出本服务器进程的作业）、`waitMs?: number`（0；整数 0–45000，仅指定 ID 时生效） |
| `ambercast_job_cancel` | `jobId: string` |

MCP 输入排除 CLI 标志 `headed`（固定 headless）、`list`、`stale`（固定 fail）、`json`、`yes`（由 `applyToken` 取代）和 `configPath`。

## heal 预览与应用 {#heal-preview-and-apply}

`ambercast_heal` 默认预览（`dryRun: true`），与 CLI heal 的 false 默认值不同。只有产生提交的预览返回 `applyToken`。应用时只传 `dryRun: false` 和 `applyToken`；必须省略 `files`、`ai`、`allowEmpty`。预览必须省略 `applyToken`。违规属于 SDK 输入验证错误。应用同步执行，不创建作业。token 是 128-bit 加密随机值，表示为 32 位十六进制字符。新预览会取代 pending token。pending token 从首次组装携带 token 的响应起 600000 ms 后过期；consumed token 在结算后 600000 ms 内重放保存的结果。

如果客户端支持表单征询，将以 600000 ms 超时请求确认。接受并确认会应用修复，拒绝则不应用，取消则中断。客户端不支持表单征询时，服务器授权应用。token 标识预览，应用请求是单独的操作；客户端提示本身并非授权。

## 结果与作业 {#results-and-jobs}

所有工具均省略 `outputSchema`：报告 JSON Schema 大小为 136 KB，会挤占 `tools/list`，而工具还可能返回报告封装或 Job record。已完成报告的 `structuredContent` 与 CLI JSON 输出采用同一封装，不在封装中增加退出码。截图保持为相对 projectRoot 的路径，不使用内联 base64。

单个 text 项的首行是 `exitCode: <n>`。只有产生提交的 heal 预览在第二行给出 `applyToken: <token>`，后续一行包含封装 JSON。响应同时包含 `_meta.exitCode`，适用时包含 `_meta.applyToken`。通过 `ambercast_job_status` 获取的已完成作业返回相同 content、错误分类及元数据，并加入不含结果的 `_meta.job`。

generate、run、heal 预览每次调用都会创建 Job。若在同步等待界限内完成，调用方获得报告响应；否则获得作业句柄。句柄与未终结状态将 Job record 放入 `structuredContent`，text 固定三行：`jobId: <id>`、`status: <status>`、状态消息。元数据含 `_meta.jobId`。`ambercast_check` 与 heal 应用保持同步。`ambercast_job_status` 不指定 ID 时按创建时间从新到旧列出本服务器进程的作业，`structuredContent` 包含 `jobs` 数组；空列表的 text 为 `no jobs`。这是服务器本地作业通道，不是 MCP Tasks extension。`ambercast_job_cancel` 取消运行或排队的作业并返回 record。record 在终结后 1800000 ms 或服务器退出时消失。

| Job record 字段 | 含义 |
| --- | --- |
| `jobId` | UUID v4 标识符 |
| `tool` | 来源工具 |
| `status` | working、completed、failed 或 cancelled |
| `statusMessage` | 非空进度或终结状态消息 |
| `progress` | 运行时事件累计数，与是否发送进度通知无关 |
| `createdAt` | ISO 8601 UTC 创建时间 |
| `lastUpdatedAt` | 状态或进度最后变化时的 ISO 8601 UTC 时间 |
| `pollIntervalMs` | 2000 |
| `ttlMs` | 1800000 |

## MCP 错误 {#mcp-errors}

MCP 层的语义错误具有 `isError: true`、一个形如 `"<CODE>: <message>"` 的 text 项，且没有 `structuredContent`。代码为 `HEAL_APPLY_TOKEN_INVALID`（原因 `missing`、`unknown-token`、`superseded`、`expired`）、`HEAL_APPLY_FAILED`、`JOB_NOT_FOUND`、`JOB_FAILED`。非法输入使用 SDK 验证错误；领域和环境失败仍留在报告封装中。

## 与原计划设计的变化 {#changes-from-the-planned-design}

| 原 planned 页面 | 已实现契约 |
| --- | --- |
| 包含 review 的五个工具 | 四个工作流加状态与取消，共六个工具；不暴露 review |
| 发布报告 `outputSchema` | 所有工具省略 `outputSchema` |
| heal 只有预览 | 通过 `applyToken` 进行两阶段同步应用 |
| 只有同步工作流 | 较长的 generate/run/heal 预览产生作业；无 ID 的状态请求返回列表 |
| 未规定服务器标志 | `ambercast mcp` 支持 `--dir` 与 `--sync-wait-ms` |
| 仅对报告退出码分类 | MCP 错误代码与 SDK 验证错误区别于报告封装 |
| 未规定 CLI 标志映射 | 输入排除 `headed`、`list`、`stale`、`json`、`yes`、`configPath` |
| 从报告推断退出码 | `_meta.exitCode` 与 text 首行携带退出码 |
| 规定 `target` 为四个工具共通 | `target` 仅由 `ambercast_generate` 接受；`ambercast_run`、`ambercast_check`、`ambercast_heal` 从 Plan 自身选择 Target，与 CLI 端的 Plan IR v4 迁移一致 |

相关链接：[ambercast mcp](/ambercast/zh-cn/reference/cli/mcp/#usage)、[MCP 服务器](/ambercast/zh-cn/agents/mcp-server/#connection-boundary)、[报告](/ambercast/zh-cn/reference/reports/#envelope)、[退出码](/ambercast/zh-cn/reference/exit-codes/#exit-code-table)。
