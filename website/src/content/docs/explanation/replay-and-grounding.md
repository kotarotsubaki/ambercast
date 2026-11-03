---
title: Replay and grounding
description: Replay reuses recorded grounding, so a fully covered run needs no AI call, and a miss either fails closed or is resolved live only with `--resolve`.
---

Replay reuses what ambercast recorded. Where the record is missing or unusable, replay stops unless you opt in to live resolution.

## Grounding as replay evidence {#grounding-as-replay-evidence}

`run` consumes grounding for `ai` steps and for element-binding steps: click, press, fill, fill-secret, and capture. Navigation and every assertion check the live page directly, without a grounding lookup.

An element entry stores a locator, a fingerprint, an intent digest, and provenance. Resolution uses the stored locator and checks the fingerprint. The [grounding document](/ambercast/spec/grounding-document/) defines the entry shape.

The resolver tells a hit apart from `fingerprint-mismatch`, `element-not-found`, `ambiguous-match`, `snapshot-invalid`, and `secret-contaminated`. A mismatch is never treated as a hit. `snapshot-invalid` and `secret-contaminated` abort the case.

Replay then follows one of four paths:

- A valid entry replays with zero AI calls.
- An integrity failure fails closed, whether or not you pass `--resolve`.
- A recoverable miss with `--resolve` is resolved live.
- A recoverable miss without `--resolve` stops with `GROUNDING_UNRESOLVED` (exit 4).

Related: [Grounding document](/ambercast/spec/grounding-document/), [Element fingerprint](/ambercast/spec/fingerprint/), [ambercast run](/ambercast/reference/cli/run/#ai-calls)

## When grounding hits {#grounding-hit}

A covered, valid AI trace replays without resolving an AI executor. Replay takes this path before it considers any agentic fallback.

When an element resolves as a hit, replay passes the stored fingerprint along and requests no new resolution. A complete cache runs without probing a provider, and a hit emits no AI-call event.

Related: [ambercast run](/ambercast/reference/cli/run/#replay), [Determinism in CI](/ambercast/explanation/determinism-in-ci/#bounded-side-effects)

## A miss with explicit resolution {#miss-with-explicit-resolution}

Grounding that fails its integrity checks fails closed even with `--resolve`. Invalid JSON and a failed coverage or verification proof are examples.

`--resolve` applies to two cases: grounding that is absent, and entries that are structurally valid but recoverable. Grounding written by a retired format version is one of the recoverable cases. For a plan with element-binding steps, `run` reports it as `GROUNDING_UNRESOLVED` without `--resolve`, and `run --resolve --update-cache` regenerates it.

With `--resolve`, an element miss is resolved live. ambercast writes the entry only when every step that confirms the binding passes and the write-back gate allows it. The gate depends on `localWriteBack`, `--update-cache`, and `ci.updateGroundingCache`.

Related: [ambercast run](/ambercast/reference/cli/run/#grounding-write-back), [Control grounding write-back](/ambercast/how-to/control-grounding-writeback/)

## A miss without resolution {#unresolved-miss}

Without `--resolve`, `run` resolves neither a cold-start miss nor a recoverable miss live. During an AI-directed replay, an `ai` step with no usable trace fails closed as `grounding-unresolved` (exit 4) and points to `--resolve`.

An element miss fails closed in the same way, with exit 4, instead of resolving the element live.

Related: [ambercast run](/ambercast/reference/cli/run/#resolve), [Reading structured output](/ambercast/agents/reading-structured-output/#decision-tree)

## Handing drift over {#drift-handoff}

A `fingerprint-mismatch` means the current fingerprint of the matched element differs from the stored one. `run` records it as a classification of its own, distinct from a successful resolution.

Healing starts with a fail-closed baseline replay. It attempts a repair only when a failure remains.

Related: [Healing model](/ambercast/explanation/healing-model/#three-stages), [Healing a test after a UI change](/ambercast/tutorials/repair-your-first-drift/)
