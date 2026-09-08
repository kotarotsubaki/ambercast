---
title: Replay and grounding
description: Explain replay paths and their safety boundary.
---

Replay paths and their safety boundaries govern how test execution consumes cached grounding data. During a run, ambercast consumes grounding for AI steps and element-grounding step variants, allowing covered and valid AI traces to replay without resolving an AI executor.

## Grounding as replay evidence {#grounding-as-replay-evidence}

Run consumes grounding for AI steps and element-grounding step variants; navigation, text-visible, URL-match, and element-count variants have no grounding lookup. In an AI-directed replay, a covered, valid AI trace can replay without resolving an AI executor.

Element grounding stores an accessibility fingerprint, and resolution compares the stored algorithm and hash with a fresh fingerprint for the matched node. The resolver distinguishes a hit from `fingerprint-mismatch`, `element-not-found`, `ambiguous-match`, and `snapshot-invalid`; a mismatch is not treated as a hit.

Links: [Grounding document](/ambercast/spec/grounding-document/), [Element fingerprint](/ambercast/spec/fingerprint/), [ambercast run](/ambercast/reference/cli/run/#ai-calls)

## Replay path: grounding hit {#grounding-hit}

A covered-valid AI trace replays before any lazy agentic fallback is selected. A successful element classification supplies its stored fingerprint to the replay context rather than requesting a new live resolution.

The run pipeline is designed so a complete cache can execute without probing a provider.

Links: [ambercast run](/ambercast/reference/cli/run/#replay), [Determinism in CI](/ambercast/explanation/determinism-in-ci/#bounded-side-effects)

## Replay path: miss with fallback {#miss-with-ai-fallback}

Absent grounding, stale provenance, invalid JSON, and cache misses are classified before the lazy agentic fallback. A fallback begins only after the miss path; cache hits emit no AI-call event.

When cache-only mode is not enabled, an element grounding miss can resolve live and update the grounding entry with the resolved element fingerprint.

Links: [ambercast run](/ambercast/reference/cli/run/#grounding-write-back), [Control grounding write-back](/ambercast/how-to/control-grounding-writeback/)

## Replay path: cache-only miss {#cache-only-miss}

`--cache-only` suppresses both cold-start and recoverable-miss AI fallback. During an AI-directed replay, an AI-directed step with no usable trace aborts when cache-only mode is enabled.

An element grounding miss aborts in cache-only mode instead of resolving the element live.

Links: [ambercast run](/ambercast/reference/cli/run/#cache-only), [Reading structured output](/ambercast/agents/reading-structured-output/#decision-tree)

## Drift hand-off {#drift-handoff}

A `fingerprint-mismatch` means a matched node's current accessibility fingerprint differs from the stored fingerprint. The run use case records `fingerprint-mismatch` as a classification case distinct from a successful grounded resolution.

Healing starts with a cache-only baseline replay, then can attempt grounding repair when a failure remains.

Links: [Healing model](/ambercast/explanation/healing-model/#three-stages), [Healing a test after a UI change](/ambercast/tutorials/repair-your-first-drift/)
