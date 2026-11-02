---
title: 环境变量
description: ambercast 读取的环境变量，以及不会传给 AI 提供方子进程的变量。
---

ambercast 通过环境变量获取配置文件路径、AI 提供方、机密值和 CI 判定。启动 AI 提供方子进程之前，它会先过滤环境。

## 配置与提供方 {#configuration}

| 变量 | 读取时机 | 作用 | 优先级与边界情况 |
| --- | --- | --- | --- |
| `AMBERCAST_CONFIG` | 查找配置文件时 | 指定配置文件路径。 | 命令的 `--config` 优先级最高。其次是此变量，然后是向上级目录查找，最后是默认值。空值视为未设置，其他值按原样使用。 |
| `AMBERCAST_AI_PROVIDER` | 确定 AI 提供方时 | 用 `claude`、`codex` 或 `auto` 替换配置中的 `ai.provider`。 | `--ai` 优先级最高。其次是此变量，然后是配置中的 `ai.provider`，最后是默认值 `auto`。空值视为未设置。这三个值之外的非空值无效。 |
| `AMBERCAST_SECRET_*` | `{{secrets.*}}` 引用需要取值时 | 提供一个机密引用的值。 | 点号变为下划线，每一段转为大写，因此 `{{secrets.a.b}}` 读取 `AMBERCAST_SECRET_A_B`。变量缺失时，机密保持未解析。已存在的空变量属于已解析的值。 |
| `CI` | 命令应用 CI 策略时 | 启用 CI 策略。 | 变量已定义、非空且不是小写的 `false` 时，策略生效。`FALSE`、`0` 和空白字符都使策略保持生效。判断区分大小写，也不去除空白。 |
| `AMBERCAST_DEBUG` | CLI 崩溃时、`run` 输出进度时、MCP 服务器处理崩溃的任务或 heal 应用时 | 向 stderr 输出诊断信息。 | 未设置、为空、恰好为 `0` 或恰好为 `false` 时不生效，其他值都会使其生效。判断区分大小写，也不去除空白。 |

机密引用与 `AMBERCAST_SECRET_*` 之间不是一一对应。不要同时使用 `a.b` 和 `a_b` 这类引用。

### AMBERCAST_DEBUG 的输出 {#debug-output}

`AMBERCAST_DEBUG` 生效时，ambercast 向 stderr 输出以下诊断信息：

- CLI 崩溃的原因消息和堆栈。
- `run` 中未能分类的用例异常的名称、已脱敏的消息和堆栈。
- MCP 服务器中崩溃的任务或 heal 应用的原因消息和堆栈。
- 存在子进程诊断时，输出 `child process: exit <n>` 或 `child process: signal <name>`，随后是 `child stderr:` 和正文，正文为空时写作 `(empty)`。

这些诊断信息可能包含来自请求的敏感文本。

### 提供方的解析 {#provider-resolution}

提供方解析先应用 `--ai`。`auto` 之外的值直接返回，不做探测。取 `auto` 时，ambercast 先探测 `claude`，再探测 `codex`。每次探测的时限为 8,000 ms。

## 机密与 CI {#secrets}

| 被过滤的变量类别 | 是否传给 AI 提供方子进程 | 规则 |
| --- | --- | --- |
| `AMBERCAST_SECRET_*` | 否 | 每次启动子进程之前，ambercast 都会不区分大小写地移除这个命名空间。 |
| `AMBERCAST_ENV_*` | 否 | 按同样的不区分大小写规则移除这个命名空间。 |

## 提供方子进程的环境 {#provider-child-environment}

| 会传递的变量类别 | 是否传给 AI 提供方子进程 | 规则 |
| --- | --- | --- |
| 不匹配 `/^AMBERCAST_(SECRET\|ENV)_/i` 的键 | 是 | 运行器复制环境，只移除被拒绝的键，再把结果传给子进程。 |

这个过滤器是拒绝列表，不是允许列表。它返回浅拷贝，父进程的环境保持不变。只要设置了 `AMBERCAST_CONFIG`、`AMBERCAST_AI_PROVIDER` 和 `CI`，它们就会原样传递，普通运行时变量和提供方变量也一样。ambercast 不对提供方认证变量的名称作任何保证。

## 另请参阅 {#see-also}

- [配置](/ambercast/zh-cn/reference/configuration/#file-selection)
- [ambercast generate](/ambercast/zh-cn/reference/cli/generate/#flags)
- [ambercast run](/ambercast/zh-cn/reference/cli/run/#flags)
- [ambercast heal](/ambercast/zh-cn/reference/cli/heal/#flags)
- [提示词文件格式](/ambercast/zh-cn/reference/prompt-format/#normalization)
