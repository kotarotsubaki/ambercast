---
title: Healing model
description: Explains how far ambercast repairs a test automatically when a UI change breaks it, and where it hands off to your judgment.
---

When you change your app's UI, a previously passing test can suddenly fail. A moved element or a changed button label is a typical cause.

ambercast's healing feature investigates the cause of a failure automatically and tries to repair the test. It never runs unbounded: every run has a time budget, and writing to a file always waits for your confirmation first.

## Safe precondition {#safe-precondition}

Healing accesses your running app and tries different fixes to find one that works. If the app doesn't reset to the same state no matter how many times you access it, repeated attempts risk piling up data or corrupting the app's state.

ambercast therefore refuses to heal unless your config declares the target with `healReplayIsolation: "idempotent"` — safe to replay repeatedly. It stops before it opens a browser or calls an AI provider. Omit the declaration, and it defaults to the safer `stateful` value — state changes on each replay — where healing still refuses to run.

In CI, nobody watches the result as it happens, so healing doesn't run unless you enable the `ci.heal` setting. The mode that only lists what it could fix makes no real change to your app, so it runs without that restriction.

Related: [ambercast heal](/ambercast/reference/cli/heal/#preconditions), [Configuration](/ambercast/reference/configuration/#targets), [Determinism in CI](/ambercast/explanation/determinism-in-ci/#heal-refusal)

## Three-stage escalation {#three-stages}

Healing first replays the test the normal way, without calling an AI provider, to confirm the failure actually reproduces. If it doesn't reproduce, healing stops there and makes no repair. Only a reproduced failure moves on to the three stages below.

<div class="heal-stages">
<style>
.heal-stages {
  --ground: #FAF6F0; --surface: #FFFDFA; --line: #E2D9CC; --text: #27211C; --muted: #766B60;
  --amber: #A65C1F; --amber-soft: #FCF5EB; --verdigris: #2E7D5B; --verdigris-soft: rgba(46, 125, 91, .08);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .heal-stages {
    --ground: #181310; --surface: #27211C; --line: #3B332C; --text: #F1EBE2; --muted: #9E9184;
    --amber: #DB9140; --amber-soft: rgba(219,145,64,.14); --verdigris: #7FC8A9; --verdigris-soft: rgba(127,200,169,.12);
  }
}
:root[data-theme="dark"] .heal-stages {
  --ground: #181310; --surface: #27211C; --line: #3B332C; --text: #F1EBE2; --muted: #9E9184;
  --amber: #DB9140; --amber-soft: rgba(219,145,64,.14); --verdigris: #7FC8A9; --verdigris-soft: rgba(127,200,169,.12);
}
.heal-stages { margin: 1.5rem 0; }
.heal-stages figure { margin: 0 auto; max-width: 560px; display: grid; }
.heal-stages .node { border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; background: var(--surface); display: grid; gap: 8px; }
.heal-stages .node.stage { border-color: var(--amber); }
.heal-stages .top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 12px; }
.heal-stages .num { font: 600 11.5px/1 ui-monospace, "JetBrains Mono", monospace; letter-spacing: .08em; color: var(--muted); }
.heal-stages .stage .num { color: var(--amber); }
.heal-stages h3 { margin: 0; font: 700 16px/1.35 system-ui, "Noto Sans JP", sans-serif; letter-spacing: -.01em; color: var(--text); }
.heal-stages p { margin: 0; color: var(--text); }
.heal-stages .chip { display: inline-flex; align-items: center; gap: 6px; font: 500 11px/1 ui-monospace, monospace; letter-spacing: .04em; padding: 5px 8px; border-radius: 999px; border: 1px solid currentColor; white-space: nowrap; }
.heal-stages .chip::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.heal-stages .chip.ai { color: var(--amber); background: var(--amber-soft); }
.heal-stages .chip.replay { color: var(--verdigris); background: var(--verdigris-soft); }
.heal-stages .scope { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 10px; }
.heal-stages .track { height: 6px; border-radius: 3px; background: var(--line); overflow: hidden; }
.heal-stages .fill { height: 100%; background: var(--amber); }
.heal-stages .scope span { font: 500 11px/1.3 ui-monospace, monospace; color: var(--muted); white-space: nowrap; }
.heal-stages .aside { font-size: 13px; color: var(--muted); }
.heal-stages .link { display: grid; grid-template-columns: 28px 1fr; align-items: center; gap: 10px; padding-left: 18px; min-height: 56px; }
.heal-stages .link svg { width: 28px; height: 44px; color: var(--muted); }
.heal-stages .link.up svg { color: var(--amber); }
.heal-stages .link span { font-size: 13px; color: var(--muted); }
.heal-stages .link b { color: var(--text); font-weight: 700; }
@media (max-width: 420px) { .heal-stages .scope { grid-template-columns: 1fr; gap: 6px; } }
</style>
<figure aria-label="heal's three-stage escalation. A failure at the baseline replay moves to stage 1; if stage 1's failure point doesn't advance, move to stage 2; if a failure remains before the deadline, move to stage 3.">

