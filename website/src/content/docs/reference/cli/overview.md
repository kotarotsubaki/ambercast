---
title: CLI overview
description: The seven ambercast commands, the options each command accepts, and the file discovery defaults.
---

Each `ambercast` command parses its own arguments. When you pass no files, configured discovery selects the tests.

## Command surface {#command-surface}

The implemented commands are `init`, `generate`, `run`, `check`, `heal`, `view`, and `mcp`.

Use `ambercast run <file>`, `ambercast check <file>`, or `ambercast heal <file>` to work on plans whose steps name their execution targets.

Top-level `--help` and `--version` are handled before command dispatch. A `--help` after a recognized command and before any `--` is handled by that command right away. Malformed arguments exit with status `2`, write the usage to stderr, and produce no report.

The usage block below is the CLI's own help output, including the `AI configuration` and `Heal configuration` lines.

```text
Usage: ambercast <command> [options]

Commands:
  init                 Scaffold config and a sample prompt
  generate [files...]  Generate deterministic plans
  run [files...]       Replay deterministic plans
  check [files...]     Check plan freshness
  heal [files...]      Repair deterministic plans
  view                 Browse run results in a browser
  mcp                  Serve the MCP stdio server

Init options:
  --dir <path>  --yes, -y  --force  --no-color

Generate options:
  --force  --dry-run  --target <name>  --ai <claude|codex>
  --allow-empty  --list  --json  --config <path>  --no-color

Run options:
  --grep <pattern>  --headed  --resolve  --update-cache  --allow-empty  --list
  --stale <fail>  --ai <claude|codex>  --json  --no-color

Check options:
  --allow-empty  --list  --json  --config <path>  --no-color

Heal options:
  --dry-run  --yes, -y  --ai <claude|codex>  --allow-empty  --list  --json  --no-color

View options:
  --port <n>  --host <addr>  --allow-headless  --config <path>  --no-color

Mcp options:
  --dir <path>  --sync-wait-ms <n>

AI configuration:
  ai.timeoutMs: Deadline in milliseconds for one provider dispatch. Applies to every generate, run, and heal dispatch. The heal case deadline is an admission boundary only, so an admitted dispatch may still run up to this value. Default 600000.
  ai.maxGenerateAttempts: Maximum provider attempts per prompt during generate when the local validators reject a response. Between 1 and 5, default 2. Never applies to heal repairs.

Heal configuration:
  heal.maxStepRepairs: Hard limit on real provider dispatches started during incremental repair. Charged at dispatch time regardless of outcome. Includes element confirmation dispatches. Excludes the cache-only baseline and Stage 3.
  heal.caseTimeoutMs: see docs/configuration.md for its admission-boundary contract.
```

## Command-flag matrix {#command-flag-matrix}

| command | positional | accepted options | configuration path |
| --- | --- | --- | --- |
| init | none | dir, yes/-y, force, no-color | `--dir` argument (cwd when omitted) |
| generate | literal paths; no paths = discovery | force, dry-run, target, ai, allow-empty, list, json, config, no-color | `--config` > `AMBERCAST_CONFIG` > discovery |
| run | literal paths; no paths = discovery | grep, headed, resolve, update-cache, stale, ai, allow-empty, list, json, no-color | `AMBERCAST_CONFIG` > discovery |
| check | literal paths; no paths = discovery | allow-empty, list, json, config, no-color | `--config` > `AMBERCAST_CONFIG` > discovery |
| heal | literal paths; no paths = discovery | dry-run, yes/-y, ai, allow-empty, list, json, no-color | `AMBERCAST_CONFIG` > discovery |
| view | none | port, host, allow-headless, config, no-color | `--config` > `AMBERCAST_CONFIG` > discovery |
| mcp | none | dir, sync-wait-ms | `--dir` argument selects the session root (cwd when omitted) |

For `generate`, `run`, `check`, and `heal`, every positional argument outside `--list` must be a literal path inside `testDir`. The name in front of the `.test.md` suffix must be non-empty, and the suffix must be exactly `.test.md`. Any other path fails with `PROMPT_PATH_INVALID`.

- `--` ends option parsing, so every later argument is a literal path.
- `--json` and `--no-color` are handled by each command, not by a shared global flag.
- `generate --target` restricts the target definitions available to the generator. `run`, `check`, and `heal` use the target names recorded in each plan.

## Discovery default {#discovery-default}

When you pass no literal files to `generate`, `run`, `check`, or `heal`, configured discovery selects the test files. `init`, `view`, and `mcp` take no prompt-file arguments.

- The default `testMatch` is `**/*.test.md`.
- The default `testIgnore` is `**/.runs/**` plus the plan and grounding companions.
- Discovery evaluates POSIX-relative paths. A path must match an inclusion pattern first, and an ignore match then excludes it.

The details are on these pages.

- [Configuration](/ambercast/reference/configuration/#file-selection)
- [Discovery patterns](/ambercast/reference/discovery-patterns/#selection)
- [ambercast init](/ambercast/reference/cli/init/#flags)
- [ambercast generate](/ambercast/reference/cli/generate/#flags)
- [ambercast run](/ambercast/reference/cli/run/#flags)
- [ambercast check](/ambercast/reference/cli/check/#flags)
- [ambercast heal](/ambercast/reference/cli/heal/#flags)
- [ambercast view](/ambercast/reference/cli/view/#flags)
- [ambercast mcp](/ambercast/reference/cli/mcp/#usage)
