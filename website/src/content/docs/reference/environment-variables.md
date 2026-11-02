---
title: Environment variables
description: Environment variables that ambercast reads, and the variables it withholds from AI-provider child processes.
---

ambercast reads environment variables for the configuration path, the AI provider, secret values, and CI detection. It filters the environment before it starts an AI-provider child process.

## Configuration and provider {#configuration}

| variable | when ambercast reads it | effect | precedence and edge cases |
| --- | --- | --- | --- |
| `AMBERCAST_CONFIG` | when it looks for a configuration file | Selects an explicit configuration path. | A command's `--config` value wins. This variable comes next, then ancestor discovery, then the defaults. An empty value counts as absent, and any other value is used as given. |
| `AMBERCAST_AI_PROVIDER` | when it resolves the AI provider | Replaces `ai.provider` from the configuration with `claude`, `codex`, or `auto`. | `--ai` wins. This variable comes next, then `ai.provider`, then the default `auto`. An empty value counts as absent. A nonempty value other than the three is invalid. |
| `AMBERCAST_SECRET_*` | when a `{{secrets.*}}` reference needs a value | Supplies the value of one secret reference. | Dots become underscores and each segment is uppercased, so `{{secrets.a.b}}` reads `AMBERCAST_SECRET_A_B`. A missing variable leaves the secret unresolved. An existing empty variable is a resolved value. |
| `CI` | when a command applies its CI policy | Turns on the CI policy. | The policy is active when the variable is defined, nonempty, and not exactly the lowercase `false`. Values such as `FALSE`, `0`, and whitespace keep it active. The check is case-sensitive and does not trim. |
| `AMBERCAST_DEBUG` | when the CLI crashes, when `run` reports progress, and when the MCP server handles a crashed job or heal apply | Prints diagnostics to stderr. | Unset, empty, exactly `0`, and exactly `false` leave it inactive. Any other value activates it. The check is case-sensitive and does not trim. |

The mapping from a secret reference to `AMBERCAST_SECRET_*` is not one-to-one. Do not use references such as `a.b` and `a_b` together.

### What AMBERCAST_DEBUG prints {#debug-output}

When `AMBERCAST_DEBUG` is active, ambercast prints these diagnostics to stderr:

- The cause message and stack of a CLI crash.
- The name, redacted message, and stack of a run's unclassified case exception.
- The cause message and stack of a crashed job or heal apply in the MCP server.
- When a child process diagnostic exists, `child process: exit <n>` or `child process: signal <name>`, then `child stderr:` followed by the body or `(empty)`.

These diagnostics can contain sensitive text derived from requests.

### Provider resolution {#provider-resolution}

Provider resolution applies `--ai` first. A value other than `auto` is returned without probing. For `auto`, ambercast probes `claude` first and then `codex`. Each probe has an 8,000 ms deadline.

## Secrets and CI {#secrets}

| withheld variable class | passed to an AI-provider child? | rule |
| --- | --- | --- |
| `AMBERCAST_SECRET_*` | no | ambercast removes the namespace, ignoring case, before every child invocation. |
| `AMBERCAST_ENV_*` | no | ambercast removes the namespace by the same case-insensitive rule. |

## Provider child environment {#provider-child-environment}

| passed variable class | passed to an AI-provider child? | rule |
| --- | --- | --- |
| keys that do not match `/^AMBERCAST_(SECRET\|ENV)_/i` | yes | The runner copies the environment, removes only the denied keys, and passes the result to the child. |

The filter is a deny-list, not an allow-list. It returns a shallow copy and leaves the parent environment unchanged. `AMBERCAST_CONFIG`, `AMBERCAST_AI_PROVIDER`, and `CI` pass through when set, together with ordinary runtime and provider variables. ambercast makes no promise about the names of provider authentication variables.

## See also {#see-also}

- [Configuration](/ambercast/reference/configuration/#file-selection)
- [ambercast generate](/ambercast/reference/cli/generate/#flags)
- [ambercast run](/ambercast/reference/cli/run/#flags)
- [ambercast heal](/ambercast/reference/cli/heal/#flags)
- [Prompt file format](/ambercast/reference/prompt-format/#normalization)
