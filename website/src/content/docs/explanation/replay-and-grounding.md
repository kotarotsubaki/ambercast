---
title: Replay and grounding
description: Replay reuses recorded grounding, so a fully covered run needs no AI call, and a miss either fails closed or is resolved live only with `--resolve`.
---

Replay reuses what ambercast recorded. Where the record is missing or unusable, replay stops unless you opt in to live resolution.

## Grounding as replay evidence {#grounding-as-replay-evidence}

`run` consumes grounding for `ai` steps and for element-binding steps: click, press, fill, fill-secret, and capture. Navigation and every assertion check the live page directly, without a grounding lookup.

An element entry stores a locator, a fingerprint, an intent digest, and provenance. Resolution uses the stored locator and checks the fingerprint. The [Grounding document](/ambercast/spec/grounding-document/) defines the entry shape.

The resolver tells a hit apart from `fingerprint-mismatch`, `element-not-found`, `ambiguous-match`, `snapshot-invalid`, and `secret-contaminated`. Saved ignored slots permit the bounded match described below. When ambercast computes or re-resolves an element, `snapshot-invalid` and `secret-contaminated` abort the case. During a stored-entry wait, `snapshot-invalid` is a miss that is retried until the step deadline. Stored-entry verification does not return `secret-contaminated`.

Replay then follows one of four paths:

- A valid entry replays with zero AI calls.
- An integrity failure fails closed, whether or not you pass `--resolve`.
- A recoverable miss with `--resolve` is resolved live.
- A recoverable miss without `--resolve` stops with `GROUNDING_UNRESOLVED` (exit 4).

An element entry counts as a miss only if it still does not match at the step deadline. See [Waiting for a page to change](#stored-entry-wait).

Related: [Grounding document](/ambercast/spec/grounding-document/), [Element fingerprint](/ambercast/spec/fingerprint/), [ambercast run](/ambercast/reference/cli/run/#ai-calls)

## When grounding hits {#grounding-hit}

A covered, valid AI trace replays without resolving an AI executor. Replay takes this path before it considers any agentic fallback.

When an element resolves as a hit, replay uses the complete fingerprint observed in this run and requests no new resolution. A complete cache runs without probing a provider, and a hit emits no AI-call event.

Related: [ambercast run](/ambercast/reference/cli/run/#replay), [Determinism in CI](/ambercast/explanation/determinism-in-ci/#bounded-side-effects)

## A miss with explicit resolution {#miss-with-explicit-resolution}

Grounding that fails its integrity checks fails closed even with `--resolve`. Invalid JSON and a failed coverage or verification proof are examples.

`--resolve` applies to two cases: grounding that is absent, and entries that are structurally valid but recoverable. Grounding written by a retired format version is one of the recoverable cases. For a plan with element-binding steps, `run` reports it as `GROUNDING_UNRESOLVED` without `--resolve`, and `run --resolve --update-cache` regenerates it.

With `--resolve`, an element miss is resolved live. At least one step must list the action in `confirms` to confirm it during the case. ambercast prepares its entry for saving when all such steps pass with a valid confirmation basis.

When every step in the case passes, ambercast also prepares the remaining click, press, fill, fill-secret, and capture entries. This includes actions absent from `confirms` and actions whose `element-visible` assertions matched multiple candidates.

If a case fails or is interrupted before completion, only element entries confirmed through `confirms` qualify for saving. Writing the file requires permission from the write-back gate. The gate depends on `localWriteBack`, `--update-cache`, and `ci.updateGroundingCache`.

After the case passes and grounding is saved successfully, the same plan can replay from the same page state without AI calls. An `ai` step still creates an entry only when it passes with recorded verification. An `ai` step that passes without that record still needs `--resolve` on replay.

Related: [ambercast run](/ambercast/reference/cli/run/#grounding-write-back), [Control grounding write-back](/ambercast/how-to/control-grounding-writeback/)

## A miss without resolution {#unresolved-miss}

Without `--resolve`, `run` resolves neither a cold-start miss nor a recoverable miss live. During an AI-directed replay, an `ai` step with no usable trace fails closed as `grounding-unresolved` (exit 4) and points to `--resolve`.

An element miss fails closed in the same way, with exit 4, instead of resolving the element live.

Related: [ambercast run](/ambercast/reference/cli/run/#resolve), [Reading structured output](/ambercast/agents/reading-structured-output/#decision-tree)

## Waiting for a page to change {#stored-entry-wait}

When a stored element entry does not match the page, ambercast does not treat the first failed check as a miss. After a miss it waits at most 100 ms and checks again, until the entry matches or the step deadline passes. The check itself takes additional time.

The deadline is the step start plus the target's `resolveTimeoutMs`. So a step still replays without an AI call while the previous step's action is still changing the page, provided the entry matches once the page has changed.

Waiting does not change what counts as a match. ambercast applies the same matching rule as without waiting, including any saved ignored slots, and never acts on an element that does not match.

If the entry still does not match at the deadline, the step is a miss. Without `--resolve` it stops with `GROUNDING_UNRESOLVED` (exit 4), and with `--resolve` ambercast resolves the element live.

A step whose page really changed therefore also waits for the rest of the deadline before it stops or re-resolves. A larger `resolveTimeoutMs`, up to `60000`, lengthens that wait. With `0`, ambercast checks once.

Two limits apply. First, the fingerprint covers the target, its parent, and its adjacent siblings by role and name. It does not identify the page or the record.

If the page being left shows the same roles and names around a same-named element while ambercast waits, that element matches and ambercast acts on it. When this matters, add an `assert` step before the action that checks something only the new page shows. The assertion polls until the step deadline, so the action runs only after the new page appears.

Second, a page that changes later than the deadline stops a replay without `--resolve`; raise `resolveTimeoutMs` for that target. With `--resolve`, ambercast re-resolves from the page as it is at the deadline, which can still be the page being left.

## Text that changes between runs {#changing-neighbor-text}

With stored components and unchanged target and structure, neighboring text changing between runs stops zero-AI replay once.
Rerun `ambercast run --resolve`; once ambercast writes the result back, changes to the neighboring text that differed when ambercast re-resolved the element no longer stop it.
This covers only that cause: a stop from another cause can still happen.
This applies to targets with or without an accessible name.

Groundings written before v5 lack components, so expect one extra stop: the first resolve rebuilds a strict entry with components; the next resolve adds ignored slots.

Structure changes, including neighboring elements appearing or disappearing, remain mismatches and are never relaxed. Replays without permission to resolve never add ignored slots. Immediately before acting, ambercast still compares the complete fingerprint from this run, including ignored names.

Check that the page shows the expected record before resolving a text change. The [report](/ambercast/reference/reports/#neighbor-name-warnings) identifies newly ignored slots and whether ambercast saved them.

## Handing drift over {#drift-handoff}

A `fingerprint-mismatch` means the current fingerprint of the matched element differs from the stored one. `run` records it as a classification of its own, distinct from a successful resolution.

Healing starts with a fail-closed baseline replay. It attempts a repair only when a failure remains.

Related: [Healing model](/ambercast/explanation/healing-model/#three-stages), [Healing a test after a UI change](/ambercast/tutorials/repair-your-first-drift/)
