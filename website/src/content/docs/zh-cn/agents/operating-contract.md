---
title: 操作契约
description: 规定 AI Agent 安全调用 ambercast 时的动作边界、核心禁令以及退出状态与错误处理契约。
---

ambercast 解析器所公开实现的命令恰好为 `generate`、`run`、`check` 与 `heal`。本页为 AI Agent 提供调用这些命令时的动作边界、前提条件、副作用以及所需的批准规则，帮助您判断是否能够安全地调用相应命令。

## 命令契约 {#command-contract}

解析器公开实现的命令恰好为 `generate`、`run`、`check` 与 `heal`。其中，`check` 命令完全不依赖可变存储、AI 提供商或浏览器。对于 `heal` 命令，系统仅将计划与 grounding 伴生文件的修改缓冲至确认阶段；但在获得批准之前以及在 dry run 运行期间，其重放尝试可能会在用例运行目录中写入包含证据。

| 命令 | 前提条件 | 副作用 | 是否需要批准？ | CI 中是否安全？ |
| --- | --- | --- | --- | --- |
| generate | 所选 prompt 与目标必须有效。 | 可能写入计划与 grounding 工件。 | 写入时需要；提交前须呈现 diff。 | 安全，遵循项目策略。 |
| run | 所选 prompt 具有受信任的计划。 | 写入调用报告；可在其回写契约下写入 grounding。 | 当请求的范围未预先授权写入时需要。 | 安全，遵循回写策略。 |
| check | 所选目标可被发现。 | 仅读取 prompt 与工件。 | 不需要 ambercast 工件写入批准。 | 安全。 |
| heal | 目标具备幂等性，且在 CI 中时已启用真实尝试。 | 可能在 runs 目录中写入尝试证据；仅在确认后提交测得的计划/grounding 候选变更。 | 需要用户明确批准；--yes 不构成 agent 授权。 | 默认不安全；仅在 ci.heal: true 时安全。 |

相关链接：[CLI 概览](/ambercast/zh-cn/reference/cli/overview/)、[ambercast heal](/ambercast/zh-cn/reference/cli/heal/#preconditions)、[ambercast run](/ambercast/zh-cn/reference/cli/run/#grounding-write-back)

## 禁止事项 {#prohibitions}

以下为调用命令时必须遵守的非协商性安全边界：

- Agent 绝不能在 prompt、工件、命令、报告或消息中放置字面机密值；请改用 SecretRef、其环境变量值以及目标的接收端策略（sink policy）。
- 公共错误词汇表中包含 `SECRET_LITERAL_REJECTED`；该检测器属于狭义的启发式检测，不能替代 Agent 对字面机密的禁止规则。
- 在 CI 环境中，除非启用了 `ci.heal`，否则会拒绝执行真实的修复。
- `--yes` 仅用于预先授权 CLI 的确认提示；dry run 绝不会进行提交。

相关链接：[管理机密](/ambercast/zh-cn/how-to/manage-secrets/)、[自愈模型](/ambercast/zh-cn/explanation/healing-model/#confirmation-and-writes)

## 进程状态后的后续动作 {#next-action-by-exit-code}

进程状态是从批处理退出候选状态中选出的，独立于结果的返回顺序。

| 进程结果 | 下一步安全动作 |
| --- | --- |
| 成功 | 检查允许的 diff，并在范围内继续。 |
| 失败证据 | 检查失败证据；不要自动执行 heal 或重新生成。 |
| 用法或配置问题 | 读取 `errors[].code` 并修正该边界。 |
| 环境问题 | 保留 envelope 并修复环境，而非修改测试语义。 |
| 不可信工件 | 使用 `stale`（已过期）工件恢复。 |
| 空选择 | 在允许空集合前，重新确认选择意图。 |

相关链接：[退出码](/ambercast/zh-cn/reference/exit-codes/#priority)

## 按报告错误分类的后续动作 {#next-action-by-report-error}

报告 schema 定义了八种用法代码与六种环境代码，且两类代码在 schema 中按类别进行了结构化分离。其中，`INTERRUPTED` 属于运行级别（run-scoped），而被跳过的结果行则代表受影响的具体用例。

| 错误类别 | 下一步安全动作 |
| --- | --- |
| 配置、机密或目标 | 读取指定的 Reference，在不猜测具体值的情况下修正该边界。 |
| 计划新鲜度或完整性 | 将工件视为不可信，并使用 `stale`（已过期）工件恢复。 |
| 浏览器、提供商、存储或崩溃 | 保留 envelope 并修复环境。 |
| 中断 | 将剩余工作视为未完成；切勿推断用例结果。 |

相关链接：[错误代码](/ambercast/zh-cn/reference/error-codes/)、[读取结构化输出](/ambercast/zh-cn/agents/reading-structured-output/#decision-tree)、[常见故障排查](/ambercast/zh-cn/how-to/troubleshoot/)
