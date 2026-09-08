---
title: 5 分钟完成您的首个测试
description: 引导您生成并运行首个 ambercast 测试。
---

本教程将引导您在 5 分钟内生成并运行您的第一个 ambercast 测试。您无需预先创建配置文件，使用默认配置即可直接针对本地运行的 Web 应用完成首个测试的生成与回放执行。

## 前提条件 {#prerequisites}

在开始之前，请确认您的环境满足以下条件：

- **默认目标与目录**：ambercast 的默认测试目录 `testDir` 为 `tests/ambercast`；默认测试目标为 `web-user`，对应地址为 `http://localhost:3000`，并使用 Chromium。
- **配置文件规则**：如果项目中存在配置文件，则该文件必须包含 `$schema`；无配置文件时的默认配置是在 `RawConfig` 之外进行处理的，因此本教程完全无需配置文件。
- **运行与环境依赖**：本快速入门包含了 `run` 阶段，该阶段会配置浏览器驱动。整个演练的前提条件包括 Node.js 22.14 或更高版本、Chromium 二进制程序，以及已安装并完成身份验证的 Claude Code 或 Codex CLI。
- **阶段依赖差异**：首次执行 `generate` 命令时，直接需要的是 Node.js 以及已安装且完成身份验证的提供商；`generate` 本身不会配置浏览器驱动，因此 Chromium 是在随后的 `run` 阶段中才需要的，生成阶段并不要求 Chromium。
- **错误代码**：若在生成测试时没有可用的提供商，环境错误代码为 `AI_EXECUTOR_UNAVAILABLE`。

## 操作步骤 {#steps}

1. 不要创建配置文件。精确创建文件 `tests/ambercast/find-page.test.md`：

```markdown
# Find a page

When I open the application, navigate to the search page, search for "ambercast", and see "Search results".
```

文件末尾的 `.test.md` 后缀符合伴生文件路径解析的条件。

2. 请由人工或操作员启动并确认应用程序运行在 `http://localhost:3000`，然后运行：



使用设置提示词的 agent 会假定服务已在运行，未经请求不会自行启动服务。成功生成后命令退出码为 `0`，结果状态为 `generated`。其报告字段为 `planFile`，同时生成阶段会在指定的 prompt 文件旁写入两个派生的伴生文件（参见 [设置提示词](/ambercast/zh-cn/agents/setup-prompt/#copy-paste-prompt)）。

3. 运行以下命令执行测试：



回放通过时退出码为 `0`；`run` 会在配置的 runs 目录下为每次调用创建一个 `report.json`。

4. 首先运行 `git status --short`。使用 `git diff -- <path>` 审查每一个被修改的已跟踪文件；对于其中显示的每一个未跟踪的 prompt、plan 或 grounding 路径，检查其完整内容或运行 `git diff --no-index /dev/null <path>`。随后由人工提交审查后的这三个文件。

Agent 会展示完整的变更集，并且只有在对话中收到明确请求后才会执行提交；任何 CLI 标志或 `--yes` 都不能作为该授权（参见 [设置提示词](/ambercast/zh-cn/agents/setup-prompt/#copy-paste-prompt)）。

> [!NOTE]
> **范围说明**：不带参数的形式 `npx ambercast generate` 与 `npx ambercast run` 会发现所有符合配置的测试目录、匹配规则及忽略规则的测试。请仅在经过单独批准的“执行所有发现的测试”操作中使用这两种无参数形式；本教程中的命令是有意显式指定单个 `.test.md` 文件的。

## 完成状态 {#completion-state}

- 解析器将 prompt 映射至 `tests/ambercast/find-page.ambercast.plan.json` 与 `tests/ambercast/find-page.ambercast.grounding.json`。
- `npx ambercast run` 退出码为 `0`，并报告该用例状态为 `passed`。

相关链接：[配置](/ambercast/zh-cn/reference/configuration/), [文件布局](/ambercast/zh-cn/reference/file-layout/), [ambercast generate](/ambercast/zh-cn/reference/cli/generate/), [ambercast run](/ambercast/zh-cn/reference/cli/run/), [编写高效的 Prompt](/ambercast/zh-cn/how-to/write-effective-prompts/)。
