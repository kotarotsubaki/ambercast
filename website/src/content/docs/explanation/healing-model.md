---
title: Healing model
description: Explains how far ambercast repairs a test automatically when a UI change breaks it, and where it hands off to your judgment.
---

When you change your app's UI, a previously passing test can suddenly fail. A moved element or a changed button label is a typical cause.

ambercast's healing feature investigates the cause of a failure automatically and tries to repair the test. It never runs unbounded: each case has a time budget, and changes to the Plan and Grounding files are written only after your confirmation.

## Safe precondition {#safe-precondition}

Healing accesses your running app and tries different fixes to find one that works. If the app doesn't reset to the same state no matter how many times you access it, repeated attempts risk piling up data or corrupting the app's state.

ambercast therefore refuses to heal unless your config declares the target with `healReplayIsolation: "idempotent"` — safe to replay repeatedly. It stops before it opens a browser or calls an AI provider. Omit the declaration, and it defaults to the safer `stateful` value — state changes on each replay — where healing still refuses to run.

In CI, nobody watches the result as it happens, so healing doesn't run unless you enable the `ci.heal` setting. The mode that only lists what it could fix makes no real change to your app, so it runs without that restriction.

Related: [ambercast heal](/ambercast/reference/cli/heal/#preconditions), [Configuration](/ambercast/reference/configuration/#targets), [Determinism in CI](/ambercast/explanation/determinism-in-ci/#heal-refusal)

## Three-stage escalation {#three-stages}

Healing first replays the test the normal way, without calling an AI provider, to confirm the failure actually reproduces. If it doesn't reproduce, healing stops there and makes no repair.

When the failure reproduces, healing re-measures with resolution enabled. If every step then passes, healing ends without a repair. Only a remaining failure, when a repair can start, moves on to the three stages below.

<figure class="ac-flow" aria-label="heal's three-stage escalation. The baseline replay ends healing without a repair when nothing fails. On a failure, re-measure with resolution enabled; if every step then passes, healing ends without a repair. If a failure remains and a repair can start, stage 1 fixes the grounding at the first failed point. If the failed point doesn't advance, stage 2 fixes one step or the tail. If a failure remains before the deadline, stage 3 rebuilds the whole plan; past the deadline, healing starts no new repair. Plan and Grounding writes happen only after confirmation.">
<div class="ac-flow-node"><div class="ac-flow-head"><span class="ac-flow-num">BASELINE</span><span class="ac-flow-chip ac-flow-chip-replay">No AI calls</span></div><p class="ac-flow-title">Replay the baseline fail-closed</p><p class="ac-flow-note">No failure means healing ends without a repair</p></div>
<div class="ac-flow-link"><svg aria-hidden="true" viewbox="0 0 28 52" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2v46M8 42l6 6 6-6"></path></svg><span class="ac-flow-cond"><b>On a failure</b>, re-measure with resolution enabled</span></div>
<div class="ac-flow-node ac-flow-stage"><div class="ac-flow-head"><span class="ac-flow-num">STAGE 1</span><span class="ac-flow-chip ac-flow-chip-ai">May call AI</span></div><p class="ac-flow-title">Fix the grounding</p><div class="ac-flow-meter ac-flow-meter-s"><div class="ac-flow-track"><div class="ac-flow-fill"></div></div><span>the first failed point</span></div><p class="ac-flow-body">Healing re-locates the element at the failed point. If the point advances, it logs the fix as either re-grounding the element or an AI re-trace.</p></div>
<div class="ac-flow-link ac-flow-link-stage"><svg aria-hidden="true" viewbox="0 0 28 52" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2v46M8 42l6 6 6-6"></path></svg><span class="ac-flow-cond"><b>If the failed point doesn't advance</b></span></div>
<div class="ac-flow-node ac-flow-stage"><div class="ac-flow-head"><span class="ac-flow-num">STAGE 2</span><span class="ac-flow-chip ac-flow-chip-ai">May call AI</span></div><p class="ac-flow-title">Fix one step or the rest</p><div class="ac-flow-meter ac-flow-meter-m"><div class="ac-flow-track"><div class="ac-flow-fill"></div></div><span>a single step or the tail</span></div><p class="ac-flow-body">Healing fixes the one failed step, or that step and every step after it together.</p></div>
<div class="ac-flow-link ac-flow-link-stage"><svg aria-hidden="true" viewbox="0 0 28 52" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2v46M8 42l6 6 6-6"></path></svg><span class="ac-flow-cond"><b>If a failure remains before the deadline</b></span></div>
<div class="ac-flow-node ac-flow-stage"><div class="ac-flow-head"><span class="ac-flow-num">STAGE 3</span><span class="ac-flow-chip ac-flow-chip-ai">May call AI</span></div><p class="ac-flow-title">Rebuild the whole plan</p><div class="ac-flow-meter ac-flow-meter-l"><div class="ac-flow-track"><div class="ac-flow-fill"></div></div><span>the whole plan</span></div><p class="ac-flow-body">Healing resolves an AI executor, calls generate, and rebuilds the whole plan.</p></div>
</figure>

Healing tries the lightest fix first and escalates only when needed, to avoid unnecessary AI calls and cost.

Related: [ambercast heal](/ambercast/reference/cli/heal/#repair-model), [Steps](/ambercast/spec/steps/), [Replay and grounding](/ambercast/explanation/replay-and-grounding/#drift-handoff)

## Budgets that limit repair count and time {#repair-budgets}

You can set two kinds of limits so healing doesn't keep trying forever.

- `heal.maxStepRepairs`: the limit on AI dispatches during stage 1 and stage 2 repair, charged at dispatch time. Stage 3 still calls AI but doesn't count against this limit. Set it as a positive integer; omit it and there is no limit.
- `heal.caseTimeoutMs`: the time limit, in milliseconds, for healing one case. ambercast fixes each case's deadline before that case's first replay starts. When you select several tests, the whole command can take longer than this value. Past the deadline, it starts no new repair, but it doesn't force-stop work already in progress or discard a repair already produced.

Related: [Configuration](/ambercast/reference/configuration/#heal), [ambercast heal](/ambercast/reference/cli/heal/#limits)

## Plan and Grounding writes wait for confirmation {#confirmation-and-writes}

Finding a repair doesn't change the Plan or Grounding file yet. Healing holds each candidate repair in a temporary location, and only writes it to the real file after you review and approve it.

This lets you see exactly which file changes, and how, before the write happens.

:::caution
Passing `--dry-run` skips the confirmation prompt and never commits a Plan or Grounding change, but a replay attempt can still write evidence under the runs directory. `--yes` pre-authorizes the CLI's confirmation prompt only; it isn't your own review and approval of the change.

When an agent runs ambercast without `--yes` and without a way to confirm interactively, ambercast stops with an error instead of writing silently.

:::

Related: [ambercast heal](/ambercast/reference/cli/heal/#confirmation), [Operating contract](/ambercast/agents/operating-contract/#command-contract), [Review generated diffs](/ambercast/how-to/review-generated-diffs/)
