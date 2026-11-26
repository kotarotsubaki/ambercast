# Grounding document

This chapter defines `GroundingDocument`, the committed grounding cache bound to one plan digest, its entries and trace records, and when an implementation writes or keeps an entry.

## Grounding shape {#grounding-shape}

`GroundingDocument` is a strict object bound to exactly one Plan digest. [repo:src/core/ir/schema.ts:1753]

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `schemaVersion` | integer | required | literal `5` | Grounding format version. | repo:src/core/ir/schema.ts:74,1754 |
| `planDigest` | `HexSha256` | required | `/^[0-9a-f]{64}$/` | Digest of the associated plan. | repo:src/core/ir/schema.ts:35,1755 |
| `entries` | record `StepId` → `GroundingEntry` | required | strict entry branches | Cached step grounding keyed by ID. | repo:src/core/ir/schema.ts:1756 |

## Version compatibility {#version-compatibility}

Consumers accept v4 documents after validating their original v4 shape. A v4 element entry MUST NOT contain `components` or `ignoredNames`. The published v5 schema accepts only v5; the frozen v4 schema describes the readable older format.

Newly written documents use v5. A run that rewrites nothing MUST leave the file untouched, including its version. Existing entries that match remain unchanged; ambercast does not add components to them.

When another entry requires write-back, unchanged v4 entries can remain without components in the v5 document. A newly resolved, confirmed element binding records the components observed at binding time. Entry preservation compares canonical values; a document write can normalize previously noncanonical text.

## Entry variants {#entry-variants}

