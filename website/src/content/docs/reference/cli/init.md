---
title: ambercast init
description: Planned scaffolding surface and unresolved design choices for the ambercast init command.
status: planned
sidebar:
  badge:
    text: Planned
    variant: caution
---

:::caution
`ambercast init` is not implemented in 0.3.1. The interface described here reflects planned CLI behavior.
:::

The `ambercast init` command defines the planned scaffolding interface and its unresolved design choices.

## Status {#status}

`ambercast init` is not implemented in 0.3.1; the parser accepts only `generate`, `run`, `check`, and `heal`, and rejects any other command. Its planned scaffolding interface is defined by the CLI design.

Links: [CLI overview](/ambercast/reference/cli/overview/#command-surface), [Your first test in 5 minutes](/ambercast/tutorials/quick-start/).

## Planned interface {#planned-interface}

| Syntax / behavior | Planned contract |
| --- | --- |
| `init [--dir <path>] [--yes]` | Prepare `ambercast.config.json` and a sample `test.md`. |
| `--yes`, `-y` | Complete scaffolding non-interactively. |
| Existing config | Warn and stop; the prose says `--force` overwrites it. |
| CI workflow | Do not generate one. |
| Design-wide flags | `--config <path>`, `--no-color`, `--version`, and `--help` are declared common to all planned commands. |

The planned command exists to prepare configuration and a sample test, not to generate a Plan or run tests.

The design's shared non-interactive test is `!process.stdout.isTTY || CI`; `CI` is active when defined and neither empty nor `"false"`.

## Undecided items {#undecided-items}

| State | Item | Why it remains open |
| --- | --- | --- |
| Gap | Exact `--force` surface | The command synopsis and command-flag matrix omit `--force`, while the same command description assigns overwrite behavior to it. |
| Unspecified | Non-interactive refusal | The design calls `init` a consumer of the shared non-interactive rule but does not state whether missing `--yes` is rejected or what result/exit it produces. |
| Explicitly undecided | None for `init` | The design labels only `baseline` and `restore` as `未決`; it does not label an `init` item that way. |

Links: [Configuration](/ambercast/reference/configuration/#file-selection), [Configure targets](/ambercast/how-to/configure-targets/).
