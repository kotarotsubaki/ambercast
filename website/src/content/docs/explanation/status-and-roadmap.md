---
title: Status and roadmap
description: What the current release implements, what is planned, and how versions move before 1.0.
---

The CLI has seven subcommands today: `init`, `generate`, `run`, `check`, `heal`, `view`, and `mcp`. `review` and baseline/restore are planned. Before 1.0, schema and producer changes can require you to regenerate plans.

## Implemented in the current release {#implemented}

The CLI parser exposes `init`, `generate`, `run`, `check`, `heal`, `view`, and `mcp`. `ambercast mcp` serves six tools over stdio.

Chromium is the only supported browser.

Before 1.0, a minor release can include breaking changes. A schema or producer change forces you to regenerate existing plans. In 0.2.0, for example, a producer-contract change made 0.1.0 plans stale. The [regeneration boundary](/ambercast/reference/compatibility/#regeneration-boundary) and the [0.2.0 changelog entry](/ambercast/reference/changelog/#release-020) show where regeneration is required.

Related: [CLI overview](/ambercast/reference/cli/overview/), [Compatibility](/ambercast/reference/compatibility/), [Changelog](/ambercast/reference/changelog/)

## Planned after the current boundary {#planned-after-current-boundary}

`review` and baseline/restore are planned. Firefox and WebKit support is planned, and so is a cloud version. MCP tools are already available.

Related: [ambercast review](/ambercast/reference/cli/review/), [MCP server](/ambercast/agents/mcp-server/)

## Version policy {#version-policy}

The [compatibility table](/ambercast/reference/compatibility/#compatibility-table) lists the published package versions. The product stays on 0.x until MVP.

Related: [Changelog](/ambercast/reference/changelog/), [Philosophy](/ambercast/philosophy/)
