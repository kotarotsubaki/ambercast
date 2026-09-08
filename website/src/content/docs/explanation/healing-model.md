---
title: Healing model
description: Understand bounded escalation and human control in ambercast's self-healing workflow.
---

Healing in ambercast operates through bounded escalation and explicit human control. Before repair work starts, healing evaluates target isolation and environment settings to determine whether an attempt is permitted to run.

## A safe precondition {#safe-precondition}

A selected target must resolve with `healReplayIsolation: "idempotent"`; healing against a non-idempotent target is rejected before browser or provider work starts. The configuration boundary permits `idempotent` or `stateful`, but loading supplies the conservative `stateful` default.

In automated test runs, a real heal attempt is refused in CI unless `ci.heal` is enabled. List mode bypasses that refusal because it has no primary effect.

Links: [ambercast heal](/ambercast/reference/cli/heal/#preconditions), [Configuration](/ambercast/reference/configuration/#targets), [Determinism in CI](/ambercast/explanation/determinism-in-ci/#heal-refusal)

## Three-stage escalation {#three-stages}

When responding to test drift, healing moves in order from cached evidence to broader regeneration. Healing first measures a cache-only replay baseline, then attempts a non-cache-only measurement only when that baseline has a failure.

When that baseline fails, repair escalates across three stages:

Stage 1 attempts grounding repair at the first failing frontier; advancing the frontier records either element regrounding or AI retracing.

Stage 2 attempts a structured single-step/tail repair only if Stage 1 did not advance the failure frontier.

Stage 3 attempts full-plan repair only when a failure remains and the case did not stop at its deadline.

Links: [ambercast heal](/ambercast/reference/cli/heal/#repair-model), [Steps](/ambercast/spec/steps/), [Replay and grounding](/ambercast/explanation/replay-and-grounding/#drift-handoff)

## Budgets bound incremental repair {#repair-budgets}

Explicit budgets restrict the scope of repair attempts so work remains bounded.

The configuration key `heal.maxStepRepairs` is an optional positive integer configuration value. When a healing case runs, it creates its dispatch budget with `maxStepRepairs` or `Infinity` when the value is unset.

Time limits run concurrently with dispatch limits. The setting `heal.caseTimeoutMs` is a positive integer and establishes a case-wide admission deadline before the baseline replay. The timeout prevents new repair phases or dispatches from starting; it does not interrupt in-flight work or invalidate an already-produced commit.

Links: [Configuration](/ambercast/reference/configuration/#heal), [ambercast heal](/ambercast/reference/cli/heal/#limits)

## Confirmation separates measurement from writes {#confirmation-and-writes}

Proposed repairs remain reviewable because ambercast separates measurement from writes. Each case accumulates candidate artifacts in a private overlay; the returned commit capability is the only route to real artifact writes.

Confirmation happens after measurement but before the first commit, so the prompt can describe pending files and repair kinds without a write preceding consent.

Command-line flags define how this boundary operates across interactive and automated environments:

`--dry-run` never prompts or commits; `--yes` is pre-authorization for the confirmation boundary, not a substitute for an agent's user authorization. Without `--yes`, a non-interactive caller receives a configuration error instead of an implicit write.

Links: [ambercast heal](/ambercast/reference/cli/heal/#confirmation), [Operating contract](/ambercast/agents/operating-contract/#command-contract), [Review generated diffs](/ambercast/how-to/review-generated-diffs/)