<div class="node"><div class="top"><span class="num">BASELINE</span><span class="chip replay">No AI calls</span></div><h3>Replay the baseline fail-closed</h3><p class="aside">No failure means healing ends without a repair</p></div>

<div class="link" aria-hidden="true"><svg viewBox="0 0 28 52" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2v46M8 42l6 6 6-6"></path></svg><span><b>On a failure</b>, re-measure with resolution enabled</span></div>

<div class="node stage"><div class="top"><span class="num">STAGE 1</span><span class="chip ai">May call AI</span></div><h3>Fix the grounding</h3><div class="scope"><div class="track"><div class="fill" style="width:22%"></div></div><span>the first failed point</span></div><p>Healing re-locates the element at the failed point. If the point advances, it logs the fix as either re-grounding the element or an AI re-trace.</p></div>

<div class="link up" aria-hidden="true"><svg viewBox="0 0 28 52" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2v46M8 42l6 6 6-6"></path></svg><span><b>If the failed point doesn't advance</b></span></div>

<div class="node stage"><div class="top"><span class="num">STAGE 2</span><span class="chip ai">May call AI</span></div><h3>Fix one step or the rest</h3><div class="scope"><div class="track"><div class="fill" style="width:55%"></div></div><span>a single step or the tail</span></div><p>Healing fixes the one failed step, or that step and every step after it together.</p></div>

<div class="link up" aria-hidden="true"><svg viewBox="0 0 28 52" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2v46M8 42l6 6 6-6"></path></svg><span><b>If a failure remains before the deadline</b></span></div>

<div class="node stage"><div class="top"><span class="num">STAGE 3</span><span class="chip ai">May call AI</span></div><h3>Rebuild the whole plan</h3><div class="scope"><div class="track"><div class="fill" style="width:100%"></div></div><span>the whole plan</span></div><p>Healing resolves an AI executor, calls generate, and rebuilds the whole plan.</p></div>

</figure>
</div>

Healing tries the lightest fix first and escalates only when needed, to avoid unnecessary AI calls and cost.

Related: [ambercast heal](/ambercast/reference/cli/heal/#repair-model), [Steps](/ambercast/spec/steps/), [Replay and grounding](/ambercast/explanation/replay-and-grounding/#drift-handoff)

## Budgets that limit repair count and time {#repair-budgets}

You can set two kinds of limits so healing doesn't keep trying forever.

- `heal.maxStepRepairs`: the limit on how many step repairs a single healing run attempts. Set it as a positive integer; omit it and there is no limit.
- `heal.caseTimeoutMs`: the time limit, in milliseconds, for the whole healing run. ambercast fixes this deadline before the first replay starts. Past the deadline, it starts no new repair, but it doesn't force-stop work already in progress or discard a repair already produced.

Related: [Configuration](/ambercast/reference/configuration/#heal), [ambercast heal](/ambercast/reference/cli/heal/#limits)

## Always confirm before writing {#confirmation-and-writes}

Finding a repair doesn't change any project file yet. Healing holds each candidate repair in a temporary location, and only writes it to the real file after you review and approve it.

This lets you see exactly which file changes, and how, before the write happens.

:::caution
Passing `--dry-run` skips the confirmation prompt and shows you the result only — it writes no file. `--yes` only skips the CLI's confirmation message; it doesn't by itself mean you approved the change.

When an agent runs ambercast without `--yes` and without a way to confirm interactively, ambercast stops with an error instead of writing silently.

:::

Related: [ambercast heal](/ambercast/reference/cli/heal/#confirmation), [Operating contract](/ambercast/agents/operating-contract/#command-contract), [Review generated diffs](/ambercast/how-to/review-generated-diffs/)
