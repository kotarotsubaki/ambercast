---
title: ambercast run
description: Reference for the ambercast run command, covering CLI flags, replay paths, explicit AI resolution, grounding write-back, and report persistence.
---

`ambercast run` executes test prompts against target environments. It manages deterministic replay and run writes. Replay makes zero AI calls by default: a grounding miss fails closed as `grounding-unresolved` with exit code 4 and a hint to use `--resolve`. Pass `--resolve` to opt into live AI resolution for misses.

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

See [Resolve missing grounding](#resolve) for `--resolve` and `--ai`, [Grounding write-back](#grounding-write-back) for `--update-cache`, and the next section for when `--stale=regenerate` is rejected.

<a id="replay-paths"></a>

## Replay {#replay}

| condition | AI provider | result path |
| --- | --- | --- |
| grounding hit | none for that replay | deterministic replay |
| grounding miss, `--resolve` omitted | none | fails closed as `grounding-unresolved` (exit 4) |
| grounding miss, `--resolve` passed | resolver; `--ai` overrides | live AI resolution and possible write-back |

The runtime rejects `--stale=regenerate` before configuration or file I/O. During setup, the runtime composes the browser, environment-backed secrets, configuration, and the provider resolver that `--resolve` can use. Secret values resolve only from `AMBERCAST_SECRET_<NAME>` at a permitted browser sink; `run` never requests generation consent.

## AI calls {#ai-calls}

`run` always has access to a provider resolver, but grounded replay proceeds without calling it even when no provider is available. A cache miss can call the resolver only when you pass `--resolve`.

## Resolve missing grounding {#resolve}

`--resolve` opts into the AI resolution path. Without it, a grounding miss fails closed instead of dispatching a provider.

With the default local write-back, a resolved run can persist a re-resolved fingerprint and pass.

## Grounding write-back {#grounding-write-back}

`run` writes changed grounding only when the resolved write-back gate permits it. `--update-cache` is one explicit input to that gate: it combines with `ci.updateGroundingCache` in CI, and with the `localWriteBack` setting locally. See [Configuration](/ambercast/reference/configuration/#grounding) for every local and CI condition.

## Report and exits {#report-and-exits}

Only `run` attempts report persistence (`reportPersistence`) at `<runsDir>/<runId>/report.json`. `persisted` follows a completed write, `failed` follows a failed write with no partial content visible, and `not-attempted` applies when no write is tried, including a pre-outcome failure.

Run result statuses are `passed`, `failed`, `error`, `listed`, and `skipped`; process-code values and their priority are owned by [Exit codes](/ambercast/reference/exit-codes/#aggregation-priority).

When a case is `passed` and `replayReadiness.status` is `not-ready`, human output prints one line below the result:

```text
  replay: not ready (run "ambercast run --resolve --update-cache <file>")
```

If write-back permission prevented saving changes, it prints this line instead:

```text
  replay: not ready (the grounding was not saved; rerun with --update-cache)
```

`<file>` is the prompt path. Cases with `failed` or `error` status do not print this line. In JSON, failed cases that obtained a plan also carry the optional `replayReadiness`. Readiness does not change exit codes. [Reports](/ambercast/reference/reports/#run-results) defines the values and assessment limits.

Links: [Configuration](/ambercast/reference/configuration/#grounding), [Reports](/ambercast/reference/reports/#run-results), [File layout](/ambercast/reference/file-layout/#run-artifacts), [Exit codes](/ambercast/reference/exit-codes/#aggregation-priority).

## Text that changes between runs {#changing-neighbor-text}

With stored components and unchanged target and structure, neighboring text changing between runs stops zero-AI replay once.
Rerun `ambercast run --resolve`; once ambercast writes the result back, neighboring text no longer stops this element.
This covers only that cause: a stop from another cause, such as a page still changing after the previous step, can still happen.
This applies to targets with or without an accessible name.

Groundings written before v5 lack components, so expect one extra stop: the first resolve rebuilds a strict entry with components; the next resolve adds ignored slots.

Structure changes, including neighboring elements appearing or disappearing, remain mismatches and are never relaxed. Replays without permission to resolve never add ignored slots. Immediately before acting, ambercast still compares the complete fingerprint from this run, including ignored names.

Check that the page shows the expected record before resolving a text change. The [report](/ambercast/reference/reports/#neighbor-name-warnings) identifies newly ignored slots and whether ambercast saved them.