| object | field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `ElementGroundingEntryV5` | `kind` | string | required | literal `element` | Element-entry discriminator. | repo:src/core/ir/schema.ts:1443 |
|  | `locator` | `GroundingElementLocator` | required | [[spec/value-types#shared-types]] | Observed locator bound to the intent. | repo:src/core/ir/schema.ts:1444 |
|  | `fingerprint` | `Fingerprint` | required | [[spec/fingerprint#algorithm]] | Accessibility-neighborhood evidence. | repo:src/core/ir/schema.ts:1445 |
|  | `intentDigest` | `HexSha256` | required | `/^[0-9a-f]{64}$/` | Digest of the committed intent this locator was bound against. | repo:src/core/ir/schema.ts:1446 |
|  | `provenance` | string | required | enum `quoted-match`, `ai-proposed` | Which first-binding stage produced this locator. | repo:src/core/ir/schema.ts:1447 |
|  | `components` | `FingerprintComponents` | optional | `a11y-components-v1` | Structure and slot-name hashes. | repo:src/core/ir/schema.ts:1519 |
|  | `ignoredNames` | `FingerprintNameSlot[]` | optional | min 1; ordered; unique; requires components | Slot list; complete fingerprint matching remains in effect. | repo:src/core/ir/schema.ts:1519 |
| `AiGroundingEntry` | `kind` | string | required | literal `ai` | AI-entry discriminator. | repo:src/core/ir/schema.ts:1464 |
|  | `trace` | `TraceRecord` | required | strict trace | Replayable successful trace. | repo:src/core/ir/schema.ts:1465 |

`GroundingEntry` is the `kind` union of these two exact strict shapes. A missing AI entry means no trace has been recorded; an `ai` entry with empty verification is invalid. [repo:src/core/ir/schema.ts:1402-1406,1463-1466,1480-1483]

## Components {#components}

`components` is an optional strict `FingerprintComponents` record. It contains all five fields: `algorithm`, `structure`, `parentName`, `siblingBeforeName`, and `siblingAfterName`. `algorithm` MUST be `a11y-components-v1`.

Each hash MUST be lowercase SHA-256 hexadecimal. An absent sibling MUST have a `null` name hash; the field MUST NOT be omitted. `parentName` is always a hash.

`ignoredNames` is an optional non-empty list of slots in the fixed order `parent`, `siblingBefore`, `siblingAfter`, without duplicates. An entry with `ignoredNames` MUST have `components`. Every listed slot MUST have a non-null name hash.

Producers MUST omit an empty list. Unknown component fields or one invalid entry invalidate the whole document. Schema validation checks shapes and combinations, not whether the full fingerprint and components describe the same observation.

The current implementation never writes `ignoredNames`. Matching still compares the complete fingerprint, including when a stored entry contains `ignoredNames`.

## Trace record {#trace-record}

| object | field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `TraceRecord` | `events` | `TraceEntry[]` | required | may be empty | Chronological action/assertion journal. | repo:src/core/ir/schema.ts:1403 |
|  | `verification` | `TraceAssert[]` | required | min 1 | Terminal assertions required for replayable success. | repo:src/core/ir/schema.ts:1404 |
|  | `verificationCoverage` | record `InstructionCriterionId` → integer | optional | integer nonnegative | Additive coverage-to-verification-index mapping. | repo:src/core/ir/schema.ts:1405 |
| `TraceClick` | `type`, `element` | string, `ElementRef` | required | literal `click`; strict element | Recorded click. | repo:src/core/ir/schema.ts:1235 |
| `TraceNavigate` | `type`, `url` | string, `InterpolatableText` | required | literal `navigate`; no secret marker | Recorded navigation. | repo:src/core/ir/schema.ts:1251 |
| `TracePress` | `type`, `element`, `key` | string, locator, string | required | literal `press`; key enum | Recorded key press. | repo:src/core/ir/schema.ts:1267 |
| `TraceFill` | `type`, `element`, `value` | string, locator, text | required | literal `fill`; no secret marker | Recorded ordinary fill. | repo:src/core/ir/schema.ts:1283 |
| `TraceFillSecret` | `type`, `element`, `secretRef` | string, locator, ref | required | literal `fill-secret`; whole ref | Recorded secret fill without literal value. | repo:src/core/ir/schema.ts:1299 |

`TraceAction` is the `type` union of the five action records. The `key` enum is `Enter`, `Tab`, `Escape`, `ArrowDown`, `ArrowUp`; `ElementRef`, `InterpolatableText`, and `SecretRef` retain their constraints from [[spec/value-types#shared-types]]. [repo:src/core/ir/schema.ts:567-572,1267-1270,1315-1321]

## Trace verification records {#trace-verification-records}

Every `TraceAssert` branch is strict and requires `type: "assert"`; it shares the same check-specific field bundle as a Plan assertion. [repo:src/core/ir/schema.ts:1342]

| variant | fields | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `text-visible` | `type`, `check`, `text` | all required | literals `assert`, `text-visible`; non-secret text | Visibility observation. | repo:src/core/ir/schema.ts:1343 |
| `element-visible` | `type`, `check`, `element` | all required | literals `assert`, `element-visible`; strict locator | Element visibility observation. | repo:src/core/ir/schema.ts:1348 |
| `text-equals` | `type`, `check`, `element`, `text` | all required | literals `assert`, `text-equals`; non-secret text | Exact text observation. | repo:src/core/ir/schema.ts:1353 |
| `url-matches` | `type`, `check`, `pattern` | all required | literals `assert`, `url-matches`; non-secret text | URL observation. | repo:src/core/ir/schema.ts:1358 |
| `element-count` | `type`, `check`, `element`, `count` | all required | literals `assert`, `element-count`; integer ≥ 0 | Count observation. | repo:src/core/ir/schema.ts:1363 |

`TraceEntry` is the outer `type` union of `TraceAction` and `TraceAssert`. [repo:src/core/ir/schema.ts:1384]

## Complete minimal document {#complete-minimal-document}

This illustrative `planDigest` refers to the complete Plan example in [[spec/plan-document#complete-minimal-document]]. It is not a computed digest.

```json
{
  "schemaVersion": 5,
  "planDigest": "0000000000000000000000000000000000000000000000000000000000000000",
  "entries": {}
}
```

## Authority and binding {#authority-and-binding}

A consumer MUST recompute the Plan digest and accept Grounding only when it equals `planDigest`. [repo:src/core/ir/digest.ts:153] [repo:src/core/ir/digest.ts:170]

## Plan digest binding {#plan-digest}

After successful replay of an existing trace, an implementation MUST leave that entry unchanged. It MUST write or overwrite an AI entry only after successful agentic execution with exact terminal success-criterion coverage. For a successful agentic execution ending in a snapshot or failed assertion, a cold path MUST write no entry. For a successful agentic execution ending in a snapshot or failed assertion, a fallback path MUST delete the stale entry that caused fallback. It MUST leave an existing entry untouched after agentic failure or abort. [repo:src/usecases/run.ts:2255-2266] [repo:src/usecases/run.ts:2565]

An element entry MUST be written or overwritten only when its binding reaches `confirmed`. A binding reaches `confirmed` through either of two triggers:

- At least one step names the element step in its non-empty committed `confirms` list, and every such step passes in the same case with a valid confirmation basis. An `element-visible` assertion provides a valid basis only when exactly one candidate matches.
- Every step in the case passes. This confirms all remaining click, press, fill, fill-secret, and capture bindings, including actions absent from `confirms` and actions with multiple `element-visible` matches.

If the case fails or is interrupted before completion, an `acted`-only binding MUST NOT be persisted. File writes remain subject to the write-back gate. [repo:src/usecases/run.ts:3559-3582] [repo:src/usecases/run.ts:3490-3524] [repo:src/usecases/run.ts:4431-4437] [repo:src/usecases/run.ts:4526-4536]

For every `TraceFillSecret`, `secretRef` MUST belong to the containing Plan AI step's committed `secrets[].ref` set. A violation is an integrity failure and MUST NOT fall back to agentic execution. [repo:src/usecases/run.ts:1158] [repo:src/usecases/run.ts:1356]

Grounding versions 2 and 3 are retired. `check` reports `stale-grounding` before schema validation under committed policy; uncommitted policy yields `fresh-without-grounding`. Without `--resolve`, `run` reports `GROUNDING_UNRESOLVED` with `recoverable-miss` when the plan digest matches and an element step needs grounding; a differing digest yields `missing`.

`run --resolve` starts with an empty cache and can persist v5 under the existing write-back conditions. `generate` on an unchanged fresh plan replaces a retired cache with empty v5 grounding. `heal` reports `FS_IO_ERROR` until the cache is regenerated with `ambercast run --resolve --update-cache`. Versions 1 and unknown versions remain invalid in `check` and cache misses in `run`.

## Rationale {#rationale}

The problem is that element resolution and AI execution evidence are volatile while plan intent should stay reviewable. A separate cache needs an unambiguous binding back to that intent.

The chosen design gives element steps a bounded fingerprint and AI steps a full trace with terminal verification, all keyed by stable step ID and bound by digest. It makes grounding the sole trace authority.

One rejected alternative embedded traces in plans; it was rejected because normal successful runs would churn a reviewed artifact. Another treated an empty trace as success; it was rejected because replay needs explicit terminal evidence.
