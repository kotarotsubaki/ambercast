---
title: Compatibility
description: Artifact-format compatibility across package versions and provenance-driven regeneration rules for plans, groundings, and reports.
---

Ambercast defines artifact-format compatibility and regeneration boundaries across package releases using explicit schema versions, element fingerprint tags, and cryptographic provenance digests. This reference details artifact compatibility across releases and the conditions under which you must regenerate your Plan, Grounding, or report files.

## Compatibility table {#compatibility-table}

| package version | Plan `schemaVersion` | Grounding `schemaVersion` | element fingerprint tag | report `schemaVersion` |
| --- | --- | --- | --- | --- |
| `0.1.0` | `2` | `1` (not yet confirmed) | `a11y-neighborhood-v2` | `3.0` |
| `0.2.0` | `2` | `1` | `a11y-neighborhood-v2` | `3.0` |

In version 0.2.0, the provider request contract changed without incrementing the Plan schema version. That change updated `producerBundleFingerprint` and altered every prompt's `inputsDigest`, making 0.1.0 plans stale (see [Changelog](/ambercast/reference/changelog/#release-020)).

Plan version 1 is regenerated or reported stale rather than migrated in place. For step-by-step upgrade procedures, refer to [Upgrade between versions](/ambercast/how-to/upgrade/).

## Regeneration boundary {#regeneration-boundary}

| change | affected material | obligation |
| --- | --- | --- |
| Normalized prompt, Plan schema version, generator-template fingerprint, producer-bundle fingerprint, or named target definitions | `inputsDigest` and Plan freshness | Regenerate the Plan. Replay-relevant Plan content separately governs the resulting Grounding binding. |
| Replay-relevant Plan content | `planDigest` recorded by Grounding | Regenerate or replace Grounding; `generatorMeta` alone does not enter `planDigest`. |
| Accepted element fingerprint algorithm or preimage | Existing element-grounding entries | In `run`, an unusable source is a cache miss when it is absent, invalid JSON, stale provenance, or fails strict parsing without a coverage claim. Once a current-provenance source makes a coverage claim, its structural or canonical failure is an integrity failure and does not fall back. In `check`, grounding inspection classifies JSON/schema failure and a claimed non-canonical source as `invalid` and a stale `planDigest` as `stale`; the public report status is derived per repository policy in [Freshness and digests](/ambercast/spec/freshness/#freshness-consequences). |
| Report schema version or field contract | Structured-output consumers and persisted run reports | Consumer migration and report-regeneration obligations are not yet confirmed (not defined by 0.2.0 code); the implementation only pins the emitted envelope version. |
| Plan, Grounding, or config Zod schema | Published npm schema artifacts | Run the package build so the four JSON Schemas are regenerated from their Zod sources. |

The `inputsDigest` hashes exactly the five declared inputs—the normalized prompt, the Plan schema version, the generator-template fingerprint, the producer-bundle fingerprint, and named target definitions—through canonical JSON and SHA-256.

Grounding freshness is a direct equality check between its recorded `planDigest` and the digest computed for your candidate Plan.

For status terminology used during inspection, see [ambercast check](/ambercast/reference/cli/check/#status-vocabulary). For underlying freshness semantics and version history, consult [Freshness and digests](/ambercast/spec/freshness/) and [Specification changelog](/ambercast/spec/changelog/).
