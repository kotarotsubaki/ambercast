---
title: 配置
description: ambercast 的配置键、默认值，以及选择配置文件的规则。
---

ambercast 由一个配置文件和内置默认值构成配置。本页介绍它如何选择文件、目标的设置，以及所有配置键。

## 文件选择 {#file-selection}

存在的配置文件必须包含 `$schema`。其他已声明的键都是可选的。

ambercast 按下面的顺序选择文件：

1. 命令的 `--config` 值。`generate`、`check` 和 `view` 接受它，`run`、`heal`、`init` 和 `mcp` 不接受。参见[命令与参数对照表](/ambercast/zh-cn/reference/cli/overview/#command-flag-matrix)。
2. 环境变量 `AMBERCAST_CONFIG`，详见[环境变量](/ambercast/zh-cn/reference/environment-variables/#configuration)。
3. 上级目录中的 `ambercast.config.json`。
4. 内置默认值。

显式指定的路径不存在时会报错，不会回退到自动查找或默认值。

你提供的 `targets` 对象会替换默认目标，而不是与它合并。替换时如果省略 `defaultTarget`，默认目标就被清除。

## 目标 {#targets}

目标提供一个 Web 界面和一个浏览器目的地。ambercast 在 heal 之前和元素解析之前，实时解析 `healReplayIsolation` 和 `resolveTimeoutMs`。它们不是执行计划的字段，也不会进入 `inputsDigest`。

加载文件时，ambercast 用 `Intl.getCanonicalLocales` 规范化写下的 `locale`。例如 `"ja-jp"` 会变成 `"ja-JP"`。抛出 `RangeError` 的值、空字符串和非字符串值，会在问题路径 `targets.<name>.locale` 处以 `CONFIG_INVALID` 失败，退出码为 2。

规范化后的 locale 会进入执行计划中的目标定义和 Playwright 浏览器上下文。它会影响该目标页面的 `navigator.language`，以及第一个请求的 `Accept-Language` 头。

这个设置的作用到此为止。它不设置时区、应用侧的语言 Cookie 或应用侧的偏好，也不规定与这些机制之间的优先顺序。

## 配置键列表 {#key-table}

| 键路径 | 类型 | 默认值 | 约束 | 使用方 |
| --- | --- | --- | --- | --- |
| `$schema` | string | — | 存在配置文件时必填 | 加载器 |
| `testDir` | string | `tests/ambercast` | 解析为绝对的布局路径 | generate、run、check、heal（发现与布局） |
| `runsDir` | string | `tests/ambercast/.runs` | 解析为绝对的布局路径 | run（报告与证据）；heal（受限写入） |
| `testMatch` | string[] | `["**/*.test.md"]` | 受限的 `*`/`**` 匹配器。每个模式都必须以 `.test.md` 结尾，否则加载会以 `CONFIG_INVALID` 失败 | generate、run、check、heal（发现） |
| `testIgnore` | string[] | `["**/.runs/**","**/*.ambercast.plan.json","**/*.ambercast.grounding.json"]` | 在包含匹配之后排除 | generate、run、check、heal（发现） |
| `secrets.allow` | `SecretName[] \| "*"` | `[]` | 空数组表示每个机密名称都需要同意。`"*"` 不经同意就允许所有名称（不推荐）。非空数组只允许其中列出的名称 | generate、run、heal |
| `targets.<name>.baseUrl` | string | `web-user` 上为 `http://localhost:3000` | 你写的每个目标都必须有；是不含字面量 `{{secrets.` 的 http(s) URL。替换整个目标记录 | generate（输入）；run、check、heal（执行计划引用的目标） |
| `targets.<name>.surface` | `web` | — | TP1 中只有 `web`。这个可选字段在使用时解析为 `web`，而不是通过 schema 默认值 | generate；执行计划中的目标定义 |
| `targets.<name>.description` | string | — | 可选的生成上下文 | generate |
| `targets.<name>.executor.kind` | `playwright` | `playwright` | 实时 UI 执行器的类型；不计入执行计划摘要 | run、heal（执行器组装） |
| `targets.<name>.executor.browser` | `chromium` | `chromium` | 实时执行器使用的浏览器；不计入执行计划摘要 | run、heal（执行器组装） |
| `targets.<name>.secretSinkOrigins` | `Record<SecretRef, SecretSinkOrigin[]>` | — | 没有某个机密的条目时，只允许 `baseUrl`。空数组表示该机密在所有位置都被拒绝。非空数组会替换这个默认值。每个来源的格式为 `scheme://host[:port]`，端口为 1–65535，不能带路径、查询、片段、通配符、用户信息或字面量 `{{secrets.` | generate、run、heal（机密落点策略）；check（新鲜度） |
| `targets.<name>.healReplayIsolation` | `idempotent\|stateful` | `stateful` | heal 要求执行计划引用的每个目标都是 `idempotent` | heal |
| `targets.<name>.locale` | string | — | 通过 `Intl.getCanonicalLocales` 规范化。规范化失败的值会触发 `CONFIG_INVALID` | generate；执行计划中的目标定义；run（浏览器上下文） |
| `targets.<name>.resolveTimeoutMs` | integer | `5000` | 0–60000 | run、heal |
| `defaultTarget` | string | `web-user` | 必须能解析为某个目标。提示词没有指明某个步骤的目标时，生成器使用它 | generate |
| `ai.provider` | `claude\|codex\|auto` | `auto` | 命令行参数或环境变量可以覆盖它 | generate；run（回退）；heal |
| `ai.maxGenerateAttempts` | positive integer | `2` | 1–5；每个文件的生成尝试次数 | 仅 generate；不用于 heal 的第 3 阶段 |
| `ai.timeoutMs` | positive integer | `600000` | 正数 | generate；run（回退）；heal |
| `viewer.port` | integer | `4600` | 1–65535；起始候选端口，会被 `--port` 覆盖 | view |
| `ci.heal` | boolean | `false` | 在 CI 中选择启用非列表模式的 heal | heal |
| `ci.updateGroundingCache` | boolean | `false` | 在 CI 中选择启用缓存回写 | run |
| `grounding.repositoryPolicy` | `committed\|uncommitted` | `committed` | 有限的取值集合 | check |
| `grounding.localWriteBack` | `auto\|explicit` | `auto` | 在 CI 中被忽略 | run |
| `heal.maxStepRepairs` | positive integer | — | 只限制增量的真实提供方调度 | heal |
| `heal.caseTimeoutMs` | positive integer | `300000` | 用例准入期限 | heal |

`testMatch` 和 `testIgnore` 的模式遵循[模式语言](/ambercast/zh-cn/reference/discovery-patterns/#pattern-language)。

## 机密同意 {#secret-consent}

`secrets.allow` 是持久的允许列表，保存生成过程中发现的逻辑机密名称。`generate` 会就列表之外的名称向你确认，并把你接受的名称合并进文件。在 CI 等无法交互的环境中，请事先把已审核的名称填入列表。

`"*"` 会跳过逐个名称的同意，接受 AI 提出的任何名称。它不是更安全的默认值，而是高风险的逃生口。只有在你确实打算不经审核就接受任意提议的名称时才使用。

## AI 配置 {#ai}

`ai.maxGenerateAttempts` 是 `generate` 为一个提示词向提供方请求的最多次数，包含首次请求。只有本地校验拒绝响应时，才会再次尝试。范围是 1 到 5，默认值为 2。它不适用于 heal 的修复。

`ai.timeoutMs` 是一次提供方调度的期限，单位为毫秒，默认值为 600000。它适用于每一次 generate、run 和 heal 的调度。heal 的用例期限只决定是否准入，所以已准入的调度仍可运行到这个值。

## heal 配置 {#heal}

`heal.maxStepRepairs` 限制增量的真实提供方调度次数。`heal.caseTimeoutMs` 是整个用例的准入期限。

## 定位缓存回写 {#grounding}

| 环境 | 生效的策略 | 定位缓存写入的条件 |
| --- | --- | --- |
| 本地 | `localWriteBack: auto` | 定位结果发生变化时 |
| 本地 | `localWriteBack: explicit` | 传入 `--update-cache` 时 |
| CI | 忽略 `localWriteBack` | 传入 `--update-cache`，或 `ci.updateGroundingCache: true` 时 |

命令的行为见 [ambercast run](/ambercast/zh-cn/reference/cli/run/#grounding-write-back)。

## 另请参阅 {#see-also}

- [CLI 概览](/ambercast/zh-cn/reference/cli/overview/#command-flag-matrix)
- [发现模式](/ambercast/zh-cn/reference/discovery-patterns/#pattern-language)
- [环境变量](/ambercast/zh-cn/reference/environment-variables/#configuration)
- [ambercast run](/ambercast/zh-cn/reference/cli/run/#grounding-write-back)
