---
title: Determinism in CI
description: In CI, ambercast inspects without side effects, writes only the run report and contained evidence by default, refuses to repair by default, and reports one exit code.
---

These rules keep a CI run predictable: inspection cannot change anything, and the exit code does not depend on iteration order.

## Read-only inspection {#read-only-check}

`check` has no access to an AI executor, a browser, secrets, a clock, or events. Its storage access is read-only. Read-only is therefore structural, not a convention.

Reads and existence checks are enough to inspect prompts, plans, grounding, and orphaned artifacts.

Related: [ambercast check](/ambercast/reference/cli/check/#read-only-contract), [Plan lifecycle and freshness](/ambercast/explanation/plan-lifecycle/#fresh-plan-decision)

## Replay writes are bounded {#bounded-side-effects}

`run` writes its report JSON only to the report path of that invocation. It finalizes the envelope as `persisted` before the write. After a successful write, the file equals the returned envelope.

If the write fails, `run` returns the envelope with `reportPersistence: "failed"`. In that case only an otherwise-0 exit becomes 3. Exits 1, 2, 4, and 5 normally stay as they are. `not-attempted` means no write was tried, and `failed` means no partial content became visible.

In CI, writing grounding back needs `--update-cache` or `ci.updateGroundingCache: true`. The [configuration reference](/ambercast/reference/configuration/#grounding) covers the details.

Related: [Reports](/ambercast/reference/reports/#persistence), [ambercast run](/ambercast/reference/cli/run/#grounding-write-back)

## Healing is refused by default in CI {#heal-refusal}

Outside `--list`, `heal` in CI fails with a configuration error unless `ci.heal` is true. `heal --list` stays a discovery operation that writes nothing.

Healing buffers plan and grounding candidates privately. It writes them only after you answer the `ambercast heal` confirmation prompt, or after `--yes` answers it in advance. Replay attempts, including those under `--dry-run`, can still write contained evidence in the case directory under the runs directory.

Related: [ambercast heal](/ambercast/reference/cli/heal/#ci), [Healing model](/ambercast/explanation/healing-model/#confirmation-and-writes)

## The strongest problem sets the exit code {#exit-priority}

When results are mixed, the exit code is the strongest candidate. The priority is fixed at `2 > 3 > 4 > 1 > 5 > 0`. Iteration order and duplicate candidates do not change the result.

Related: [Exit codes](/ambercast/reference/exit-codes/#aggregation-priority), [Operating contract](/ambercast/agents/operating-contract/#next-action-by-exit-code), [Reading structured output](/ambercast/agents/reading-structured-output/#decision-tree)
