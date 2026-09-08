---
title: Configuration
description: Configuration keys and resolution rules for ambercast.
---

ambercast resolves configuration keys through configuration files and built-in defaults. When a configuration file is present, `$schema` is required and all other declared keys are optional.

## File selection {#file-selection}

A configuration file that is present must contain `$schema`; all other declared keys are optional.

Selection precedence is command `--config` (`generate` and `check` only), then `AMBERCAST_CONFIG`, then an ancestor `ambercast.config.json`, then built-in defaults.

An explicit nonexistent configuration path is an error and does not fall through to discovery or defaults.

A supplied `targets` object replaces, rather than deep-merges with, default targets; omitting `defaultTarget` with that replacement clears the default.

## Targets {#targets}

A target configuration supplies a browser destination; its `healReplayIsolation` setting is resolved before heal and is not a Plan or inputs-digest field.

## Key table {#key-table}

| Key path | Type | Default | Constraint | Consumers |
| --- | --- | --- | --- | --- |
| `$schema` | string | — | required in a present file | loader |
| `testDir` | string | `tests/ambercast` | resolves to an absolute layout path | generate, run, check, heal discovery/layout |
| `runsDir` | string | `tests/ambercast/.runs` | resolves to an absolute layout path | run reports/evidence; heal contained writes |
| `testMatch` | string[] | `["**/*.test.md"]` | limited `*`/`**` matcher | generate, run, check, heal discovery |
| `testIgnore` | string[] | `["**/.runs/**","**/*.ambercast.plan.json","**/*.ambercast.grounding.json"]` | excludes after inclusion match | generate, run, check, heal discovery |
| `targets.<name>.baseUrl` | string | `http://localhost:3000` on `web-user` | replaces whole target record | generate, run, check, heal target selection |
| `targets.<name>.browser` | `chromium` | `chromium` on `web-user` | target field | generate, run, heal browser composition; check (freshness) |
| `targets.<name>.secretSinkOrigins` | `Record<SecretRef, SecretSinkOrigin[]>` | absent | an absent secret entry permits only `baseUrl`; an empty array denies that secret everywhere; a non-empty array replaces that default | generate, run, heal secret sink policy; check (freshness) |
| `targets.<name>.healReplayIsolation` | `idempotent|stateful` | `stateful` | heal requires selected `idempotent` target | heal |
| `defaultTarget` | string | `web-user` | must resolve to a target | generate, run, check, heal target selection |
| `ai.provider` | `claude|codex|auto` | `auto` | CLI/environment may override | generate; run fallback; heal |
| `ai.timeoutMs` | positive integer | `120000` | positive | generate; run fallback; heal |
| `viewer.port` | integer | `4600` | 1–65535; viewer command is planned | planned `view` only |
| `ci.heal` | boolean | `false` | opt-in to non-list heal in CI | heal |
| `ci.updateGroundingCache` | boolean | `false` | CI write-back opt-in | run |
| `grounding.repositoryPolicy` | `committed|uncommitted` | `committed` | finite vocabulary | check |
| `grounding.localWriteBack` | `auto|explicit` | `auto` | ignored in CI | run |
| `heal.maxStepRepairs` | positive integer | absent | caps incremental real-provider dispatches only | heal |
| `heal.caseTimeoutMs` | positive integer | `300000` | case admission deadline | heal |

## Healing configuration {#heal}

`heal.maxStepRepairs` controls incremental real-provider dispatches, while `heal.caseTimeoutMs` establishes the case-wide admission deadline.

## Grounding write-back {#grounding}

| Environment | Resolved policy | Grounding writes when |
| --- | --- | --- |
| local | `localWriteBack: auto` | automatically after a changed grounding result |
| local | `localWriteBack: explicit` | `--update-cache` is passed |
| CI | `localWriteBack` ignored | `--update-cache` is passed or `ci.updateGroundingCache: true` |

Links: [CLI overview](/ambercast/reference/cli/overview/#command-flag-matrix), [Discovery patterns](/ambercast/reference/discovery-patterns/#pattern-language), [Environment variables](/ambercast/reference/environment-variables/#configuration), [ambercast run](/ambercast/reference/cli/run/#grounding-write-back).
