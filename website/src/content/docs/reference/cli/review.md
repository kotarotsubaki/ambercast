---
title: ambercast review
description: The planned interface and open items of ambercast review, a not-yet-implemented command that asks an independent AI whether a plan meets its intent.
status: planned
sidebar:
  badge:
    text: Planned
    variant: caution
---

:::caution
`ambercast review` is not implemented in the current release. The interface and contracts described here represent planned v2 behavior rather than current CLI capabilities.
:::

This page records what `ambercast review` is planned to check, what it is planned to return, and which points are still open.

## Status {#status}

`ambercast review` is not implemented in the current release and is not an available CLI command. It is planned for v2. The [CLI overview](/ambercast/reference/cli/overview/#command-surface) lists the available commands, and [Reports](/ambercast/reference/reports/#result-shapes) describes the result shapes that exist today.

## Planned interface {#planned-interface}

| syntax / behavior | planned contract |
| --- | --- |
| `review [files...] [--target <name>] [--json]` | Ask an AI, in a context separate from the generator, whether the plan meets the intent and verifies enough. |
| `--target` | Planned target resolution is the explicit target, then the configured default, then the sole own target key, then exit `2`. An invalid explicit name never falls back. |
| `--json` | Emit the common structured envelope on every exit after argument parsing. |
| review concern | A concern is the command's legitimate red result and maps to exit `1`. |

- The command is assigned to v2, and its name was fixed on 2026-08-01.
- Planned aggregate exits use the priority `2 > 3 > 4 > 1 > 5 > 0`.

## Undecided items {#undecided-items}

| state | item | why it remains open |
| --- | --- | --- |
| Gap | `--allow-empty` and `--list` | The planned design assigns both flags to `review`, but its synopsis omits them. |
| Unspecified | Review provider and detailed result contract | The design states only that an AI in a separate context judges intent and verification sufficiency. |
| Explicitly undecided | None for `review` | Only `baseline` and `restore` carry that label. |

For the tools available today, see [MCP tools](/ambercast/reference/mcp-tools/#tool-table). For the plan format that a review would read, see [Plan document](/ambercast/spec/plan-document/).
