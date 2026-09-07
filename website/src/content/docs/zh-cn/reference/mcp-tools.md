---
title: MCP 工具
description: 定义 ambercast 规划中的 MCP 工具合约与结果分类规范。
status: planned
sidebar:
  badge:
    text: Planned
    variant: caution
---

:::caution
MCP 工具在 0.3.1 中尚未实现。本文档描述的是预期设计规范，而非当前版本的既有行为。
:::

本文档定义 ambercast 规划中的 MCP 工具合约与结果分类规范。

## 状态 {#status}

- MCP 工具在 0.3.1 中尚未实现；CLI 解析器仅接受 `generate`、`run`、`check` 和 `heal`，不包含 `mcp` 服务命令。其规划中的 v2 工具集由 MCP 设计定义。

链接：[ambercast mcp](/ambercast/zh-cn/reference/cli/mcp/#status)、[MCP 服务器](/ambercast/zh-cn/agents/mcp-server/)。

## 规划中的工具合约 {#planned-tool-contract}

- 工具名称采用 `ambercast_` 前缀加 snake_case 命名，暴露的操作界面包含一小组工作流操作，而非机械复制每一条 CLI 命令。
- `structuredContent` 使用与 CLI `--json` 相同的结构化报告模式（schema），并不作修改地作为 `outputSchema` 暴露。
- 截图以文件路径或 `resource_link` 形式返回，绝不以内联 base64 形式返回。
- 观察子树隔离说明（observed-subtree isolation note）同时出现在运行时有效载荷（runtime payload）与 JSON Schema 描述中。

## 工具列表 {#tool-table}

| 工具 | CLI 等效命令 | 注解（`readOnly`, `destructive`, `idempotent`, `openWorld`） | `isError: true` | `isError: false` 的合理否定结果 |
| --- | --- | --- | --- | --- |
| `ambercast_generate` | `generate --json` | `false`, `false`, `true`（弱）, `false` | 退出码 2 或 3。 | 严格歧义退出码 1。 |
| `ambercast_run` | `run --json` | `false`, `false`, `false`, `true` | 退出码 2 或 3，以及未受信任 Plan 拒绝退出码 4。 | 断言失败退出码 1。 |
| `ambercast_check` | `check --json` | `true`, `false`, `true`, `false` | 退出码 2 或 3。 | `stale`（已过期）发现退出码 4，在 `results[].status` 中体现。 |
| `ambercast_heal` | `heal --json` | `false`, `true`, `false`, `true` | 退出码 2 或 3（包括 CI 拒绝），以及修复前拒绝未受信任 Plan。 | 已启动但未解决的修复退出码 1。 |
| `ambercast_review` | `review --json` | `true`, `false`, `false`, `true` | 退出码 2 或 3。 | 审查关切退出码 1。 |

- 所有四项 MCP 注解都必须显式声明，因为破坏性与开放世界提示若沿用默认值是不安全的。
- 通用的 `isError` 策略对退出码 2 和 3 为 true；退出码 4 因工作流而异；而测试未通过（test-red）退出码 1 以及零匹配退出码 5 保持为 false。
- `ambercast_generate` 的幂等提示为弱幂等：跳过生成新的 Plan 且副作用趋于收敛，但 AI 输出本身可能存在差异。

## heal 安全默认值 {#heal-safety-default}

| 渠道 | `dryRun` 默认值 | 理由 |
| --- | --- | --- |
| MCP `ambercast_heal` | `true` | Agent 调用默认仅预览，因为 heal 是具破坏性的 MCP 工作流。 |
| CLI `ambercast heal` | `false` | MCP 默认值有意与本地 CLI 使用保持不对称。 |

- 设计建议面向具备相应能力的客户端提供等效于 `requiresUserInteraction` 的提示，但未将其作为强制的标准注解。

## 未决事项 {#undecided-items}

| 状态 | 事项 |
| --- | --- |
| 明确未决 | MCP 工具设计中无明确未决项；上述 5 个工具即为其声明的 v2 工具集。 |
| 未规定 | 除 MCP heal 的 `dryRun` 默认值之外，各工具的具体输入属性模式。 |
| 未规定 | 数据库重置设计指出 baseline 和 restore 对应未来的两个 MCP 工具，但未提供名称、注解、`isError` 规则或输入/输出模式。 |

链接：[报告](/ambercast/zh-cn/reference/reports/#envelope)、[ambercast review](/ambercast/zh-cn/reference/cli/review/#planned-interface)、[ambercast baseline 与 restore](/ambercast/zh-cn/reference/cli/baseline-restore/#planned-boundary)。
