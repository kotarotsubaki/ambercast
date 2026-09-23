---
title: official skill
description: 说明 ambercast 内置的面向编码智能体的 official skill，及其在智能体接口设计中的角色。
---

本文档向您说明 ambercast 内置的 official skill，以及该功能在智能体接口设计中的角色。

## 这是什么 {#what-it-is}

ambercast 在 `skills/ambercast/SKILL.md` 中内置了一个名为 `ambercast` 的 [Agent Skills](https://agentskills.io) 技能。它教会编码智能体编写 `<name>.test.md` 提示词、通过 CLI 运行 `generate` / `run` / `check` / `heal` 循环、读取 `--json` 报告并处理退出码，以及选择下一步安全的操作。

安装方式（Claude Code、Codex CLI、支持 `gh skill` 的智能体、skills.sh，或从已安装的包手动复制）请参见 [README](https://github.com/kotarotsubaki/ambercast#official-skill)。为处理指定测试的智能体提供轻量、以审查为先边界的完整可复制运行提示词，请参见[设置提示词](/ambercast/zh-cn/agents/setup-prompt/)。

## 预期角色 {#intended-role}

智能体接口设计将编码智能体视为与面向人类用户的 prompt 和 viewer 界面并列的一等用户。

相关链接：
- [在 AI Agent 中使用 ambercast](/ambercast/zh-cn/agents/overview/)
- [设置提示词](/ambercast/zh-cn/agents/setup-prompt/)
- [MCP 服务器](/ambercast/zh-cn/agents/mcp-server/)
- [状态与路线图](/ambercast/zh-cn/explanation/status-and-roadmap/)
