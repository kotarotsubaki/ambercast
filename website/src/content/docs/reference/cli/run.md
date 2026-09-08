---
title: ambercast run
description: Reference for the ambercast run command, covering CLI flags, replay paths, AI provider fallback, cache-only execution, grounding write-back, and report persistence.
---

`ambercast run` executes test prompts against target environments, managing deterministic replay and run writes. Replay operates with zero AI calls only on a grounding hit; on a grounding miss, execution falls back to an AI provider unless `--cache-only` is set.

## Flags {#flags}

| flag | value | effect | default |
| --- | --- | --- | --- |
| files | path[] | literal prompts; absent selects discovery | discovery |
| --grep | pattern | RegExp path filter | omitted |
| --target | name | select target | omitted |
| --headed | boolean | headed browser | false |
| --cache-only | boolean | forbid AI fallback | false |
| --update-cache | boolean | request cache write | false |
| --stale | fail\|regenerate | stale policy parser value | fail |
| --ai | claude\|codex | fallback override | omitted |
| --allow-empty | boolean | allow empty selection | false |
| --list | boolean | list without replay | false |
| --json | boolean | JSON envelope | false |
| --no-color | boolean | disable ANSI | false |

<a id="replay-paths"></a>

## Replay {#replay}

| condition | AI provider | result path |
| --- | --- | --- |
| grounding hit | none for that replay | deterministic replay |
| grounding miss, cache-only false | fallback resolver; --ai overrides | live AI fallback and possible write-back |
| grounding miss, cache-only true | none | fails without fallback |

The runtime rejects `--stale=regenerate` before configuration or file I/O. During setup, the runtime composes the browser, secrets, configuration, and the fallback provider resolver.

## AI calls {#ai-calls}

A provider resolver is passed to the run use case, so grounded replay can proceed without an available provider; a cache miss is the condition that may require its fallback.

## Cache only {#cache-only}

`--cache-only` forbids the AI fallback path; a grounding miss then fails instead of dispatching a provider.

## Grounding write-back {#grounding-write-back}

`run` writes changed grounding only when the resolved write-back gate permits it; see [Configuration](/ambercast/reference/configuration/#grounding) for every local and CI condition.

## Report and exits {#report-and-exits}

Only `run` attempts report persistence (`reportPersistence`) at `<runsDir>/<runId>/report.json`. `persisted` follows a completed write, `failed` follows a failed write with no partial content visible, and `not-attempted` applies when no write is tried, including a pre-outcome failure.

Run result statuses are `passed`, `failed`, `error`, `listed`, and `skipped`; process-code values and their priority are owned by [Exit codes](/ambercast/reference/exit-codes/#aggregation-priority).

Links: [Configuration](/ambercast/reference/configuration/#grounding), [Reports](/ambercast/reference/reports/#run-results), [File layout](/ambercast/reference/file-layout/#run-artifacts), [Exit codes](/ambercast/reference/exit-codes/#aggregation-priority).
