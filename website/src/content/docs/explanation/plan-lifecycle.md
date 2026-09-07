---
title: Plan lifecycle and freshness
description: Understand artifact provenance, plan freshness decisions, and grounding companion bindings when evaluating whether an artifact can be replayed.
---

When you decide whether an artifact can be replayed, you evaluate its provenance and freshness. In ambercast, plan freshness reflects whether an artifact matches the exact inputs that produced it, tracked through `inputsDigest`.

## Provenance inputs {#provenance-inputs}

At the core of plan provenance is `inputsDigest`. This value is the SHA-256 hash of canonical JSON containing normalized prompt text, the Plan schema version, the generator-template fingerprint, the producer-bundle fingerprint (`producerBundleFingerprint`), and named target definitions.

Tracking these inputs together means that plan freshness is not determined by prompt text alone. A schema or generator-template change makes an existing plan stale even if its prompt and targets have not changed. Furthermore, the producer-bundle fingerprint is independent of the template fingerprint because a producer-contract change can alter generation while prompt, schema, and template bytes remain unchanged.

Links: [Freshness and digests](/ambercast/spec/freshness/#inputs-digest), [Configuration](/ambercast/reference/configuration/#targets), [Compatibility](/ambercast/reference/compatibility/)

## Fresh-plan decision {#fresh-plan-decision}

To determine whether a plan is fresh, `check` derives current provenance from normalized prompt text and selected target definitions, then compares it with `plan.source.inputsDigest`.

A matching digest produces `fresh`. A mismatch produces `stale` with a reason that the plan is stale for the current prompt or target.

Structural and semantic validity are required alongside matching provenance. Invalid JSON, schema failure, noncanonical serialization, or invalid instruction coverage also produce `stale` rather than a trustworthy fresh result.

Links: [ambercast check](/ambercast/reference/cli/check/#results), [Recover stale artifacts](/ambercast/how-to/recover-stale-artifacts/#stale)

## Grounding binding and one-to-one correspondence {#grounding-binding}

A fresh plan and a valid replay companion represent distinct artifact states tied by a specific binding. `planDigest` hashes replay-relevant plan content while excluding `generatorMeta`. Grounding is current only when its recorded `planDigest` equals the computed plan digest.

When inspecting a fresh plan, `check` reports `missing-grounding`, `invalid-grounding`, or `stale-grounding` when the grounding companion is respectively absent, invalid, or bound to another plan.

Repository configuration contextualizes missing companions. When repository policy is `uncommitted`, a fresh plan without valid grounding is reported as `fresh-without-grounding`, not as a plan-freshness failure.

To maintain artifact integrity, `check` scans companion artifacts inversely. It reports an artifact with no corresponding test as `orphaned-plan` or `orphaned-grounding`, and it reports an inverse-incapable name as `invalid-artifact-name`.

Links: [Grounding document](/ambercast/spec/grounding-document/#plan-digest), [Reports](/ambercast/reference/reports/#check-results)

## What freshness hands off {#freshness-handoff}

Freshness inspection maintains strict functional boundaries. `check` uses read-only storage plus layout and discovery dependencies; its dependency contract exposes no AI executor, browser driver, secrets, clock, or event port.

This boundary isolates provenance assessment from runtime state. A fresh plan is a provenance conclusion, while grounding inspection adds replay-cache lifecycle evidence without redefining plan freshness.

Subsequent execution steps manage downstream drift independently. Drift during replay is a separate runtime condition: element fingerprint resolution can classify a `fingerprint-mismatch`, which is handed to replay fallback or healing rather than changing `inputsDigest`.

Links: [Replay and grounding](/ambercast/explanation/replay-and-grounding/#drift-handoff), [Healing model](/ambercast/explanation/healing-model/#three-stages), [Operating contract](/ambercast/agents/operating-contract/#command-contract)
