---
title: Official skill
description: The official Agent Skills skill ambercast ships for AI coding agents, and its role within the agent-facing interface.
---

This page describes the official skill ambercast ships and its role within the ambercast agent-facing interface.

## What it is {#what-it-is}

ambercast ships an [Agent Skills](https://agentskills.io) skill at `skills/ambercast/SKILL.md`, named `ambercast`. It teaches a coding agent to author `<name>.test.md` prompts, drive the `generate` / `run` / `check` / `heal` loop through the CLI, read the `--json` report and process the exit code, and choose the next safe action.

For the install methods (Claude Code, Codex CLI, `gh skill`-compatible agents, skills.sh, or a manual copy from the installed package) see the [README](https://github.com/kotarotsubaki/ambercast#official-skill). For the complete copy-pasteable operating prompt that establishes a thin, review-first boundary for an agent working on a requested test, see [Setup prompt](/ambercast/agents/setup-prompt/).

## Intended role {#intended-role}

The agent-interface design treats coding agents as first-class users alongside the human-facing prompt and viewer surfaces.

Links: [Using ambercast from an AI agent](/ambercast/agents/overview/), [Setup prompt](/ambercast/agents/setup-prompt/), [MCP server](/ambercast/agents/mcp-server/), [Status and roadmap](/ambercast/explanation/status-and-roadmap/)
