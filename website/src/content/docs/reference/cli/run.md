---
title: ambercast run
description: Reference for the ambercast run command, covering CLI flags, replay paths, explicit AI resolution, grounding write-back, and report persistence.
---

`ambercast run` executes test prompts against target environments, managing deterministic replay and run writes. Replay makes zero AI calls by default: a grounding miss fails closed as `grounding-unresolved` with exit code 4 and a hint to use `--resolve`. Pass `--resolve` to opt into live AI resolution for misses.

## Flags {#flags}

| flag | value | effect | default |
| --- | --- | --- | --- |
| files | path[] | literal prompts; absent selects discovery | discovery |
| --grep | pattern | RegExp path filter | omitted |
| --headed | boolean | headed browser | false |
| --resolve | boolean | opt into live AI resolution on a grounding miss | false |
| --update-cache | boolean | request cache write | false |
| --stale | fail\|regenerate | stale policy parser value | fail |
| --ai | claude\|codex | resolution provider override | omitted |
| --allow-empty | boolean | allow empty selection | false |
| --list | boolean | list without replay | false |
| --json | boolean | JSON envelope | false |
| --no-color | boolean | disable ANSI | false |

<a id="replay-paths"></a>

## Replay {#replay}

| condition | AI provider | result path |
| --- | --- | --- |
| grounding hit | none for that replay | deterministic replay |
| grounding miss, `--resolve` omitted | none | fails closed as `grounding-unresolved` (exit 4) |
| grounding miss, `--resolve` passed | resolver; `--ai` overrides | live AI resolution and possible write-back |

The runtime rejects `--stale=regenerate` before configuration or file I/O. During setup, the runtime composes the browser, environment-backed secrets, configuration, and the provider resolver that `--resolve` can use. Secret values resolve only from `AMBERCAST_SECRET_<NAME>` at a permitted browser sink; `run` never requests generation consent.

## AI calls {#ai-calls}

A provider resolver is passed to the run use case, so grounded replay can proceed without an available provider; a cache miss can use it only when `--resolve` is passed.

## Resolve missing grounding {#resolve}

`--resolve` opts into the AI resolution path. Without it, a grounding miss fails closed instead of dispatching a provider.

## Grounding write-back {#grounding-write-back}

`run` writes changed grounding only when the resolved write-back gate permits it; see [Configuration](/ambercast/reference/configuration/#grounding) for every local and CI condition.

## Report and exits {#report-and-exits}

Only `run` attempts report persistence (`reportPersistence`) at `<runsDir>/<runId>/report.json`. `persisted` follows a completed write, `failed` follows a failed write with no partial content visible, and `not-attempted` applies when no write is tried, including a pre-outcome failure.

Run result statuses are `passed`, `failed`, `error`, `listed`, and `skipped`; process-code values and their priority are owned by [Exit codes](/ambercast/reference/exit-codes/#aggregation-priority).

Links: [Configuration](/ambercast/reference/configuration/#grounding), [Reports](/ambercast/reference/reports/#run-results), [File layout](/ambercast/reference/file-layout/#run-artifacts), [Exit codes](/ambercast/reference/exit-codes/#aggregation-priority).
