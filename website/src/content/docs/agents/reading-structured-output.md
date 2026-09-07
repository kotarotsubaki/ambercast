---
title: Reading structured output
description: Branch on the report envelope, inspect reportPersistence and errors, and evaluate command-specific result statuses in ambercast.
---

When you consume structured output from ambercast, branch on the report envelope to inspect execution details in a fixed, safe order. A report envelope is discriminated by `command` into `generate`, `run`, `check`, `heal`, and `review` branches, each pairing shared error records with command-specific result structures.

## Envelope decision tree {#decision-tree}

Process `command`, `reportPersistence`, `errors[].code`, and `results[].status` in a fixed order.

The top-level envelope is discriminated by `command` into `generate`, `run`, `check`, `heal`, and `review` branches. Only the `run` branch contains `reportPersistence`, whose values are `persisted`, `failed`, and `not-attempted`. For other commands, proceed directly to evaluating results.

Across all commands, the report schema supplies a stable public vocabulary of `errors[].code`. Inspect these codes before taking action on files. If no errors are present, classify each `results[].status` according to the rules for that specific command.

~~~
Read command.
├─ run: read reportPersistence first.
│  ├─ failed → retain stdout envelope; treat persistence as an environment problem.
│  └─ persisted/not-attempted → continue to results.
├─ generate/check/heal/review → continue to results.
Read every errors[].code.
├─ any code → use operating-contract's error-code table before changing files.
└─ none → classify every results[].status for this command.
   ├─ failed/error/stale/missing/orphaned → stop at the corresponding contract.
   ├─ skipped/listed → treat as incomplete or discovery-only, not success.
   └─ healthy status → continue only within approved scope.
~~~

Links: [Reports](/ambercast/reference/reports/), [Operating contract](/ambercast/agents/operating-contract/#next-action-by-report-error)

## Status means command-specific evidence {#status-by-command}

Each command maintains its own vocabulary for `results[].status`, and each status communicates distinct execution evidence:

- **`run`**: Execution results use `passed`, `failed`, or `error`. The `listed` status is discovery-only, and `skipped` carries no execution evidence.
- **`generate`**: Distinguishes `generated`, `would-generate`, `skipped-fresh`, `listed`, `failed`, and `skipped`.
- **`check`**: Includes `fresh`/`stale`, plan/grounding-missing or `orphaned` outcomes, plus `fresh-without-grounding`, `listed`, and `skipped`.

Links: [Reports](/ambercast/reference/reports/#result-statuses), [Plan lifecycle and freshness](/ambercast/explanation/plan-lifecycle/#grounding-binding)

## Process status is a batch-level signal {#exit-code-signal}

Use the process status as a batch-level signal only after retaining the more specific rows and errors from the envelope. Alongside its code, a report error records its scope and kind in `errors[]`.

Links: [Exit codes](/ambercast/reference/exit-codes/#priority), [Operating contract](/ambercast/agents/operating-contract/#next-action-by-exit-code)
