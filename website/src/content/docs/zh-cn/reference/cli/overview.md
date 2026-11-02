---
title: CLI 概览
description: ambercast 的 7 个命令、各命令接受的选项，以及文件发现的默认值。
---

每个 `ambercast` 命令各自解析参数。不传文件时，由配置好的发现机制选择测试。

## 命令体系 {#command-surface}

已实现的命令只有 `init`、`generate`、`run`、`check`、`heal`、`view` 和 `mcp`。

`ambercast run <file>`、`ambercast check <file>` 和 `ambercast heal <file>` 针对步骤中指明了执行目标的执行计划工作。

顶层的 `--help` 和 `--version` 在命令分发之前处理。写在已识别命令之后、`--` 之前的 `--help`，由该命令立即处理。参数格式不正确时，命令以退出码 `2` 结束，把用法写到 stderr，并且不生成报告。

下面的用法块与 CLI 自带的帮助输出一致，包括 `AI configuration` 和 `Heal configuration` 两部分。

```text
Usage: ambercast <command> [options]

Commands:
  init                 Scaffold config and a sample prompt
  generate [files...]  Generate deterministic plans
  run [files...]       Replay deterministic plans
  check [files...]     Check plan freshness
  heal [files...]      Repair deterministic plans
  view                 Browse run results in a browser
  mcp                  Serve the MCP stdio server

Init options:
  --dir <path>  --yes, -y  --force  --no-color

Generate options:
  --force  --dry-run  --target <name>  --ai <claude|codex>
  --allow-empty  --list  --json  --config <path>  --no-color

Run options:
  --grep <pattern>  --headed  --resolve  --update-cache  --allow-empty  --list
  --stale <fail>  --ai <claude|codex>  --json  --no-color

Check options:
  --allow-empty  --list  --json  --config <path>  --no-color

Heal options:
  --dry-run  --yes, -y  --ai <claude|codex>  --allow-empty  --list  --json  --no-color

View options:
  --port <n>  --host <addr>  --allow-headless  --config <path>  --no-color

Mcp options:
  --dir <path>  --sync-wait-ms <n>

AI configuration:
  ai.timeoutMs: Deadline in milliseconds for one provider dispatch. Applies to every generate, run, and heal dispatch. The heal case deadline is an admission boundary only, so an admitted dispatch may still run up to this value. Default 600000.
  ai.maxGenerateAttempts: Maximum provider attempts per prompt during generate when the local validators reject a response. Between 1 and 5, default 2. Never applies to heal repairs.

Heal configuration:
  heal.maxStepRepairs: Hard limit on real provider dispatches started during incremental repair. Charged at dispatch time regardless of outcome. Includes element confirmation dispatches. Excludes the cache-only baseline and Stage 3.
  heal.caseTimeoutMs: see docs/configuration.md for its admission-boundary contract.
```

## 命令与选项矩阵 {#command-flag-matrix}

| 命令 | 位置参数 | 可用选项 | 配置路径 |
| --- | --- | --- | --- |
| init | 无 | dir, yes/-y, force, no-color | `--dir` 参数（省略时为当前目录） |
| generate | 字面路径；无路径则走发现 | force, dry-run, target, ai, allow-empty, list, json, config, no-color | `--config` > `AMBERCAST_CONFIG` > 发现 |
| run | 字面路径；无路径则走发现 | grep, headed, resolve, update-cache, stale, ai, allow-empty, list, json, no-color | `AMBERCAST_CONFIG` > 发现 |
| check | 字面路径；无路径则走发现 | allow-empty, list, json, config, no-color | `--config` > `AMBERCAST_CONFIG` > 发现 |
| heal | 字面路径；无路径则走发现 | dry-run, yes/-y, ai, allow-empty, list, json, no-color | `AMBERCAST_CONFIG` > 发现 |
| view | 无 | port, host, allow-headless, config, no-color | `--config` > `AMBERCAST_CONFIG` > 发现 |
| mcp | 无 | dir, sync-wait-ms | `--dir` 参数选择会话根目录（省略时为当前目录） |

对 `generate`、`run`、`check` 和 `heal`，除 `--list` 外，每个位置参数都必须是 `testDir` 内的字面路径。`.test.md` 前面的名称不能为空，并且后缀必须恰好是 `.test.md`。其他路径会以 `PROMPT_PATH_INVALID` 失败。

- `--` 结束选项解析，其后的参数全部按字面路径处理。
- `--json` 和 `--no-color` 由各命令自行处理，没有共享的全局标志。
- `generate --target` 限制生成器可用的目标定义。`run`、`check` 和 `heal` 使用每份执行计划中记录的目标名。

## 发现默认值 {#discovery-default}

不向 `generate`、`run`、`check` 或 `heal` 传字面文件时，配置好的发现机制选择测试文件。`init`、`view` 和 `mcp` 不接受 prompt 文件参数。

- 默认的 `testMatch` 是 `**/*.test.md`。
- 默认的 `testIgnore` 是 `**/.runs/**`，以及执行计划和定位缓存的伴生文件。
- 发现机制按 POSIX 相对路径计算。路径必须先匹配包含模式，随后匹配忽略模式则被排除。

详情见下列页面。

- [配置](/ambercast/zh-cn/reference/configuration/#file-selection)
- [发现模式](/ambercast/zh-cn/reference/discovery-patterns/#selection)
- [ambercast init](/ambercast/zh-cn/reference/cli/init/#flags)
- [ambercast generate](/ambercast/zh-cn/reference/cli/generate/#flags)
- [ambercast run](/ambercast/zh-cn/reference/cli/run/#flags)
- [ambercast check](/ambercast/zh-cn/reference/cli/check/#flags)
- [ambercast heal](/ambercast/zh-cn/reference/cli/heal/#flags)
- [ambercast view](/ambercast/zh-cn/reference/cli/view/#flags)
- [ambercast mcp](/ambercast/zh-cn/reference/cli/mcp/#usage)
