---
title: ambercast init
description: Command-line reference for ambercast init, which scaffolds a configuration file, sample prompt, and repository guidance.
---

## Usage {#usage}

```bash
ambercast init [--dir <path>] [--yes|-y] [--force] [--no-color] [--help]
```

`ambercast init` scaffolds the minimum files needed to start using ambercast in a project. It plans the changes before writing anything and can target a directory other than the current working directory.

## Flags {#flags}

| Flag | Value | Effect | Default |
| --- | --- | --- | --- |
| `--dir` | `<path>` | project root to scaffold into | cwd |
| `--yes, -y` | boolean | skip the confirmation prompt | false |
| `--force` | boolean | replace an existing ambercast.config.json | false |
| `--no-color` | boolean | disable ANSI | false |

## What it writes {#what-it-writes}

The command plans four project-root-relative artifacts:

| Artifact | When absent | When already present |
| --- | --- | --- |
| `ambercast.config.json` | created | skipped when it exactly matches the scaffold; otherwise rejected unless `--force` replaces it |
| `tests/ambercast/find-page.test.md` | created | skipped without inspecting or replacing its contents |
| `.gitignore` | created | skipped when it already contains `tests/ambercast/.runs/`; otherwise that line is appended |
| `AGENTS.md` | created | skipped when its ambercast marker block matches; replaced when one valid marker pair differs, appended when no markers exist, and rejected for malformed markers |

## Confirmation and non-interactive use {#confirmation}

The complete plan is always printed to stderr. In an interactive terminal, ambercast then asks `Write these files? [y/N] `; `--yes` skips that prompt.

In CI or another non-TTY environment, init rejects the invocation unless `--yes` is supplied. When a coding agent runs the command, `--yes` skips only the CLI prompt: it never substitutes for the human approval required for the four file changes. See the [operating contract](/ambercast/agents/operating-contract/#command-contract).

## Exit codes {#exit-codes}

- `0`: successful scaffolding, an all-skipped no-op, or a declined confirmation.
- `2`: a preflight rejection, including invalid arguments, non-interactive use without `--yes`, a configuration conflict, or malformed `AGENTS.md` markers.
- `3`: an I/O failure, interruption, or failure while applying the plan.

For the shared process-status reference, see [Exit codes](/ambercast/reference/exit-codes/#exit-code-table).

## Re-running {#re-running}

After a successful run, repeating the same command is idempotent: all four artifacts are reported as `skipped`, ambercast prints `Nothing to do.`, and their bytes remain unchanged.

## Related {#related}

- [CLI overview](/ambercast/reference/cli/overview/#command-surface)
- [Your first test in 5 minutes](/ambercast/tutorials/quick-start/)
- [Configuration](/ambercast/reference/configuration/#file-selection)
- [Operating contract](/ambercast/agents/operating-contract/#command-contract)
