---
title: 环境变量
description: Ambercast 所读取环境数据的详尽参考，以及向 AI 提供商子进程传递变量时的过滤边界。
---

Ambercast 在运行时会读取特定的系统环境变量，用于确定配置路径、解析 AI 提供商、在密钥提供商边界解析变量引用以及判定 CI 策略状态，并在派生 AI 提供商子进程时执行明确的环境变量过滤规则。

## 配置与提供商 {#configuration}

| 环境变量 | Ambercast 读取位置 | 作用 | 优先级与边缘情况 |
| --- | --- | --- | --- |
| `AMBERCAST_CONFIG` | `readConfigEnvironment()` → `configPathOverride` | 选择显式配置文件路径。 | 命令行的 `--config` 值优先级最高；其次是此环境变量；接着是祖先目录发现；最后是默认值。空值视作不存在；其他值均予以保留。 |
| `AMBERCAST_AI_PROVIDER` | `readConfigEnvironment()` → `aiProviderRaw` | 在校验为 `claude`、`codex` 或 `auto` 后，替换配置或默认的 `ai.provider`。 | `--ai` 优先级最高；其次是此环境变量；接着是配置中的 `ai.provider`；最后是默认值 `auto`。空值视作不存在；非空且不受支持的值视为无效。 |
| `AMBERCAST_SECRET_*` | `createEnvSecretsProvider().resolve()` | 在密钥提供商边界解析具体的 `{{secrets.*}}` 引用。 | 点号转换为下划线且各分段转为大写：`{{secrets.a.b}}` 映射为 `AMBERCAST_SECRET_A_B`；缺失的键返回 `undefined`。此映射为非单射，因此类似 `a.b` 与 `a_b` 的引用不得同时使用。 |
| `CI` | `createProcessEnvironmentInfo().isCI()` | 提供运行时命令所消费的 CI 策略布尔值。 | 仅在已定义、非空且值不严格等于全小写 `false` 时处于激活状态；`FALSE`、`0` 与空白字符均判定为激活。 |

提供商解析会在已加载的提供商之前优先应用命令行的 `--ai` 覆盖参数；非 `auto` 的值无需探测即可直接返回，而 `auto` 则会先探测 `claude`，再探测 `codex`。

每次自动提供商探测都有独立的 8,000 ms 可用性截止时间。

## 密钥与 CI {#secrets}

| 拦截的环境变量类别 | 是否传递给 AI 提供商子进程？ | 具体规则 |
| --- | --- | --- |
| `AMBERCAST_SECRET_*` | 否 | 在每次调用子进程前以不区分大小写的方式移除该命名空间。 |
| `AMBERCAST_ENV_*` | 否 | 使用相同的不区分大小写的拒绝规则移除该命名空间。 |

环境适配器在解析 `CI` 时不会忽略大小写，也不会对其执行空白字符修剪。

已存在但值为空的 `AMBERCAST_SECRET_<NAME>` 仍会被视为解析出的有效值；仅当计算得出的键完全缺失时才会返回 `undefined`。

## 提供商子进程环境 {#provider-child-environment}

| 传递的环境变量类别 | 是否传递给 AI 提供商子进程？ | 规则 |
| --- | --- | --- |
| 未匹配 `/^AMBERCAST_(SECRET|ENV)_/i` 的传入键 | 是 | 执行器会对注入的环境进行浅拷贝，仅移除被拒绝的键，并将结果作为 `spawn(...).env` 传入；因此常规的运行时/提供商变量以及 `AMBERCAST_CONFIG`、`AMBERCAST_AI_PROVIDER` 和 `CI` 若存在均会传递。 |

过滤机制采用拒绝列表而非固定的允许列表，因此实现层面对特定提供商的身份验证环境变量名称不做穷尽承诺。

过滤过程会返回一个副本，父进程环境保持不变。

相关链接：[配置](/ambercast/zh-cn/reference/configuration/#file-selection)、[ambercast generate](/ambercast/zh-cn/reference/cli/generate/#flags)、[ambercast run](/ambercast/zh-cn/reference/cli/run/#flags)、[ambercast heal](/ambercast/zh-cn/reference/cli/heal/#flags)、[提示词文件格式](/ambercast/zh-cn/reference/prompt-format/#normalization-and-grants)。
