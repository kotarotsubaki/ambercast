---
title: Compatibility
description: Artifact-format compatibility across package versions, and the changes that require you to regenerate a Plan, Grounding, or report.
---

Each release pins schema versions and an element fingerprint tag. The tables below show which pinned versions each release uses and which changes force regeneration.

## Compatibility table {#compatibility-table}

| package version | Plan `schemaVersion` | Grounding `schemaVersion` | element fingerprint tag | report `schemaVersion` |
| --- | --- | --- | --- | --- |
| `0.1.0` | `2` | `1` | `a11y-neighborhood-v2` | `3.0` |
| `0.2.0` | `2` | `1` | `a11y-neighborhood-v2` | `3.0` |
| `0.5.0` | `3` | `1` | `a11y-neighborhood-v2` | `3.5` |
| `0.7.0` | `5` | `3` | `a11y-neighborhood-v2` | `3.8` |
| `0.8.0` | `5` | `3` | `a11y-neighborhood-v2` | `3.9` |
| `0.9.0` | `5` | `3` | `a11y-neighborhood-v2` | `3.10` |

Rows list 0.1.0, 0.2.0, each release that changed the Plan or Grounding schema version, and every release from 0.8.0 on. Schema versions on `main` after the latest release appear in this table when they are released. See [JSON Schemas](/ambercast/reference/json-schemas/#publication-metadata) for the schemas currently published.

In version 0.2.0, the provider request contract changed without incrementing the Plan schema version. That change updated `producerBundleFingerprint` and altered every prompt's `inputsDigest`, making 0.1.0 plans stale (see [Changelog](/ambercast/reference/changelog/#release-020)).

Schema changes are never migrated in place. Each transition has its own rule:

- Plan v1 and v2: `generate` treats either as non-fresh and regenerates a current Plan. `check` reports it read-only as `stale`. `run` and `heal` reject it with `INTEGRITY_VIOLATION` (exit code 4).
- Plan v3: it replaces the v2 secret-grant provenance model with consent and `secrets.allow`.
- Plan v4: it is not migrated in place and receives the same non-fresh, `stale`, and `INTEGRITY_VIOLATION` treatment.
- Plan v5: it replaces v4 element references with source-backed intent and adds `confirms`.
- Grounding v3: it replaces v2 bare-fingerprint entries with locator, fingerprint, intentDigest, and provenance.

For step-by-step upgrade procedures, refer to [Upgrade between versions](/ambercast/how-to/upgrade/).

## Regeneration boundary {#regeneration-boundary}

| change | affected material | obligation |
| --- | --- | --- |
| Normalized prompt, Plan schema version, generator-template fingerprint, producer-bundle fingerprint, or named target definitions | `inputsDigest` and Plan freshness | Regenerate the Plan. Replay-relevant Plan content separately governs the resulting Grounding binding. |
| Replay-relevant Plan content | `planDigest` recorded by Grounding | Regenerate or replace Grounding; `generatorMeta` alone does not enter `planDigest`. |
| Accepted element fingerprint algorithm or preimage | Existing element-grounding entries | In `run`, an unusable source is a cache miss when it is absent, invalid JSON, stale provenance, or fails strict parsing without a coverage claim. Once a current-provenance source makes a coverage claim, its structural or canonical failure is an integrity failure and does not fall back. In `check`, grounding inspection classifies JSON/schema failure and a claimed non-canonical source as `invalid` and a stale `planDigest` as `stale`; the public report status is derived per repository policy in [Freshness and digests](/ambercast/spec/freshness/#freshness-consequences). |
| Report schema version or field contract | Structured-output consumers and persisted run reports | Update consumers for the emitted report contract. The [Changelog](/ambercast/reference/changelog/) lists what each report version changed. |
| Plan, Grounding, config, or report Zod schema | Published npm schema artifacts | Run the package build so the four JSON Schemas are regenerated from their Zod sources. |

The `inputsDigest` hashes exactly five declared inputs through canonical JSON and SHA-256. They are the normalized prompt, the Plan schema version, the generator-template fingerprint, the producer-bundle fingerprint, and the named target definitions.

Grounding freshness is a direct equality check between its recorded `planDigest` and the digest computed for your candidate Plan.

## See also {#see-also}

- [Changelog](/ambercast/reference/changelog/#release-020)
- [Upgrade between versions](/ambercast/how-to/upgrade/)
- [ambercast check](/ambercast/reference/cli/check/#status-vocabulary)
- [Freshness and digests](/ambercast/spec/freshness/)
- [Freshness consequences](/ambercast/spec/freshness/#freshness-consequences)
- [Specification changelog](/ambercast/spec/changelog/)
