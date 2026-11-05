---
title: Reading structured output
description: Read a JSON report in a fixed order, `command`, then `reportPersistence` for `run`, then `errors[].code`, then each `results[].status`, and act on the first that calls for it.
---

A report belongs to the `generate`, `run`, `check`, `heal`, or `review` branch, selected by `command`. The sections below say where to start reading, when to stop, and when a result lets you continue.

## Decision tree {#decision-tree}

Read `command`, `reportPersistence`, `errors[].code`, and `results[].status` in that order. Only `run` has `reportPersistence`, with the values `persisted`, `failed`, and `not-attempted`. The schema defines a `review` branch, but the CLI has no `review` command.

If `errors[].code` holds any code, use the operating contract's report-error table before you change files. If it holds none, classify each `results[].status` by the rules for that command.

~~~
Read command.
├─ run: read reportPersistence first.
│  ├─ failed → keep the stdout report; treat persistence as an environment problem.
│  └─ persisted/not-attempted → continue to errors.
├─ generate/check/heal/review → continue to errors.
Read every errors[].code.
├─ any code → use the operating contract's report-error table before changing files.
└─ none → classify every results[].status for this command.
   ├─ listed/skipped → discovery-only or incomplete, not success.
   ├─ generate failed, run failed/error → read the evidence; do not heal or regenerate automatically.
   ├─ check other than fresh/fresh-without-grounding → artifacts are untrustworthy; use stale-artifact recovery.
   ├─ heal unresolved/partially-healed → report it; do not retry automatically.
   └─ any other status → continue only within approved scope.
~~~

Related: [Reports](/ambercast/reference/reports/), [Operating contract](/ambercast/agents/operating-contract/#next-action-by-report-error)

## Status means command-specific evidence {#status-by-command}

Each command has its own `results[].status` vocabulary. `listed` is discovery only, and `skipped` carries no execution evidence. Neither is success.

- `generate` uses `generated`, `would-generate`, `skipped-fresh`, `listed`, `failed`, and `skipped`.
- `run` uses `passed`, `failed`, `error`, `listed`, and `skipped`.
- `check` uses `fresh`, `stale`, `missing-plan`, `missing-grounding`, `stale-grounding`, `invalid-grounding`, `fresh-without-grounding`, `orphaned-plan`, `orphaned-grounding`, `invalid-artifact-name`, `listed`, and `skipped`.
- A completed `heal` row has `status: completed`, and `repairOutcome` is `healed`, `partially-healed`, `unresolved`, or `no-changes-needed`. `listed` and `skipped` rows carry identity only.

Related: [Generate results](/ambercast/reference/reports/#generate-results), [Run results](/ambercast/reference/reports/#run-results), [Check results](/ambercast/reference/reports/#check-results), [Heal results](/ambercast/reference/reports/#heal-results), [Plan lifecycle and freshness](/ambercast/explanation/plan-lifecycle/#grounding-binding)

## The exit code is a batch-level signal {#exit-code-signal}

Read the exit code only after the rows and errors, as a signal for the whole batch. Each report error also records its scope and kind in `errors[]`.

Related: [Exit codes](/ambercast/reference/exit-codes/#aggregation-priority), [Operating contract](/ambercast/agents/operating-contract/#next-action-by-exit-code)
