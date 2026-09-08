---
title: Environment variables
description: Exhaustive reference of environment variables read by Ambercast and the filtering boundary for AI-provider child processes.
---

Ambercast reads process environment variables for configuration path overrides, AI provider selection, secret reference resolution, and CI detection, while applying a deny-list filter to environment variables forwarded to AI-provider child processes.

## Configuration and provider {#configuration}

| variable | where Ambercast reads it | effect | precedence / edge cases |
| --- | --- | --- | --- |
| `AMBERCAST_CONFIG` | `readConfigEnvironment()` → `configPathOverride` | Selects an explicit configuration path. | A command `--config` value wins; then this variable; then ancestor discovery; then defaults. Empty is absent; other values are preserved. |
| `AMBERCAST_AI_PROVIDER` | `readConfigEnvironment()` → `aiProviderRaw` | Replaces config/default `ai.provider` after validation as `claude`, `codex`, or `auto`. | `--ai` wins; then this variable; then config `ai.provider`; then the default `auto`. Empty is absent; an unsupported nonempty value is invalid. |
| `AMBERCAST_SECRET_*` | `createEnvSecretsProvider().resolve()` | Resolves a specific `{{secrets.*}}` reference at the secret-provider boundary. | Dots become underscores and segments are uppercased: `{{secrets.a.b}}` maps to `AMBERCAST_SECRET_A_B`; a missing key returns `undefined`. This mapping is non-injective, so references such as `a.b` and `a_b` must not be used together. |
| `CI` | `createProcessEnvironmentInfo().isCI()` | Supplies the CI-policy boolean consumed by runtime commands. | Active only when defined, nonempty, and not exactly lowercase `false`; `FALSE`, `0`, and whitespace are active. |
| `AMBERCAST_DEBUG` | bare catch in `main.ts` | Prints the crash cause message and stack to stderr. | Inactive when unset, empty, exactly `0`, or exactly `false`; active otherwise. Matching is case-sensitive and does not trim whitespace. |

Provider resolution applies the command `--ai` override before evaluating the loaded provider. When you specify a non-`auto` value, Ambercast returns it directly without probing; `auto` probes `claude` first and then `codex`. Each automatic provider probe has its own 8,000 ms availability deadline.

## Secrets and CI {#secrets}

| withheld variable class | passed to AI-provider child? | exact rule |
| --- | --- | --- |
| `AMBERCAST_SECRET_*` | No | Remove the namespace case-insensitively before every child invocation. |
| `AMBERCAST_ENV_*` | No | Remove the namespace with the same case-insensitive deny rule. |

The environment adapter does not parse `CI` case-insensitively or trim surrounding whitespace. When resolving secrets, an existing empty variable such as `AMBERCAST_SECRET_<NAME>` remains a resolved value; only a missing computed key returns `undefined`.

## Provider child environment {#provider-child-environment}

| passed variable class | passed to AI-provider child? | rule |
| --- | --- | --- |
| Supplied keys not matching `/^AMBERCAST_(SECRET|ENV)_/i` | Yes | The runner shallow-copies the injected environment, removes only denied keys, and supplies the result as `spawn(...).env`; ordinary runtime/provider variables and `AMBERCAST_CONFIG`, `AMBERCAST_AI_PROVIDER`, and `CI` therefore pass if present. |

Filtering functions as a deny-list rather than a fixed allow-list. It returns a shallow copy and leaves the parent process environment unchanged. Because the deny rule removes only keys matching `/^AMBERCAST_(SECRET|ENV)_/i`, variables such as `AMBERCAST_CONFIG`, `AMBERCAST_AI_PROVIDER`, and `CI` pass through to the child process alongside any general runtime and provider variables. The implementation makes no exhaustive promise about provider-specific authentication variable names.

Related references: [Configuration](/ambercast/reference/configuration/#file-selection), [ambercast generate](/ambercast/reference/cli/generate/#flags), [ambercast run](/ambercast/reference/cli/run/#flags), [ambercast heal](/ambercast/reference/cli/heal/#flags), [Prompt file format](/ambercast/reference/prompt-format/#normalization-and-grants).
