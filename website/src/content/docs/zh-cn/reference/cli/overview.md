---
title: CLI 概览
description: 介绍 ambercast 命令行界面的全局解析规则、核心命令集、命令与标志支持矩阵以及默认文件发现机制。
---

ambercast 命令行界面（CLI）负责处理全局参数解析并分发各核心命令。当前已实现的命令包括 init、generate、run、check、heal 与 view。本文档为您汇总了 CLI 的语法结构、各命令的标志矩阵以及未显式提供路径时的默认文件发现规则。

## 命令界面 {#command-surface}

```text
Usage: ambercast <command> [options]

Commands:
  init                 Scaffold config and a sample prompt
  generate [files...]  Generate deterministic plans
  run [files...]       Replay deterministic plans
  check [files...]     Check plan freshness
  heal [files...]      Repair deterministic plans
  view                 Browse run results in a browser

Init options:
  --dir <path>  --yes, -y  --force  --no-color

Generate options:
  --strict  --force  --dry-run  --target <name>  --ai <claude|codex>
  --allow-empty  --list  --json  --config <path>  --no-color

Run options:
  --grep <pattern>  --target <name>  --headed  --resolve  --update-cache  --allow-empty  --list
  --stale <fail>  --ai <claude|codex>  --json  --no-color

Check options:
  --target <name>  --allow-empty  --list  --json  --config <path>  --no-color

Heal options:
  --dry-run  --yes, -y  --target <name>  --ai <claude|codex>  --allow-empty  --list  --json  --no-color

View options:
  --port <n>  --host <addr>  --allow-headless  --config <path>  --no-color

AI configuration:
  ai.timeoutMs: Deadline in milliseconds for one provider dispatch. Applies to every generate, run, and heal dispatch. The heal case deadline is an admission boundary only, so an admitted dispatch may still run up to this value. Default 600000.
  ai.maxGenerateAttempts: Maximum provider attempts per prompt during generate when the local validators reject a response. Between 1 and 5, default 2. Never applies to heal repairs.

Heal configuration:
  heal.maxStepRepairs: Hard limit on real provider dispatches started during incremental repair. Charged at dispatch time regardless of outcome. Includes element confirmation dispatches. Excludes the cache-only baseline and Stage 3.
  heal.caseTimeoutMs: see docs/configuration.md for its admission-boundary contract.
```

ambercast 当前已实现的命令包括 init、generate、run、check、heal 以及 view。

顶层标志 `--help` 与 `--version` 会在命令分发之前短路处理并退出；若传入格式错误的参数，程序将直接以退出码 2 终止退出，且不输出错误报告。

## 命令与标志矩阵 {#command-flag-matrix}

| 命令 | 位置参数 | 支持的选项 | 配置路径 |
| --- | --- | --- | --- |
| init | 无 | dir, yes/-y, force, no-color | `--dir` 参数（未指定时为 cwd） |
| generate | 字面路径；未指定路径则执行发现 | strict, force, dry-run, target, ai, allow-empty, list, json, config, no-color | --config > AMBERCAST_CONFIG > discovery |
| run | 字面路径；未指定路径则执行发现 | grep, target, headed, resolve（启用实时 AI 解析）, update-cache, stale（已过期）, ai, allow-empty, list, json, no-color | AMBERCAST_CONFIG > discovery |
| check | 字面路径；未指定路径则执行发现 | target, allow-empty, list, json, config, no-color | --config > AMBERCAST_CONFIG > discovery |
| heal | 字面路径；未指定路径则执行发现 | dry-run, yes/-y, target, ai, allow-empty, list, json, no-color | AMBERCAST_CONFIG > discovery |
| view | 无 | port, host, allow-headless, config, no-color | --port > viewer.port > 4600 |

除 `--list` 模式外，每个位置参数都必须是 `testDir` 内的字面路径，具有非空的名称部分，且后缀精确为 `.test.md`。不符合条件的路径会产生 `PROMPT_PATH_INVALID`，而不是被静默忽略或导致执行崩溃。

`--` 标志用于结束选项解析，其后出现的所有参数均按字面路径处理。

`--json` 与 `--no-color` 由各个命令独立解析，而非通过全局标志抽象层统一处理。

Target（目标）的解析优先级依次为：显式指定的 target、配置中的默认 target、配置中仅存在唯一定义的 target；若均不满足，则 target 选择失败。

## 默认发现规则 {#discovery-default}

当未传入字面文件路径时，所有已实现的命令均会将文件选择委托给所配置的发现机制；默认包含模式为 `**/*.test.md`，默认排除项包括 `.runs` 目录、Plan 与 Grounding 伴生文件。

发现机制对 POSIX 相对路径进行求值：首先要求满足包含匹配，若命中忽略匹配则会将该路径排除。

相关链接：[配置](/ambercast/zh-cn/reference/configuration/#file-selection), [发现模式](/ambercast/zh-cn/reference/discovery-patterns/#selection), [ambercast init](/ambercast/zh-cn/reference/cli/init/#flags), [ambercast generate](/ambercast/zh-cn/reference/cli/generate/#flags), [ambercast run](/ambercast/zh-cn/reference/cli/run/#flags), [ambercast check](/ambercast/zh-cn/reference/cli/check/#flags), [ambercast heal](/ambercast/zh-cn/reference/cli/heal/#flags)。
