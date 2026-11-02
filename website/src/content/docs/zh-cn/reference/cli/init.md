---
title: ambercast init
description: 创建配置文件、示例 prompt 和仓库指引的 ambercast init 的用法、标志、写入文件、确认和退出码。
---

`ambercast init` 创建在项目中开始使用 ambercast 所需的最少文件。它先规划全部变更，再执行任何写入，并且可以把当前目录之外的目录作为目标。

## 用法 {#usage}

```text
ambercast init [--dir <path>] [--yes|-y] [--force] [--no-color] [--help]
```

## 标志 {#flags}

`init` 不接受位置参数。

| 标志 | 取值 | 作用 | 默认值 |
| --- | --- | --- | --- |
| --dir | path | 要生成脚手架的项目根目录 | cwd |
| --yes, -y | boolean | 跳过确认提示 | false |
| --force | boolean | 替换已有的 ambercast.config.json | false |
| --no-color | boolean | 禁用 ANSI 颜色 | false |

## 写入的文件 {#what-it-writes}

该命令规划四个产物，路径都相对于项目根目录：

| 产物 | 不存在时 | 已存在时 |
| --- | --- | --- |
| `ambercast.config.json` | 创建 | 与脚手架完全一致则跳过；否则拒绝，除非 `--force` 替换它 |
| `tests/ambercast/find-page.test.md` | 创建 | 不检查也不替换其内容，直接跳过 |
| `.gitignore` | 连同下面的两行单元一起创建 | 已包含 `tests/ambercast/.runs/` 则跳过；否则在末尾追加这个单元 |
| `AGENTS.md` | 创建 | ambercast 标记块一致则跳过；存在一对有效标记且内容不同则替换；没有标记则追加；标记格式损坏则拒绝 |

`.gitignore` 的单元由注释 `# ambercast run evidence` 和随后的 `tests/ambercast/.runs/` 一行组成。

## 确认与非交互使用 {#confirmation}

init 总是把完整的变更计划打印到 stderr。在交互式终端中，它随后询问 `Write these files? [y/N] `，`--yes` 会跳过这个提示。

在 CI 或其他非 TTY 环境中，除非传入 `--yes`，否则 init 会拒绝这次调用。编码代理运行该命令时，`--yes` 只跳过 CLI 的提示，不能代替人类对四个文件变更的批准。参见[操作契约](/ambercast/zh-cn/agents/operating-contract/#command-contract)。

## 退出码 {#exit-codes}

- `0`：脚手架生成成功、所有产物都被跳过，或你拒绝了确认。
- `2`：预检阶段被拒绝，例如参数无效、未带 `--yes` 的非交互使用、配置冲突或 `AGENTS.md` 标记损坏。
- `3`：I/O 失败、被中断，或在应用变更计划时失败。

通用的进程状态说明见[退出码表](/ambercast/zh-cn/reference/exit-codes/#exit-code-table)。

## 重复运行 {#re-running}

成功之后再次运行同一命令不会改变结果。四个产物都报告为 `skipped`，ambercast 打印 `Nothing to do.`，它们的字节保持不变。

## 另请参阅 {#see-also}

- [CLI 概览](/ambercast/zh-cn/reference/cli/overview/#command-surface)
- [5 分钟完成您的首个测试](/ambercast/zh-cn/tutorials/quick-start/)
- [配置](/ambercast/zh-cn/reference/configuration/#file-selection)
- [操作契约](/ambercast/zh-cn/agents/operating-contract/#command-contract)
