---
title: 操作契约
description: 针对每个命令，说明运行前必须满足什么条件、会写入什么、是否需要用户批准，以及收到退出码或报告错误后下一步做什么。
---

本页帮助 Agent 判断能否运行某个命令，以及运行后怎么做。CLI 实现了七个命令：`init`、`generate`、`run`、`check`、`heal`、`view` 和 `mcp`。

## 命令契约 {#command-contract}

运行命令前，先确认前置条件和副作用。`check` 与 `view` 不需要可写存储、AI 提供方或浏览器。`heal` 会把执行计划与定位缓存的改动保留到确认之后，但在批准前和 `--dry-run` 期间，仍可能在 `runsDir` 下写入尝试证据。

| 命令 | 前置条件 | 副作用 | 是否需要批准 | CI 中使用 |
| --- | --- | --- | --- | --- |
| `init` | 对目标目录有写权限。 | 可能写入配置、示例提示词、两行 `.gitignore` 内容和 `AGENTS.md` 区块。 | 需要用户明确批准；`--yes` 不等于 Agent 授权。 | 不带 `--yes` 的非交互运行会被拒绝。在 CI 中使用不改变批准边界。 |
| `generate` | 提示词和目标有效。 | 除非设置 `--list` 或 `--dry-run`，否则写入执行计划和定位缓存；`--dry-run` 不写入任何内容。经交互同意后，把接受的机密名称加入 `secrets.allow`。 | 同意与写入需要批准；提交前先展示差异。 | 评审过的名称已在 `secrets.allow` 中时可用。 |
| `run` | 所选提示词有可信的执行计划。 | 保存报告；仅在通过回写条件时写入定位缓存。 | 请求范围未允许写入时需要批准。 | 可用，遵循回写策略。 |
| `check` | 明确给出测试路径，或发现机制能找到所选测试。 | 只读取提示词和产物。 | 不需要。 | 可用。 |
| `heal` | 执行计划引用的每个目标都设置了 `healReplayIsolation: "idempotent"`（默认是 `stateful`）。 | 可能写入尝试证据；执行计划与定位缓存的改动只在确认后写入。 | 需要用户明确批准；`--yes` 不等于 Agent 授权。 | 除 `--list` 外，`ci.heal` 不为 `true` 时被拒绝。 |
| `view` | stdin 与 stderr 都是终端且 `CI` 未启用，或传入 `--allow-headless`。不带 `--port` 时最多尝试 20 个连续端口。 | 启动只读 HTTP 服务器提供已保存的运行报告；不写入任何内容。 | 不需要。 | 没有终端时需要 `--allow-headless`。 |
| `mcp` | 会话根目录已存在。 | 启动 stdio 服务器；各工具遵循自己的写入与批准边界。 | 取决于所调用的工具。 | 取决于所调用的工具。 |

除 `--list` 外，`heal` 的目标不是幂等时，命令以退出码 2 失败，错误码为 `CONFIG_INVALID`。

