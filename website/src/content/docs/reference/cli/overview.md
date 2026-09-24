---
title: CLI overview
description: Reference for parser-wide CLI behavior, command-flag dispatch, and discovery defaults in ambercast.
---

The `ambercast` command-line interface provides seven commands for scaffolding a project, generating, running, checking, and repairing deterministic test plans, browsing run results, and serving the MCP stdio server, using per-command option parsing and configured discovery defaults.

## Command surface {#command-surface}

The implemented commands are `init`, `generate`, `run`, `check`, `heal`, `view`, and `mcp`. Top-level `--help` and `--version` flags short-circuit before command dispatch; any malformed arguments exit with status code 2 without emitting a report.

Use `ambercast run <file>`, `ambercast check <file>`, or `ambercast heal <file>` to operate on plans whose steps name their execution Targets.

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
  --strict  --force  --dry-run  --target <name>  --ai <claude|codex>
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
| init | none | dir, yes/-y, force, no-color | --dir argument (cwd when omitted) |
| generate | literal paths; no paths = discovery | strict, force, dry-run, target, ai, allow-empty, list, json, config, no-color | --config > AMBERCAST_CONFIG > discovery |
| run | literal paths; no paths = discovery | grep, headed, resolve, update-cache, stale, ai, allow-empty, list, json, no-color | AMBERCAST_CONFIG > discovery |
| check | literal paths; no paths = discovery | allow-empty, list, json, config, no-color | --config > AMBERCAST_CONFIG > discovery |
| heal | literal paths; no paths = discovery | dry-run, yes/-y, ai, allow-empty, list, json, no-color | AMBERCAST_CONFIG > discovery |
| view | none | port, host, allow-headless, config, no-color | --config > AMBERCAST_CONFIG > discovery |
| mcp | none | dir, sync-wait-ms | --dir argument selects session root (cwd when omitted) |

For `generate`, `run`, `check`, and `heal`, except in `--list` mode, each positional argument must be a literal path inside `testDir` with a non-empty name component and the exact `.test.md` suffix. An ineligible path produces `PROMPT_PATH_INVALID` instead of being silently ignored or allowed to crash execution.

- Passing `--` terminates option parsing, leaving all subsequent arguments to be interpreted as literal paths.
- The `--json` and `--no-color` flags are handled individually by each command rather than through a shared global-flag abstraction.
- `generate --target` restricts the Target definitions available to the generator. Run, check, and heal use the Target names recorded in each Plan.

## Discovery default {#discovery-default}

When you pass no literal files to `generate`, `run`, `check`, or `heal`, that command delegates test file selection to configured discovery. `init`, `view`, and `mcp` take no prompt-file arguments.

- The default inclusion pattern is `**/*.test.md`.
- Default exclusions include `.runs`, Plan, and Grounding companions.
- Discovery evaluates POSIX-relative paths by requiring an inclusion match first, after which an ignore match excludes the path.

Related documentation: [Configuration](/ambercast/reference/configuration/#file-selection), [Discovery patterns](/ambercast/reference/discovery-patterns/#selection), [ambercast init](/ambercast/reference/cli/init/#flags), [ambercast generate](/ambercast/reference/cli/generate/#flags), [ambercast run](/ambercast/reference/cli/run/#flags), [ambercast check](/ambercast/reference/cli/check/#flags), [ambercast heal](/ambercast/reference/cli/heal/#flags), [ambercast view](/ambercast/reference/cli/view/#flags), and [ambercast mcp](/ambercast/reference/cli/mcp/#usage).
