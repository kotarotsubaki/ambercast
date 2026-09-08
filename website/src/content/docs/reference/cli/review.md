---
title: ambercast review
description: Define the planned independent-AI review outcome and known flags for ambercast review.
status: planned
sidebar:
  badge:
    text: Planned
    variant: caution
---

:::caution
`ambercast review` is not implemented in 0.3.1. The interface and contracts described here represent planned v2 behavior rather than current CLI capabilities.
:::

`ambercast review` defines the planned independent-AI review outcome and known flags.

## Status {#status}

`ambercast review` is not implemented in 0.3.1; the parser accepts only `generate`, `run`, `check`, and `heal`, and rejects any other command. Its planned v2 role is defined by the CLI design.

Links: [CLI overview](/ambercast/reference/cli/overview/#command-surface), [Reports](/ambercast/reference/reports/#result-shapes).

## Planned interface {#planned-interface}

| Syntax / Behavior | Planned Contract |
| --- | --- |
| `review [files...] [--target <name>] [--json]` | Ask an AI in a context separate from the generator whether the Plan meets intent and verifies enough. |
| `--target` | Planned target resolution is explicit target, configured default, sole own target key, then exit 2; an invalid explicit name never falls back. |
| `--json` | Emit the common structured envelope on every post-argv-parse exit. |
| Review concern | A concern is the command's legitimate red result and maps to exit 1. |

- The command is assigned to v2 and its name was formally fixed on 2026-08-01.
- Planned aggregate exits use `2 > 3 > 4 > 1 > 5 > 0`.

## Undecided items {#undecided-items}

| State | Item | Why It Remains Open |
| --- | --- | --- |
| Gap | `--allow-empty` and `--list` | The command synopsis omits them, while the command-flag matrix assigns both to review and defines their behavior. |
| Unspecified | Review provider and detailed result contract | The design states only that a separate-context AI judges intent and verification sufficiency. |
| Explicitly undecided | None for `review`; only `baseline` and `restore` carry that label. |

Links: [MCP Tools](/ambercast/reference/mcp-tools/#planned-tool-contract), [Plan document](/ambercast/spec/plan-document/).
