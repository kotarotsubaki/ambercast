# Freshness and digests

## Inputs digest {#inputs-digest}

`inputsDigest` MUST be lowercase SHA-256 of canonical JSON for a freshly constructed object with exactly these five members: `normalizedTestMd`, `schemaVersion`, `generatorPromptTemplateFingerprint`, `planProducerBundleFingerprint`, and `targetDefinitions`. Member insertion order has no meaning because canonical JSON sorts object keys. [repo:src/core/ir/digest.ts:93] [repo:src/core/ir/digest.ts:105] [repo:src/core/ir/canonical-json.ts:147] The input object itself MUST NOT be hashed directly. [repo:src/core/ir/digest.ts:97] The producer-bundle fingerprint independently represents plan-semantic producer configuration, so template bytes alone are insufficient. [repo:src/core/ir/digest.ts:70]

## Plan digest {#plan-digest}

`planDigest` MUST hash the PlanDocument excluding `generatorMeta`. [repo:src/core/ir/digest.ts:118] Grounding currentness is exact equality of its stored `planDigest` and the computed plan digest. [repo:src/core/ir/digest.ts:145]

To calculate `planDigest`, copy all Plan fields except `generatorMeta`, canonicalize the remaining object under [[spec/canonical-json#digest-form]], SHA-256 its UTF-8 bytes, and lowercase-hex encode the digest. [repo:src/core/ir/digest.ts:128] A changed normalized prompt, schema version, template fingerprint, producer bundle fingerprint, target name, or target definition makes the stored `inputsDigest` stale. [repo:src/core/ir/digest.ts:52,60,68,77,87]

## Freshness consequences {#freshness-consequences}

A consumer MUST mark a plan `stale` when its stored `inputsDigest` differs from the current value. [repo:src/usecases/check.ts:500] The producer bundle fingerprint is an independent freshness input, so an implementation change can stale plans even when prompt and target data do not change. [repo:src/core/ir/digest.ts:70] A consumer MUST treat a plan/grounding pair as unbound when `planDigest` differs. [repo:src/core/ir/digest.ts:145]

This section is the canonical owner of `check` status derivation. Reference pages MUST only summarize it for their local purpose and link here. The following table is normative for `check` result values. `missing`, `invalid`, and `stale` below are grounding-inspection classifications, not report `status` values. [repo:src/usecases/check-grounding.ts:18] [repo:src/report/schema.ts:525]

| id | `check` status | derivation | result classification |
| --- | --- | --- | --- |
| CHK-01 | `fresh` | Plan parses, is canonical, has valid committed coverage, its `inputsDigest` matches, and its companion is valid. | pass |
| CHK-02 | `stale` | Plan is invalid JSON/schema/canonical form or committed coverage, or its `inputsDigest` differs. | fail |
| CHK-03 | `fresh-without-grounding` | Plan is fresh; companion is not valid; repository policy is `uncommitted`. | pass |
| CHK-04 | `missing-grounding` | Plan is fresh; companion inspection is `missing`; policy requires committed grounding. | fail |
| CHK-05 | `invalid-grounding` | Plan is fresh; companion inspection is `invalid` (JSON/schema/canonical coverage failure). | fail |
| CHK-06 | `stale-grounding` | Plan is fresh; companion inspection is `stale` (another `planDigest`). | fail |
| CHK-07 | `missing-plan` | A selected test has no plan artifact. | fail |
| CHK-08 | `orphaned-plan` | An in-scope plan inverse-maps to a test path that does not exist. | fail |
| CHK-09 | `orphaned-grounding` | An in-scope grounding artifact inverse-maps to a path for which no corresponding test prompt exists. | fail |
| CHK-10 | `invalid-artifact-name` | An artifact path cannot be inverse-derived to a test identity. | fail |
| CHK-11 | `listed` | Discovery-only listing does not inspect the selected path. | skipped |
| CHK-12 | `skipped` | Interruption leaves an identity-only pending row. | skipped |

Rows `fresh` and `fresh-without-grounding` are pass; all rows classified fail above contribute failure; `listed` and `skipped` are skipped. [repo:src/usecases/check-report.ts:71]

## Rationale {#rationale}

The problem is deciding whether a derived plan still represents the inputs and producer contract that created it. A prompt-only comparison cannot observe generator semantic changes. 

The chosen closed preimage includes producer-bundle provenance and a separate plan-to-grounding digest join. It makes every invalidation input explicit and preserves a one-plan/one-current-grounding association. 

One rejected alternative omitted producer provenance; it was rejected because changed generation behavior could masquerade as fresh. Another used timestamps; it was rejected because they neither identify content nor permit deterministic cache reuse.  
