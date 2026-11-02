---
title: ambercast check
description: Flags, status values, result fields, and the read-only contract of ambercast check, which inspects plan and grounding freshness.
---

`ambercast check` inspects prompts, plans, and grounding companions and reports whether each is fresh and valid. It makes no AI call, launches no browser, dispatches no event, and writes nothing to disk.

## Flags {#flags}

You can pass prompt paths directly or let [configured discovery](/ambercast/reference/configuration/#file-selection) select them.

| flag | value | effect | default |
| --- | --- | --- | --- |
| files | path[] | literal prompts; absent selects discovery | discovery |
| --allow-empty | boolean | allow empty selection | false |
| --list | boolean | list without inspection | false |
| --json | boolean | JSON envelope | false |
| --config | path | explicit configuration | omitted |
| --no-color | boolean | disable ANSI | false |

## Status vocabulary {#status-vocabulary}

`check` reports one of these twelve statuses for each result. `listed` appears only with `--list`, and `skipped` only after an interruption.

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

[Freshness and digests](/ambercast/spec/freshness/#freshness-consequences) defines how each status is derived and whether it passes or fails.

## Results {#results}

A completed finding carries `id`, `file`, `planFile`, `status`, and `reason`. The `groundingFile` or `artifactFile` field appears only as evidence for a finding. A finding with status `invalid-artifact-name` is the exception: it has no `planFile` and carries `id`, `file`, `status`, `reason`, and `artifactFile`, where `id`, `file`, and `artifactFile` name the artifact itself. [Reports](/ambercast/reference/reports/#check-results) lists the full field definitions and report structures.

## Read-only inspection {#read-only-contract}

`check` is read-only. Its dependencies exclude AI runtimes, browser drivers, event dispatchers, and write storage. At runtime it composes read-only storage, the file layout rules (see [File layout](/ambercast/reference/file-layout/#companions)), and discovery (see [Configuration](/ambercast/reference/configuration/#file-selection)).

[Exit codes](/ambercast/reference/exit-codes/#aggregation-priority) owns the process-code values and their precedence, and the [exit code table](/ambercast/reference/exit-codes/#exit-code-table) maps each code in full.

- Untrustworthy artifacts contribute exit `4`.
- An unallowed empty selection contributes exit `5`.
