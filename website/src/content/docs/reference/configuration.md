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

A target configuration supplies a web surface and a browser destination; its `healReplayIsolation` and `resolveTimeoutMs` settings are resolved live (before heal, and before element resolution respectively) and are not Plan or inputs-digest fields.

## Key table {#key-table}

| Key path | Type | Default | Constraint | Consumers |
| --- | --- | --- | --- | --- |
| `$schema` | string | — | required in a present file | loader |
| `testDir` | string | `tests/ambercast` | resolves to an absolute layout path | generate, run, check, heal discovery/layout |
| `runsDir` | string | `tests/ambercast/.runs` | resolves to an absolute layout path | run reports/evidence; heal contained writes |
| `testMatch` | string[] | `["**/*.test.md"]` | limited `*`/`**` matcher; every pattern must end in `.test.md` or config loading fails with `CONFIG_INVALID` | generate, run, check, heal discovery |
| `testIgnore` | string[] | `["**/.runs/**","**/*.ambercast.plan.json","**/*.ambercast.grounding.json"]` | excludes after inclusion match | generate, run, check, heal discovery |
| `secrets.allow` | `SecretName[] \| "*"` | `[]` | an empty array requires consent for every secret name; `"*"` allows every name without consent (not recommended); a non-empty array allows exactly those names | generate, run, heal |
| `targets.<name>.baseUrl` | string | `http://localhost:3000` on `web-user` | replaces whole target record | generate input; run, check, heal referenced Plan targets |
| `targets.<name>.surface` | `web` | `web` | only `web` in TP1 | generate and Plan target definition |
| `targets.<name>.description` | string | absent | optional generation context | generate |
| `targets.<name>.browser` | `chromium` | `chromium` on `web-user` | live executor setting; excluded from Plan digest | run and heal browser composition |
| `targets.<name>.secretSinkOrigins` | `Record<SecretRef, SecretSinkOrigin[]>` | absent | an absent secret entry permits only `baseUrl`; an empty array denies that secret everywhere; a non-empty array replaces that default | generate, run, heal secret sink policy; check (freshness) |
| `targets.<name>.healReplayIsolation` | `idempotent|stateful` | `stateful` | heal requires every Plan-referenced target to be `idempotent` | heal |
| `targets.<name>.resolveTimeoutMs` | integer | `5000` | 0–60000 | run; heal |
| `defaultTarget` | string | `web-user` | must resolve to a target; generator uses it when the prompt does not identify a step Target | generate |
| `ai.provider` | `claude|codex|auto` | `auto` | CLI/environment may override | generate; run fallback; heal |
| `ai.maxGenerateAttempts` | positive integer | `2` | 1–5; per-file generation attempts | generate only; never heal Stage 3 |
| `ai.timeoutMs` | positive integer | `600000` | positive | generate; run fallback; heal |
| `viewer.port` | integer | `4600` | 1–65535; starting candidate, overridden by `--port` | view |
| `ci.heal` | boolean | `false` | opt-in to non-list heal in CI | heal |
| `ci.updateGroundingCache` | boolean | `false` | CI write-back opt-in | run |
| `grounding.repositoryPolicy` | `committed|uncommitted` | `committed` | finite vocabulary | check |
| `grounding.localWriteBack` | `auto|explicit` | `auto` | ignored in CI | run |
| `heal.maxStepRepairs` | positive integer | absent | caps incremental real-provider dispatches only | heal |
| `heal.caseTimeoutMs` | positive integer | `300000` | case admission deadline | heal |

## Secret consent {#secret-consent}

`secrets.allow` is the durable allowlist for logical secret names discovered during generation. `generate` prompts for names outside a list value and merges accepted names into the configuration file. In CI or another non-interactive context, pre-populate the list with names that have already been reviewed.

`"*"` bypasses per-name consent and accepts any AI-proposed name. It is a high-risk escape hatch, not a safer default: use it only when accepting arbitrary proposed names without review is intended.

## AI configuration {#ai}

`ai.maxGenerateAttempts`: Maximum provider attempts per prompt during generate when the local validators reject a response. Between 1 and 5, default 2. Never applies to heal repairs.

`ai.timeoutMs`: Deadline in milliseconds for one provider dispatch. Applies to every generate, run, and heal dispatch. The heal case deadline is an admission boundary only, so an admitted dispatch may still run up to this value. Default 600000.

## Healing configuration {#heal}

`heal.maxStepRepairs` controls incremental real-provider dispatches, while `heal.caseTimeoutMs` establishes the case-wide admission deadline.

## Grounding write-back {#grounding}

| Environment | Resolved policy | Grounding writes when |
| --- | --- | --- |
| local | `localWriteBack: auto` | automatically after a changed grounding result |
| local | `localWriteBack: explicit` | `--update-cache` is passed |
| CI | `localWriteBack` ignored | `--update-cache` is passed or `ci.updateGroundingCache: true` |

Links: [CLI overview](/ambercast/reference/cli/overview/#command-flag-matrix), [Discovery patterns](/ambercast/reference/discovery-patterns/#pattern-language), [Environment variables](/ambercast/reference/environment-variables/#configuration), [ambercast run](/ambercast/reference/cli/run/#grounding-write-back).
