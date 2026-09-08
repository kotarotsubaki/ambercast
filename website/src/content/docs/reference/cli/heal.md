---
title: ambercast heal
description: Command-line reference for ambercast heal, defining flags, repair execution boundaries, authorization, and side effects.
---

The `ambercast heal` command repairs test plans and Grounding companions, providing options to discover or select prompts, measure repairs without writing changes, and manage authorization boundaries.

## Flags {#flags}

| Flag | Value | Effect | Default |
| --- | --- | --- | --- |
| `files` | path[] | literal prompts; absent selects discovery | discovery |
| `--dry-run` | boolean | measures repair without committing buffered Plan or Grounding changes | false |
| `--yes, -y` | boolean | authorizes non-interactive commit | false |
| `--target` | name | select target | omitted |
| `--ai` | claude\|codex | provider override | omitted |
| `--allow-empty` | boolean | allow empty selection | false |
| `--list` | boolean | list without healing | false |
| `--json` | boolean | JSON envelope | false |
| `--no-color` | boolean | disable ANSI | false |

## Repair model {#repair-model}

A completed repair result distinguishes `healed`, `partially-healed`, `unresolved`, and `no-changes-needed`; each has constrained `application` and `stopReason` values.

Heal first repairs Grounding, then attempts single-step or tail repair, and finally performs full-plan repair when needed; Stage 3 resolves an AI executor and calls generation, so it can dispatch a real provider.

## Limits {#limits}

- `heal.maxStepRepairs`, when set, is a positive hard limit on real incremental repair provider dispatches, including element confirmation and excluding cache-only baseline and Stage 3.
- `heal.caseTimeoutMs` is a positive case-wide admission deadline; its resolved default is 300000 ms.

## Confirmation {#confirmation}

Unless `--dry-run`, eligible repair artifacts are committed only after authorization; `--yes` provides non-interactive authorization.

## CI {#ci}

Except for `--list`, healing in CI is rejected unless `ci.heal` is true.

## Preconditions and writes {#preconditions}

Except for `--list`, the selected target must be idempotent; the default target is stateful.

Plan and Grounding companion writes are buffered until authorized settlement, but each measurement may write attempt evidence through runsDir-contained storage; this side effect can occur before authorization and during `--dry-run`.

Process-code values and their priority are owned by [Exit codes](/ambercast/reference/exit-codes/#aggregation-priority).

Links: [Configuration](/ambercast/reference/configuration/#grounding), [Reports](/ambercast/reference/reports/#heal-results), [Exit codes](/ambercast/reference/exit-codes/#exit-code-table), [File layout](/ambercast/reference/file-layout/#run-artifacts).
