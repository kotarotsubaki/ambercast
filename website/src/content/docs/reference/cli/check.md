---
title: ambercast check
description: Inspect the freshness and validity of Ambercast test plans and grounding artifacts from the CLI.
---

`ambercast check` inspects prompt files, plans, and grounding artifacts across your project to verify their freshness and integrity. Operating under a strict read-only contract, it allows you to validate test suite artifacts without invoking AI models, launching browsers, dispatching events, or writing to disk.

## Flags {#flags}

You can pass prompt paths directly or rely on automated file discovery via [Configuration](/ambercast/reference/configuration/#file-selection), modify report formatting, or isolate a specific target.

| Flag | Value | Effect | Default |
| --- | --- | --- | --- |
| `files` | `path[]` | literal prompts; absent selects discovery | `discovery` |
| `--target` | `name` | select target | `omitted` |
| `--allow-empty` | `boolean` | allow empty selection | `false` |
| `--list` | `boolean` | list without inspection | `false` |
| `--json` | `boolean` | JSON envelope | `false` |
| `--config` | `path` | explicit configuration | `omitted` |
| `--no-color` | `boolean` | disable ANSI | `false` |

## Status vocabulary {#status-vocabulary}

During inspection, `check` reports one of the following artifact statuses:

- `fresh`
- `stale`
- `missing-plan`
- `missing-grounding`
- `invalid-grounding`
- `stale-grounding`
- `fresh-without-grounding`
- `orphaned-plan`
- `orphaned-grounding`
- `invalid-artifact-name`
- `listed`
- `skipped`

The canonical derivation rules and pass/fail classifications for these status values are defined in [Freshness and digests](/ambercast/spec/freshness/#freshness-consequences).

## Results {#results}

Completed findings produced by `check` require the fields `id`, `file`, `planFile`, `status`, and `reason`. The `groundingFile` or `artifactFile` fields appear only when serving as evidence for a finding. Full field definitions and report structures are specified in [Reports](/ambercast/reference/reports/#check-results).

The execution contract of `check` is read-only: its dependencies explicitly exclude AI runtimes, browser drivers, event dispatchers, and write storage.

## Read-only inspection {#read-only-contract}

At runtime, `check` composes read-only storage, file layout rules (see [File layout](/ambercast/reference/file-layout/#companions)), and discovery logic (see [Configuration](/ambercast/reference/configuration/#file-selection)).

Process exit codes and their precedence are governed by [Exit codes](/ambercast/reference/exit-codes/#aggregation-priority), with full mappings detailed in [Exit codes](/ambercast/reference/exit-codes/#exit-code-table):

- Untrustworthy artifacts contribute exit code `4`.
- An unallowed empty selection contributes exit code `5`.
