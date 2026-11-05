---
title: Official skill
description: ambercast ships an Agent Skills skill named `ambercast` that teaches a coding agent the prompt, run, and report loop, and this page says what it covers and where it sits next to the setup prompt and the MCP server.
---

The skill teaches an agent the ambercast loop. This page explains how it differs from the setup prompt and the MCP server.

## What it is {#what-it-is}

ambercast ships an [Agent Skills](https://agentskills.io) skill at `skills/ambercast/SKILL.md`, named `ambercast`. It teaches a coding agent to write `<name>.test.md` prompts, drive `generate`, `run`, `check`, and `heal` through the CLI, read the `--json` report and the exit code, and choose the next safe action.

The [README](https://github.com/kotarotsubaki/ambercast#official-skill) covers the install methods: Claude Code, Codex CLI, `gh skill`-compatible agents, skills.sh, or a manual copy from the installed package.

## Intended role {#intended-role}

The skill teaches the loop. The [setup prompt](/ambercast/agents/setup-prompt/) sets the review-first boundary for one requested test. The [MCP server](/ambercast/agents/mcp-server/) is the connection for clients that call tools instead of a shell.

ambercast treats coding agents as first-class users next to the prompt and viewer surfaces for people.

Related: [Using ambercast from an AI agent](/ambercast/agents/overview/), [Setup prompt](/ambercast/agents/setup-prompt/), [MCP server](/ambercast/agents/mcp-server/), [Status and roadmap](/ambercast/explanation/status-and-roadmap/)
