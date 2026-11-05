---
title: official skill
description: ambercast 随附一个名为 `ambercast` 的 Agent Skills skill，教编码 Agent 掌握“写提示词、运行、读报告”的循环，本页说明它的覆盖范围，以及它与设置提示词和 MCP 服务器的关系。
---

本页帮助 Agent 判断这个 skill 教什么，以及它与设置提示词、MCP 服务器有何不同。

## 它是什么 {#what-it-is}

ambercast 在 `skills/ambercast/SKILL.md` 随附一个 [Agent Skills](https://agentskills.io) skill，名为 `ambercast`。它教编码 Agent 编写 `<name>.test.md` 提示词，通过 CLI 驱动 `generate`、`run`、`check` 和 `heal`，读取 `--json` 报告与退出码，并选择下一步安全动作。

安装方式有 Claude Code、Codex CLI、兼容 `gh skill` 的 Agent、skills.sh，以及从已安装的包中手动复制，见 [README](https://github.com/kotarotsubaki/ambercast#official-skill)。

## 预期角色 {#intended-role}

这个 skill 教循环本身。[设置提示词](/ambercast/zh-cn/agents/setup-prompt/)为一个被要求的测试设定先审阅的边界。[MCP 服务器](/ambercast/zh-cn/agents/mcp-server/)则是为调用工具而不是使用 shell 的客户端准备的连接。

ambercast 把编码 Agent 视为一等用户，与面向人的提示词和查看器并列。

相关链接：[在 AI Agent 中使用 ambercast](/ambercast/zh-cn/agents/overview/)、[设置提示词](/ambercast/zh-cn/agents/setup-prompt/)、[MCP 服务器](/ambercast/zh-cn/agents/mcp-server/)、[状态与路线图](/ambercast/zh-cn/explanation/status-and-roadmap/)
