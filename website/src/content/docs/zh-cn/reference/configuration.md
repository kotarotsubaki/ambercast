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

目标配置提供浏览器目的地；其 `healReplayIsolation` 设置在 heal 之前完成解析，且它不是 Plan 或 inputs-digest 字段。

## 配置键列表 {#key-table}

| 键路径 | 类型 | 默认值 | 约束 | 使用方 |
| --- | --- | --- | --- | --- |
| `$schema` | string | — | 配置文件存在时必填 | loader |
| `testDir` | string | `tests/ambercast` | 解析为绝对布局路径 | generate、run、check、heal 发现/布局 |
| `runsDir` | string | `tests/ambercast/.runs` | 解析为绝对布局路径 | run 报告/证据；heal 包含的写入 |
| `testMatch` | string[] | `["**/*.test.md"]` | 受限的 `*`/`**` 匹配器 | generate、run、check、heal 发现 |
| `testIgnore` | string[] | `["**/.runs/**","**/*.ambercast.plan.json","**/*.ambercast.grounding.json"]` | 包含匹配后排除 | generate、run、check、heal 发现 |
| `targets.<name>.baseUrl` | string | `web-user` 上的 `http://localhost:3000` | 替换整个 target 记录 | generate、run、check、heal 目标选择 |
| `targets.<name>.browser` | `chromium` | `web-user` 上的 `chromium` | target 字段 | generate、run、heal 浏览器编排；check（新鲜度） |
| `targets.<name>.secretSinkOrigins` | `Record<SecretRef, SecretSinkOrigin[]>` | absent | 缺省 secret 条目时仅允许 `baseUrl`；空数组将在所有位置拒绝该 secret；非空数组替换该默认值 | generate、run、heal 的 secret 接收方策略；check（新鲜度） |
| `targets.<name>.healReplayIsolation` | `idempotent|stateful` | `stateful` | heal 要求所选目标必须为 `idempotent` | heal |
| `defaultTarget` | string | `web-user` | 必须解析为一个目标 | generate、run、check、heal 目标选择 |
| `ai.provider` | `claude|codex|auto` | `auto` | CLI/环境变量可覆盖 | generate；run 兜底；heal |
| `ai.timeoutMs` | positive integer | `120000` | 正数 | generate；run 兜底；heal |
| `viewer.port` | integer | `4600` | 1–65535；viewer 命令处于计划中 | 仅用于计划中的 `view` |
| `ci.heal` | boolean | `false` | 在 CI 中选择开启非 list 的 heal | heal |
| `ci.updateGroundingCache` | boolean | `false` | CI 回写选择启用项 | run |
| `grounding.repositoryPolicy` | `committed|uncommitted` | `committed` | 有限取值集合 | check |
| `grounding.localWriteBack` | `auto|explicit` | `auto` | 在 CI 中被忽略 | run |
| `heal.maxStepRepairs` | positive integer | absent | 仅限制向真实提供商发起的增量分发次数 | heal |
| `heal.caseTimeoutMs` | positive integer | `300000` | 用例准入截止时间 | heal |

## 自愈配置 {#heal}

`heal.maxStepRepairs` 用于控制向真实提供商发起的增量分发次数，而 `heal.caseTimeoutMs` 则确立整个用例的准入截止时间。

## Grounding 回写 {#grounding}

| 环境 | 解析后的策略 | grounding 写入时机 |
| --- | --- | --- |
| 本地 | `localWriteBack: auto` | grounding 结果发生变更后自动写入 |
| 本地 | `localWriteBack: explicit` | 传入 `--update-cache` 时 |
| CI | `localWriteBack` 被忽略 | 传入 `--update-cache` 或 `ci.updateGroundingCache: true` 时 |

相关链接：[CLI 概览](/ambercast/zh-cn/reference/cli/overview/#command-flag-matrix)、[发现模式](/ambercast/zh-cn/reference/discovery-patterns/#pattern-language)、[环境变量](/ambercast/zh-cn/reference/environment-variables/#configuration)、[ambercast run](/ambercast/zh-cn/reference/cli/run/#grounding-write-back)。
