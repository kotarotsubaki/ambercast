---
title: Determinism in CI
description: Explains the trust boundaries and structural isolation governing Ambercast execution in CI environments.
---

When you run Ambercast in CI, execution is governed by explicit trust boundaries that isolate inspection, evidence collection, and artifact mutation. Inspection commands like `check` enforce these boundaries structurally through their dependency interfaces rather than through runtime conventions.

## Read-only inspection is structural {#read-only-check}

When you use `check` as an inspection gate, its read-only behavior is established directly by its dependency contracts. `CheckDeps` exposes only `ReadStorageAdapter`, layout resolution, discovery, selected configuration, and an optional abort signal.

`CheckDeps` intentionally omits the AI executor, browser driver, secrets, clock, and event ports; the code identifies their absence as the read-only boundary. The storage capability is explicitly read-only: reads and existence checks are sufficient for prompts, plans, grounding companions, and orphan findings.

Links: [ambercast check](/ambercast/reference/cli/check/#read-only-contract), [Plan lifecycle and freshness](/ambercast/explanation/plan-lifecycle/#fresh-plan-decision)

## Replay has bounded persistence {#bounded-side-effects}

Replay separates execution evidence from source artifact mutation. Run first finalizes an envelope marked `persisted`, then writes its JSON only to the invocation's run-report path.

If that write fails, run returns an envelope with `reportPersistence: "failed"`; a successful batch becomes exit 3 in that condition. In the report schema, `reportPersistence: "not-attempted"` means no persistence write was tried, while `failed` means no partial content became visible at the target path.

Links: [Reports](/ambercast/reference/reports/#report-persistence), [ambercast run](/ambercast/reference/cli/run/#grounding-write-back)

## Healing is refused by default in CI {#heal-refusal}

Repair cannot silently modify CI artifacts. A real `heal` invocation in CI throws a configuration error unless `config.ci.heal` is true. The CI refusal is evaluated after list-mode short-circuiting, so `heal --list` remains a non-writing discovery operation.

Healing buffers only the plan and grounding companions in a private overlay; before confirmation or during `--dry-run`, replay attempts can still write contained evidence below the case run directory. A later commit capability is the only route from a buffered companion candidate to real artifact writes.

Links: [ambercast heal](/ambercast/reference/cli/heal/#ci), [Healing model](/ambercast/explanation/healing-model/#confirmation-and-writes)

## One process status represents the strongest blocker {#exit-priority}

When execution encounters mixed results, the process reports one predictable process status. The exit selector chooses the strongest candidate independently of iteration order and duplicate candidates. A module-load assertion rejects an invalid rank table, preserving that selection rule as a runtime invariant.

Links: [Exit codes](/ambercast/reference/exit-codes/#priority), [Operating contract](/ambercast/agents/operating-contract/#next-action-by-exit-code), [Reading structured output](/ambercast/agents/reading-structured-output/#decision-tree)
