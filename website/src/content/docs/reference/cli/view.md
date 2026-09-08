---
title: ambercast view
description: Command reference for ambercast view, defining the planned local test results viewer, port selection, and non-interactive refusal.
status: planned
sidebar:
  badge:
    text: Planned
    variant: caution
---

:::caution
`ambercast view` is not implemented in 0.3.1. The design details documented on this page represent planned behavior.
:::

The `ambercast view` command defines the planned local results viewer, covering viewer invocation, port selection, and non-interactive refusal.

## Status {#status}

`ambercast view` is not implemented in 0.3.1; the CLI parser accepts only `generate`, `run`, `check`, and `heal`, and rejects any other command. Its planned role as a local results viewer is established in the viewer design.

Links: [CLI overview](/ambercast/reference/cli/overview/#command-surface), [Reports](/ambercast/reference/reports/#envelope).

## Planned interface {#planned-interface}

| Syntax / behavior | Planned contract |
| --- | --- |
| `view [--port <n>] [--host <addr>] [--allow-headless]` | Start the local results viewer. |
| Default port | Start from the configured/default port, increment until a free port is found, and print the actual URL. |
| `--port` / configuration | Allow a fixed port, supporting CI or stable bookmarks. |
| Non-interactive default | Refuse in CI or a non-interactive terminal with exit 2. |
| `--allow-headless` | Explicitly lift the non-interactive refusal. |
| Design-wide flags | `--config <path>`, `--no-color`, `--version`, and `--help` are declared common to all planned commands; the matrix does not assign `--json` to `view`. |

The viewer is planned as a local Storybook-like server for test results and screenshots. Stored JSON and screenshots determine the rendered structure; AI is limited to natural-language content such as test summaries and failure explanations.

Browser startup failure is classified as environment exit 3 by the planned common exit-code contract.

`view` is the only planned Ambercast feature that consumes a network port; the planned MCP server is portless stdio.

## Undecided items {#undecided-items}

| State | Item |
| --- | --- |
| Unspecified | `--host` is named, but binding/address/public-exposure semantics are not defined. |
| Unspecified | The default port number, increment limit, server lifecycle, routes, and UI are not fixed by the viewer design. |
| Explicitly undecided | None for `view`; the design labels only `baseline` and `restore` as `未決`. |

Links: [Configuration](/ambercast/reference/configuration/#key-table), [Reports](/ambercast/reference/reports/#result-shapes), [ambercast mcp](/ambercast/reference/cli/mcp/#planned-interface).
