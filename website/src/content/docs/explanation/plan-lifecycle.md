---
title: Plan lifecycle and freshness
description: A plan can be replayed only while it matches the inputs that produced it, and `check` decides that without running anything.
---

`check` judges freshness first. It inspects grounding only for a `fresh` plan, so a `stale` plan gets no grounding status.

## What a plan is built from {#provenance-inputs}

`inputsDigest` is a SHA-256 hash that records what a plan was built from. It covers canonical JSON that holds these inputs:

- The normalized prompt
- The plan schema version
- The generator-template fingerprint
- The producer-bundle fingerprint (`producerBundleFingerprint`)
- The definitions of the targets the plan references, which are the names in the plan's `targets`, sorted by name

Changing a target the plan does not reference changes neither the digest nor freshness. `executor` is not hashed.

With an unchanged prompt, a change to the schema, the template, or the producer contract still makes the plan stale. The producer-bundle fingerprint is separate from the template fingerprint because a contract change alone can change what generation produces.

Related: [Freshness and digests](/ambercast/spec/freshness/#inputs-digest), [Configuration](/ambercast/reference/configuration/#targets), [Compatibility](/ambercast/reference/compatibility/)

## How `check` decides freshness {#fresh-plan-decision}

`check` recomputes `inputsDigest` from the current prompt and the targets the plan references. It compares the result with `plan.source.inputsDigest`. A match gives `fresh`, and a mismatch gives `stale`.

A matching digest is not enough. A plan is also `stale` in each of these cases:

- The JSON is invalid.
- Schema validation fails.
- The serialization is not canonical.
- Instruction coverage is invalid.
- An element intent or a source span is invalid.
- The plan uses a retired `schemaVersion` (4).
- A target the plan references is missing from the configuration.

This keeps a broken plan from being reported as `fresh`.

Related: [ambercast check](/ambercast/reference/cli/check/#results), [Recover stale artifacts](/ambercast/how-to/recover-stale-artifacts/#stale)

## How grounding binds to a plan {#grounding-binding}

A `fresh` plan can still be unreplayable, because replay also needs grounding.

`planDigest` hashes the replay-relevant content of a plan, without `generatorMeta`. Grounding is current only when its recorded `planDigest` equals the one computed from the plan. Plan freshness and the grounding binding are judged separately.

`check` reports `missing-grounding` when grounding is absent, `invalid-grounding` when it is invalid, and `stale-grounding` when it is bound to another plan. When the repository policy is `uncommitted`, a `fresh` plan without valid grounding is reported as `fresh-without-grounding`. That is not a freshness failure.

`check` also scans in the opposite direction. An artifact with no matching test is reported as `orphaned-plan` or `orphaned-grounding`. A name that cannot be traced back to a test is reported as `invalid-artifact-name`.

Related: [Grounding document](/ambercast/spec/grounding-document/#plan-digest), [Reports](/ambercast/reference/reports/#check-results)

## What freshness hands off {#freshness-handoff}

`check` makes no AI call, launches no browser, and writes nothing. Its freshness answer says only whether the plan matches today's inputs.

Problems that appear during replay are separate. When the UI changes and an element fingerprint no longer matches, the result is `fingerprint-mismatch`. That is drift, a runtime condition, and it does not change `inputsDigest`.

Replay or healing takes over from there.

Related: [Replay and grounding](/ambercast/explanation/replay-and-grounding/#drift-handoff), [Healing model](/ambercast/explanation/healing-model/#three-stages), [Operating contract](/ambercast/agents/operating-contract/#command-contract)
