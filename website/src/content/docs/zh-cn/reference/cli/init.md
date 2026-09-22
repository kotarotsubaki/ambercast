---
title: ambercast init
description: ambercast init 的命令行参考：用于创建配置文件、示例提示词和仓库操作指引。
---

## 用法 {#usage}

```bash
ambercast init [--dir <path>] [--yes|-y] [--force] [--no-color] [--help]
```

`ambercast init` 会创建在项目中开始使用 ambercast 所需的最小文件集。它会先显示变更计划，再执行任何写入，并且可将当前工作目录之外的目录作为目标。

## 标志 {#flags}

| 标志 | 取值 | 效果 | 默认值 |
| --- | --- | --- | --- |
| `--dir` | `<path>` | 要创建脚手架的项目根目录 | cwd |
| `--yes, -y` | boolean | 跳过确认提示 | false |
| `--force` | boolean | 替换现有的 ambercast.config.json | false |
| `--no-color` | boolean | 禁用 ANSI | false |

## 写入内容 {#what-it-writes}

该命令会为以下四个相对于项目根目录的工件创建计划：

| 工件 | 不存在时 | 已存在时 |
| --- | --- | --- |
| `ambercast.config.json` | 创建 | 与脚手架完全一致时跳过；否则除非以 `--force` 替换，否则拒绝 |
| `tests/ambercast/find-page.test.md` | 创建 | 不检查或替换其内容，直接跳过 |
| `.gitignore` | 创建 | 已含有 `tests/ambercast/.runs/` 时跳过；否则追加该行 |
| `AGENTS.md` | 创建 | ambercast 标记块匹配时跳过；一个有效标记对但内容不同时替换；没有标记时追加；标记格式错误时拒绝 |

## 确认与非交互式使用 {#confirmation}

完整计划始终会输出到 stderr。在交互式终端中，ambercast 随后会询问 `Write these files? [y/N] `；`--yes` 可跳过此提示。

在 CI 或其他非 TTY 环境中，未提供 `--yes` 的 init 调用会被拒绝。由编码 Agent 执行时，`--yes` 仅跳过 CLI 提示，绝不替代这四项文件变更所需的人类批准。请参阅[操作契约](/ambercast/zh-cn/agents/operating-contract/#command-contract)。

## 退出码 {#exit-codes}

- `0`：脚手架创建成功、全部跳过的 no-op，或拒绝确认。
- `2`：预检拒绝，包括无效参数、没有 `--yes` 的非交互调用、配置冲突或格式错误的 `AGENTS.md` 标记。
- `3`：I/O 失败、中断，或应用计划时失败。

有关通用进程状态，请参阅[退出码](/ambercast/zh-cn/reference/exit-codes/#exit-code-table)。

## 再次运行 {#re-running}

成功后使用相同命令再次运行是幂等的：四个工件都会报告为 `skipped`，ambercast 输出 `Nothing to do.`，其字节内容不会改变。

## 相关链接 {#related}

- [CLI 概览](/ambercast/zh-cn/reference/cli/overview/#command-surface)
- [5 分钟完成您的首个测试](/ambercast/zh-cn/tutorials/quick-start/)
- [配置](/ambercast/zh-cn/reference/configuration/#file-selection)
- [操作契约](/ambercast/zh-cn/agents/operating-contract/#command-contract)
