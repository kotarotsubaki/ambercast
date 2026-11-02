---
title: Configuration
description: Configuration keys, defaults, and the rules for choosing a configuration file in ambercast.
---

ambercast builds its configuration from one configuration file and built-in defaults. This page covers how it picks the file, the target settings, and every key.

## File selection {#file-selection}

A configuration file that is present must contain `$schema`. Every other declared key is optional.

ambercast chooses the file in this order:

1. The `--config` value on the command. `generate`, `check`, and `view` accept it. `run`, `heal`, `init`, and `mcp` do not. See the [command flag matrix](/ambercast/reference/cli/overview/#command-flag-matrix).
2. The `AMBERCAST_CONFIG` variable, described in [Environment variables](/ambercast/reference/environment-variables/#configuration).
3. An `ambercast.config.json` in an ancestor directory.
4. The built-in defaults.

An explicit path that does not exist is an error. It does not fall through to discovery or the defaults.

A `targets` object you supply replaces the default targets instead of merging with them. If the replacement omits `defaultTarget`, the default is cleared.

## Targets {#targets}

A target supplies a web surface and a browser destination. ambercast resolves `healReplayIsolation` and `resolveTimeoutMs` live, before heal and before element resolution. They are not plan fields and do not enter `inputsDigest`.

When it loads the file, ambercast canonicalizes an authored `locale` with `Intl.getCanonicalLocales`. For example, `"ja-jp"` becomes `"ja-JP"`. A value that throws `RangeError`, an empty string, or a non-string fails with `CONFIG_INVALID` (exit 2) at issue path `targets.<name>.locale`.

The normalized locale reaches the plan's target definition and the Playwright browser context. It affects `navigator.language` and the `Accept-Language` header of the first request for that target's pages.

The setting stops there. It does not set the timezone, an application-side language cookie, or an application preference. It also defines no priority against those mechanisms.

## Key table {#key-table}

| key path | type | default | constraint | consumers |
| --- | --- | --- | --- | --- |
| `$schema` | string | — | required in a present file | loader |
| `testDir` | string | `tests/ambercast` | resolves to an absolute layout path | generate, run, check, heal (discovery and layout) |
| `runsDir` | string | `tests/ambercast/.runs` | resolves to an absolute layout path | run (reports and evidence); heal (contained writes) |
| `testMatch` | string[] | `["**/*.test.md"]` | limited `*`/`**` matcher. Every pattern must end in `.test.md`, or loading fails with `CONFIG_INVALID` | generate, run, check, heal (discovery) |
| `testIgnore` | string[] | `["**/.runs/**","**/*.ambercast.plan.json","**/*.ambercast.grounding.json"]` | excludes after inclusion match | generate, run, check, heal (discovery) |
| `secrets.allow` | `SecretName[] \| "*"` | `[]` | an empty array requires consent for every secret name. `"*"` allows every name without consent (not recommended). A non-empty array allows exactly those names | generate, run, heal |
| `targets.<name>.baseUrl` | string | `http://localhost:3000` on `web-user` | required in every target you write; an http(s) URL without a literal `{{secrets.`. Replaces the whole target record | generate (input); run, check, heal (plan-referenced targets) |
| `targets.<name>.surface` | `web` | absent | only `web` in TP1. The optional field resolves to `web` at use, not through a schema default | generate; plan target definition |
| `targets.<name>.description` | string | absent | optional generation context | generate |
| `targets.<name>.executor.kind` | `playwright` | `playwright` | live UI executor kind; excluded from the plan digest | run, heal (executor composition) |
| `targets.<name>.executor.browser` | `chromium` | `chromium` | live executor browser; excluded from the plan digest | run, heal (executor composition) |
| `targets.<name>.secretSinkOrigins` | `Record<SecretRef, SecretSinkOrigin[]>` | absent | an absent secret entry permits only `baseUrl`. An empty array denies that secret everywhere. A non-empty array replaces that default. Each origin is `scheme://host[:port]` with port 1–65535, and has no path, query, fragment, wildcard, userinfo, or literal `{{secrets.` | generate, run, heal (secret sink policy); check (freshness) |
| `targets.<name>.healReplayIsolation` | `idempotent\|stateful` | `stateful` | heal requires every plan-referenced target to be `idempotent` | heal |
| `targets.<name>.locale` | string | absent | canonicalized with `Intl.getCanonicalLocales`. A value that fails canonicalization is `CONFIG_INVALID` | generate; plan target definition; run (browser context) |
| `targets.<name>.resolveTimeoutMs` | integer | `5000` | 0–60000 | run, heal |
| `defaultTarget` | string | `web-user` | must resolve to a target. The generator uses it when the prompt does not identify a step's target | generate |
| `ai.provider` | `claude\|codex\|auto` | `auto` | a CLI flag or environment variable may override it | generate; run (fallback); heal |
| `ai.maxGenerateAttempts` | positive integer | `2` | 1–5; generation attempts per file | generate only; never heal Stage 3 |
| `ai.timeoutMs` | positive integer | `600000` | positive | generate; run (fallback); heal |
| `viewer.port` | integer | `4600` | 1–65535; the starting candidate, overridden by `--port` | view |
| `ci.heal` | boolean | `false` | opt-in to non-list heal in CI | heal |
| `ci.updateGroundingCache` | boolean | `false` | opt-in to cache write-back in CI | run |
| `grounding.repositoryPolicy` | `committed\|uncommitted` | `committed` | finite vocabulary | check |
| `grounding.localWriteBack` | `auto\|explicit` | `auto` | ignored in CI | run |
| `heal.maxStepRepairs` | positive integer | absent | caps incremental real-provider dispatches only | heal |
| `heal.caseTimeoutMs` | positive integer | `300000` | case admission deadline | heal |

The `testMatch` and `testIgnore` patterns follow the [pattern language](/ambercast/reference/discovery-patterns/#pattern-language).

## Secret consent {#secret-consent}

`secrets.allow` is the durable allowlist of logical secret names found during generation. `generate` prompts for any name outside a list value and merges the names you accept into the file. In CI or another non-interactive context, fill the list with names that were already reviewed.

`"*"` skips per-name consent and accepts any name the AI proposes. It is a high-risk escape hatch, not a safer default. Use it only when you intend to accept arbitrary proposed names without review.

## AI configuration {#ai}

`ai.maxGenerateAttempts` is the maximum number of provider attempts per prompt during `generate`, including the first attempt. `generate` tries again only when local validation rejects a response. The range is 1 to 5, and the default is 2. It never applies to heal repairs.

`ai.timeoutMs` is the deadline in milliseconds for one provider dispatch, with a default of 600000. It applies to every generate, run, and heal dispatch. The heal case deadline only decides admission, so an admitted dispatch can still run up to this value.

## Healing configuration {#heal}

`heal.maxStepRepairs` caps incremental real-provider dispatches. `heal.caseTimeoutMs` is the admission deadline for the whole case.

## Grounding write-back {#grounding}

| environment | resolved policy | grounding writes when |
| --- | --- | --- |
| local | `localWriteBack: auto` | a grounding result changed |
| local | `localWriteBack: explicit` | `--update-cache` is passed |
| CI | `localWriteBack` ignored | `--update-cache` is passed or `ci.updateGroundingCache: true` |

See [ambercast run](/ambercast/reference/cli/run/#grounding-write-back) for the command behavior.

## See also {#see-also}

- [CLI overview](/ambercast/reference/cli/overview/#command-flag-matrix)
- [Discovery patterns](/ambercast/reference/discovery-patterns/#pattern-language)
- [Environment variables](/ambercast/reference/environment-variables/#configuration)
- [ambercast run](/ambercast/reference/cli/run/#grounding-write-back)
