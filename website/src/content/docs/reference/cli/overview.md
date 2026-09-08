---
title: CLI overview
description: Reference for parser-wide CLI behavior, command-flag dispatch, and discovery defaults in ambercast.
---

The `ambercast` command-line interface provides four commands for generating, running, checking, and repairing deterministic test plans, using per-command option parsing and configured discovery defaults.

## Command surface {#command-surface}

The implemented commands are `generate`, `run`, `check`, and `heal`. Top-level `--help` and `--version` flags short-circuit before command dispatch; any malformed arguments exit with status code 2 without emitting a report.

```text
Usage: ambercast <command> [options]

Commands:
  generate [files...]  Generate deterministic plans
  run [files...]       Replay deterministic plans
  check [files...]     Check plan freshness
  heal [files...]      Repair deterministic plans

Generate options:
  --strict  --force  --dry-run  --target <name>  --ai <claude|codex>
  --allow-empty  --list  --json  --config <path>  --no-color

Run options:
  --grep <pattern>  --target <name>  --headed  --cache-only  --update-cache  --allow-empty  --list
  --stale <fail>  --json  --no-color

Check options:
  --target <name>  --allow-empty  --list  --json  --config <path>  --no-color

Heal options:
  --dry-run  --yes, -y  --target <name>  --ai <claude|codex>  --allow-empty  --list  --json  --no-color

Heal configuration:
  heal.maxStepRepairs: Hard limit on real provider dispatches started during incremental repair. Charged at dispatch time regardless of outcome. Includes element confirmation dispatches. Excludes the cache-only baseline and Stage 3.
  heal.caseTimeoutMs: see docs/configuration.md for its admission-boundary contract.
```

## Command-flag matrix {#command-flag-matrix}

| command | positional | accepted options | configuration path |
| --- | --- | --- | --- |
| generate | literal paths; no paths = discovery | strict, force, dry-run, target, ai, allow-empty, list, json, config, no-color | --config > AMBERCAST_CONFIG > discovery |
| run | literal paths; no paths = discovery | grep, target, headed, cache-only, update-cache, stale, ai, allow-empty, list, json, no-color | AMBERCAST_CONFIG > discovery |
| check | literal paths; no paths = discovery | target, allow-empty, list, json, config, no-color | --config > AMBERCAST_CONFIG > discovery |
| heal | literal paths; no paths = discovery | dry-run, yes/-y, target, ai, allow-empty, list, json, no-color | AMBERCAST_CONFIG > discovery |

A positional argument must be a literal `.test.md` path inside `testDir`. A path outside that domain is a usage error; it is not silently ignored or allowed to crash execution.

- Passing `--` terminates option parsing, leaving all subsequent arguments to be interpreted as literal paths.
- The `--json` and `--no-color` flags are handled individually by each command rather than through a shared global-flag abstraction.
- Target precedence follows a strict order: an explicit `--target` flag takes priority, followed by the configured default target, and finally resolving when exactly one configured target is present; otherwise, target selection fails.

## Discovery default {#discovery-default}

When you pass no literal files, every implemented command delegates test file selection to configured discovery.

- The default inclusion pattern is `**/*.test.md`.
- Default exclusions include `.runs`, Plan, and Grounding companions.
- Discovery evaluates POSIX-relative paths by requiring an inclusion match first, after which an ignore match excludes the path.

Related documentation: [Configuration](/ambercast/reference/configuration/#file-selection), [Discovery patterns](/ambercast/reference/discovery-patterns/#selection), [ambercast generate](/ambercast/reference/cli/generate/#flags), [ambercast run](/ambercast/reference/cli/run/#flags), [ambercast check](/ambercast/reference/cli/check/#flags), and [ambercast heal](/ambercast/reference/cli/heal/#flags).