相关链接：[CLI 概览](/ambercast/zh-cn/reference/cli/overview/)、[ambercast init](/ambercast/zh-cn/reference/cli/init/#confirmation)、[ambercast heal](/ambercast/zh-cn/reference/cli/heal/#preconditions)、[ambercast run](/ambercast/zh-cn/reference/cli/run/#grounding-write-back)

## 禁止事项 {#prohibitions}

以下限制没有例外。

- 不要在提示词、产物、命令、报告或消息中写入机密的明文值。使用 `SecretRef`、对应的环境变量以及目标的输出位置策略。
- `SECRET_LITERAL_REJECTED` 来自范围很窄的检测，不能代替上面的禁止规则。
- 不要添加 `@ambercast-secret` 授权行。名称不在 `secrets.allow` 中时，先取得操作者同意，或请操作者加入已评审的名称。`"*"` 会接受 AI 提出的任意名称，因此需要明确批准。
- 在 CI 中，除非 `ci.heal` 为 `true`，否则不要运行真正的 heal。
- `--yes` 只回答 CLI 的确认提示。试运行从不提交。

相关链接：[管理机密](/ambercast/zh-cn/how-to/manage-secrets/)、[自愈模型](/ambercast/zh-cn/explanation/healing-model/#confirmation-and-writes)

## 按退出码决定下一步 {#next-action-by-exit-code}

命令有多个结果时，退出码按固定优先级决定，与结果的顺序无关。按下表行动。

| 退出码 | 含义 | 下一步安全动作 |
| --- | --- | --- |
| 0 | 成功或没有候选 | 检查允许范围内的差异，在范围内继续。 |
| 1 | 命令自身的否定结果 | 读取失败的证据。不要自动 heal 或重新生成。 |
| 2 | 用法或配置问题 | 读取 `errors[].code`，修正对应的边界。 |
| 3 | 环境问题 | 保留 JSON 报告，修复环境而不是测试。 |
| 4 | 执行计划或定位缓存不可信 | 遇到 `MISSING_PLAN`、`STALE_PLAN`、`INTEGRITY_VIOLATION` 时，走过期产物恢复流程。遇到 `GROUNDING_UNRESOLVED` 时，仅当请求范围允许调用 AI 并写入定位缓存才加 `--resolve` 重跑，否则向用户报告。 |
| 5 | 选择为空 | 先确认意图，再决定是否允许空选择。 |

相关链接：[退出码](/ambercast/zh-cn/reference/exit-codes/#aggregation-priority)

## 按报告错误决定下一步 {#next-action-by-report-error}

报告 schema 定义了十五种用法代码与八种环境代码。`INTERRUPTED` 属于整次运行，受影响的用例以 `skipped` 行表示。每个会被产生的错误码恰好属于下表的一行。遗留的 `SECRET_GRANT_UNATTRIBUTABLE` 不会被产生，也没有对应的行。

| 错误码 | 下一步安全动作 |
| --- | --- |
| `CONFIG_INVALID`、`PROMPT_PATH_INVALID`、`TARGET_UNRESOLVED`、`EXECUTOR_UNSUPPORTED`、`PROMPT_AMBIGUOUS` | 阅读对应的参考页，不要猜测取值，直接修正边界。 |
| `SECRET_UNRESOLVED`、`SECRET_LITERAL_REJECTED`、`SECRET_ENV_VAR_COLLISION`、`SECRET_SYNTAX_REJECTED` | 修正机密引用或环境变量，不要把值写进提示词。 |
| `SECRET_CONSENT_REQUIRED` | 以交互方式取得批准，或把评审过的名称加入 `secrets.allow`。不要当作已同意而重试。 |
| `MISSING_PLAN`、`STALE_PLAN`、`INTEGRITY_VIOLATION` | 视产物为不可信，走过期产物恢复流程。 |
| `GROUNDING_UNRESOLVED` | 仅当请求范围允许时才加 `--resolve` 重跑，否则向用户报告。仍然失败时，读取 `details.reason` 并报告，不要反复重试。 |
| `BROWSER_LAUNCH_FAILED`、`AI_EXECUTOR_UNAVAILABLE`、`AI_RESPONSE_INVALID`、`FS_IO_ERROR`、`UNEXPECTED_CRASH` | 保留 JSON 报告，修复环境。 |
| `AGENTIC_STEP_FAILED`、`CASE_ABORTED` | 读取 `details`。不要推断用例结果，修正环境或调用条件。 |
| `INTERRUPTED` | 视剩余工作为未完成，不要推断用例结果。 |

相关链接：[错误代码](/ambercast/zh-cn/reference/error-codes/)、[读取结构化输出](/ambercast/zh-cn/agents/reading-structured-output/#decision-tree)、[常见故障排查](/ambercast/zh-cn/how-to/troubleshoot/)
