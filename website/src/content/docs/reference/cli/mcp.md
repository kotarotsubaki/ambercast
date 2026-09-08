---
title: ambercast mcp
description: Server launch and transport discipline for the planned ambercast Model Context Protocol interface.
status: planned
sidebar:
  badge:
    text: Planned
    variant: caution
---

:::caution
`ambercast mcp` is not implemented in 0.3.1. The command and interface described here represent planned v2 behavior defined by the MCP design.
:::

The `ambercast mcp` command defines server launch and transport discipline for running ambercast as a Model Context Protocol (MCP) server.

## Status {#status}

`ambercast mcp` is not implemented in 0.3.1; the parser accepts only `generate`, `run`, `check`, and `heal`, and rejects any other command. Its planned v2 server interface is defined by the MCP design.

Links: [CLI overview](/ambercast/reference/cli/overview/#command-surface), [MCP server](/ambercast/agents/mcp-server/).

## Planned interface {#planned-interface}

| Aspect | Planned contract |
| --- | --- |
| Invocation | `ambercast mcp` starts the v2 MCP server from the main package. |
| Transport | Use `stdio`; the server is portless. |
| `stdout` | Write only JSON-RPC; CI must verify this invariant. |
| `stderr` | Write progress and logs here, never through the JSON-RPC stream. |
| Tool boundary | Do not expose `init` or `view` as MCP tools. |
| Server instructions | Open by stating that the server is for keystroke E2E execution and repair. |
| Discovery text budget | Put important description/instruction content first because clients may truncate each at 2 KB. |

The design names no CLI flags or input-options schema for `ambercast mcp`.

## Undecided items {#undecided-items}

| State | Item |
| --- | --- |
| Explicitly undecided | None; package command, stdio transport, and portless delivery are recorded as fixed. |
| Unspecified | [UNVERIFIED] Exact server flags, startup errors, lifecycle, and client configuration are not defined by these reference sources. |

Links: [MCP Tools](/ambercast/reference/mcp-tools/#planned-tool-contract), [MCP Tools](/ambercast/reference/mcp-tools/#tool-table).
