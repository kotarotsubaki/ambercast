---
title: MCP server
description: Planned connection boundary and status for the ambercast Model Context Protocol (MCP) server.
status: planned
sidebar:
  badge:
    text: Planned
    variant: caution
---

:::caution
This page describes a planned feature that is not implemented in 0.3.1. The design details below represent intended behavior rather than current functionality.
:::

This page describes the planned Model Context Protocol (MCP) server for ambercast.

## Status {#status}

No MCP connection is available in 0.3.1. This page describes a planned feature that is not implemented in the 0.3.1 release.

## Planned connection boundary {#planned-connection-boundary}

The agent-interface design plans MCP as an `ambercast mcp` subcommand using stdio, with each instance scoped to its own current working directory.

The MCP design is the source for tool schemas, annotations, `isError`, and the default `dryRun` behavior.

Links:
- [MCP Tools](/ambercast/reference/mcp-tools/)
- [Reading structured output](/ambercast/agents/reading-structured-output/)
- [Status and roadmap](/ambercast/explanation/status-and-roadmap/)
