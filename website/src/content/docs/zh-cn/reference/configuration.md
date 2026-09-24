---
title: 配置
description: 本页定义了配置键及其解析逻辑。
---

本页定义了配置键及其解析逻辑。当存在配置文件时，系统依据明确的优先级解析配置键与目标定义。

## 文件选择 {#file-selection}

- 若存在配置文件，则该文件必须包含 `$schema`；所有其他已声明的键均为可选。
- 文件的选择优先级依次为：命令行参数 `--config`（仅适用于 generate 与 check）、环境变量 `AMBERCAST_CONFIG`、祖先目录中的 `ambercast.config.json`，最后为内置默认值。
- 若显式指定的配置文件路径不存在，系统将直接报错，而不会回退至发现机制或默认值。
- 自行提供的 `targets` 对象会直接替换默认目标，而不是与其进行深度合并；若在该替换中省略 `defaultTarget`，则会清除默认目标。

## 目标 {#targets}

目标配置提供浏览器目的地；其 `healReplayIsolation` 设置在 heal 之前、`resolveTimeoutMs` 设置在元素解析之前分别完成实时解析，二者均不是 Plan 或 inputs-digest 字段。

## 配置键列表 {#key-table}

| 键路径 | 类型 | 默认值 | 约束 | 使用方 |
| --- | --- | --- | --- | --- |
| `$schema` | string | — | 配置文件存在时必填 | loader |
| `testDir` | string | `tests/ambercast` | 解析为绝对布局路径 | generate、run、check、heal 发现/布局 |
| `runsDir` | string | `tests/ambercast/.runs` | 解析为绝对布局路径 | run 报告/证据；heal 包含的写入 |
| `testMatch` | string[] | `["**/*.test.md"]` | 受限的 `*`/`**` 匹配器；每个模式必须以 `.test.md` 结尾，否则加载配置会以 `CONFIG_INVALID` 失败 | generate、run、check、heal 发现 |
| `testIgnore` | string[] | `["**/.runs/**","**/*.ambercast.plan.json","**/*.ambercast.grounding.json"]` | 包含匹配后排除 | generate、run、check、heal 发现 |
| `secrets.allow` | `SecretName[] \| "*"` | `[]` | 空数组要求所有 secret 名称都需同意；`"*"` 允许所有名称且无需同意（不推荐）；非空数组仅允许其中列出的名称 | generate、run、heal |
| `targets.<name>.baseUrl` | string | `web-user` 上的 `http://localhost:3000` | 替换整个 target 记录 | generate、run、check、heal 目标选择 |
| `targets.<name>.surface` | `web` | absent | TP1 仅支持 `web` | generate 与 Plan 目标定义 |
| `targets.<name>.description` | string | 无 | 可选的生成上下文 | generate |
| `targets.<name>.browser` | `chromium` | `web-user` 上的 `chromium` | target 字段 | generate、run、heal 浏览器编排；check（新鲜度） |
| `targets.<name>.secretSinkOrigins` | `Record<SecretRef, SecretSinkOrigin[]>` | absent | 缺省 secret 条目时仅允许 `baseUrl`；空数组将在所有位置拒绝该 secret；非空数组替换该默认值 | generate、run、heal 的 secret 接收方策略；check（新鲜度） |
| `targets.<name>.healReplayIsolation` | `idempotent|stateful` | `stateful` | heal 要求所选目标必须为 `idempotent` | heal |
| `targets.<name>.resolveTimeoutMs` | integer | `5000` | 0–60000 | run; heal |
| `defaultTarget` | string | `web-user` | 必须解析为一个目标 | generate、run、check、heal 目标选择 |
| `ai.provider` | `claude|codex|auto` | `auto` | CLI/环境变量可覆盖 | generate；run 兜底；heal |
| `ai.maxGenerateAttempts` | positive integer | `2` | 1–5；每个文件的生成尝试次数 | 仅 generate；绝不用于 heal Stage 3 |
| `ai.timeoutMs` | positive integer | `600000` | 正数 | generate；run 兜底；heal |
| `viewer.port` | integer | `4600` | 1–65535；起始候选端口，可被 `--port` 覆盖 | view |
| `ci.heal` | boolean | `false` | 在 CI 中选择开启非 list 的 heal | heal |
| `ci.updateGroundingCache` | boolean | `false` | CI 回写选择启用项 | run |
| `grounding.repositoryPolicy` | `committed|uncommitted` | `committed` | 有限取值集合 | check |
| `grounding.localWriteBack` | `auto|explicit` | `auto` | 在 CI 中被忽略 | run |
| `heal.maxStepRepairs` | positive integer | absent | 仅限制向真实提供商发起的增量分发次数 | heal |
| `heal.caseTimeoutMs` | positive integer | `300000` | 用例准入截止时间 | heal |

## 机密同意 {#secret-consent}

`secrets.allow` 是生成时发现的逻辑机密名称的持久许可列表。`generate` 会为列表之外的名称请求交互式批准，并将已接受的名称合并到配置文件中。在 CI 或其他非交互环境中，请预先填入已审查的名称。

`"*"` 会绕过逐名同意并接受 AI 提出的任意名称。它是高风险的逃生出口，不是更安全的默认值；仅当确实希望不经审查地接受任意提议名称时才使用。

## AI 配置 {#ai}

`ai.maxGenerateAttempts`：当本地验证器拒绝响应时，generate 针对每个提示词允许的提供商最大尝试次数。取值范围为 1 至 5，默认值为 2。绝不用于 heal 修复。

`ai.timeoutMs`：单次提供商分发的截止时间（毫秒）。适用于 generate、run 和 heal 的每次分发。heal 用例截止时间仅是准入边界，因此已准入的分发仍可继续运行，最长不超过此值。默认值为 600000。

## 自愈配置 {#heal}

`heal.maxStepRepairs` 用于控制向真实提供商发起的增量分发次数，而 `heal.caseTimeoutMs` 则确立整个用例的准入截止时间。

## Grounding 回写 {#grounding}

| 环境 | 解析后的策略 | grounding 写入时机 |
| --- | --- | --- |
| 本地 | `localWriteBack: auto` | grounding 结果发生变更后自动写入 |
| 本地 | `localWriteBack: explicit` | 传入 `--update-cache` 时 |
| CI | `localWriteBack` 被忽略 | 传入 `--update-cache` 或 `ci.updateGroundingCache: true` 时 |

相关链接：[CLI 概览](/ambercast/zh-cn/reference/cli/overview/#command-flag-matrix)、[发现模式](/ambercast/zh-cn/reference/discovery-patterns/#pattern-language)、[环境变量](/ambercast/zh-cn/reference/environment-variables/#configuration)、[ambercast run](/ambercast/zh-cn/reference/cli/run/#grounding-write-back)。
