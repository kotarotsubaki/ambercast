---
title: Introduction
description: Understand ambercast's prompt-driven workflow, generating deterministic test plans and grounding artifacts that replay with 0 AI calls and repair deliberate UI drift.
---

ambercast compiles natural-language test prompts into deterministic plan and grounding artifacts, enabling test replays and deliberate drift repair while preserving prompt content and schema authority across your test suite.

## What ambercast preserves {#what-ambercast-preserves}

To maintain provenance, prompt normalization changes only one leading BOM and CR/CRLF line endings, preserving all other content.

For the committed plan and grounding artifacts, Zod IR schemas serve as the runtime authority, and JSON Schema is derived directly from them.

## The generate, run, heal cycle {#generate-run-heal-cycle}

The workflow cycle moves through generation, replay, and repair. A normalized prompt serves as the input to generation, where `ambercast generate` composes a lazy AI executor to write companion paths derived from the test file. Running `ambercast run` executes the derived artifacts; fully grounded replay does not require an available provider and operates with `0 AI calls` on a grounding hit, resolving a provider only through its fallback port. If a failure occurs and repair is needed, you can explicitly choose to invoke `ambercast heal`, where the heal runtime owns confirmation and commit composition before an authorized update writes back to the companions.

Accessibility text alternative: “A directed loop: a prompt becomes plan and grounding companions; run either replays them without provider resolution on a grounding hit or, after a failure, lets the user explicitly choose the separate heal command; an authorized heal updates the companions.”

Nodes:
- `SIGN-IN.TEST.MD · PROMPT` — A normalized prompt is generation input.
- `GENERATE · AI WHEN NEEDED` — Generate composes a lazy AI executor.
- `PLAN + GROUNDING` — Companion paths derive from a `.test.md` path.
- `RUN · REPLAY` — Fully grounded replay does not require an available provider.
- `GROUNDING HIT · 0 AI CALLS` — Run resolves a provider through its fallback port.
- `HEAL · APPROVAL BEFORE WRITE` — Heal runtime owns confirmation and commit composition.

Edges:
- `prompt → generate` (`ambercast generate`)
- `generate → artifacts` (`write companions`)
- `artifacts → run` (`ambercast run`)
- `run → replay` (`grounding hit`)
- `run → heal` (`repair needed`)
- `heal → artifacts` (`authorized update`)

## The three files {#three-files}

ambercast structures tests around an authored prompt and two paired derived artifacts. Only exact terminal `.test.md` paths have companion mappings. When you generate from a prompt, it branches into two derived JSON companions stored adjacent to it: a plan file ending in `.ambercast.plan.json` and a grounding file ending in `.ambercast.grounding.json`.

Accessibility text alternative: “One authored prompt branches to two adjacent derived JSON companions: a plan and grounding.”

Nodes:
- `PROMPT · <name>.test.md` — Only exact terminal `.test.md` paths have companion mappings.
- `PLAN · <name>.ambercast.plan.json` — The plan suffix is `.ambercast.plan.json`.
- `GROUNDING · <name>.ambercast.grounding.json` — The grounding suffix is `.ambercast.grounding.json`.

Edges:
- `prompt-file → plan-file` (`generate`)
- `prompt-file → grounding-file` (`generate`)
- `plan-file ↔ grounding-file` (`paired derived artifacts`)

## AI-call ledger {#ai-call-ledger}

Provider interaction is explicitly budgeted across every phase of the lifecycle. Generation receives a lazy AI-executor resolver, invoking a provider as needed to produce committed companions. During replay, run resolves a provider only through its fallback port, achieving `0 AI calls` when grounded. When repair is needed, heal maintains separate confirmation and persistence composition, requiring explicit authorization before updating companions and returning to replay.

Accessibility text alternative: “Provider work is shown during generation, zero provider work for a fully grounded replay, and explicit confirmation around repair.”

Nodes:
- `GENERATE · PROVIDER AS NEEDED` — Generation receives a lazy AI-executor resolver.
- `REPLAY · 0 AI CALLS WHEN GROUNDED` — Run resolves a provider only through its fallback port.
- `HEAL · EXPLICIT REPAIR` — Heal has separate confirmation and persistence composition.

Edges:
- `generate → replay` (`committed companions`)
- `replay → heal` (`repair needed`)
- `heal → replay` (`authorized update`)

## Next {#next}

Links:
- [Your first test in 5 minutes](/ambercast/tutorials/quick-start/)
- [Philosophy](/ambercast/philosophy/)
- [File layout](/ambercast/reference/file-layout/)
- [ambercast generate](/ambercast/reference/cli/generate/)
- [ambercast run](/ambercast/reference/cli/run/)
- [ambercast heal](/ambercast/reference/cli/heal/)
