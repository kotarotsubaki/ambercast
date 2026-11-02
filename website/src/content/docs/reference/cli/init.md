---
title: ambercast init
description: Synopsis, flags, written files, confirmation, and exit codes of ambercast init, which scaffolds a configuration file, a sample prompt, and repository guidance.
---

`ambercast init` creates the minimum files you need to start using ambercast in a project. It plans all changes before it writes anything, and it can target a directory other than the current one.

## Usage {#usage}

```text
ambercast init [--dir <path>] [--yes|-y] [--force] [--no-color] [--help]
```

## Flags {#flags}

`init` takes no positional argument.

| flag | value | effect | default |
| --- | --- | --- | --- |
| --dir | path | project root to scaffold into | cwd |
| --yes, -y | boolean | skip the confirmation prompt | false |
| --force | boolean | replace an existing ambercast.config.json | false |
| --no-color | boolean | disable ANSI | false |

## What it writes {#what-it-writes}

The command plans four artifacts, each relative to the project root:

| artifact | when absent | when already present |
| --- | --- | --- |
| `ambercast.config.json` | created | skipped when it exactly matches the scaffold; otherwise rejected unless `--force` replaces it |
| `tests/ambercast/find-page.test.md` | created | skipped without inspecting or replacing its contents |
| `.gitignore` | created with the two-line unit below | skipped when it already contains `tests/ambercast/.runs/`; otherwise the unit is appended |
| `AGENTS.md` | created | skipped when its ambercast marker block matches; replaced when one valid marker pair differs, appended when no markers exist, and rejected for malformed markers |

The `.gitignore` unit is the comment `# ambercast run evidence` followed by the line `tests/ambercast/.runs/`.

## Confirmation and non-interactive use {#confirmation}

init always prints the complete change plan to stderr. In an interactive terminal it then asks `Write these files? [y/N] `, and `--yes` skips that prompt.

In CI or another non-TTY environment, init rejects the invocation unless you pass `--yes`. When a coding agent runs the command, `--yes` skips only the CLI prompt. It never replaces the human approval for the four file changes. See the [operating contract](/ambercast/agents/operating-contract/#command-contract).

## Exit codes {#exit-codes}

- `0`: scaffolding succeeded, every artifact was skipped, or you declined the confirmation.
- `2`: a preflight rejection, such as invalid arguments, non-interactive use without `--yes`, a configuration conflict, or malformed `AGENTS.md` markers.
- `3`: an I/O failure, an interruption, or a failure while applying the change plan.

The shared process-status reference is the [exit code table](/ambercast/reference/exit-codes/#exit-code-table).

## Re-running {#re-running}

Running the same command again after a success is idempotent. All four artifacts are reported as `skipped`, ambercast prints `Nothing to do.`, and their bytes stay unchanged.

## See also {#see-also}

- [CLI overview](/ambercast/reference/cli/overview/#command-surface)
- [Your first test in 5 minutes](/ambercast/tutorials/quick-start/)
- [Configuration](/ambercast/reference/configuration/#file-selection)
- [Operating contract](/ambercast/agents/operating-contract/#command-contract)
