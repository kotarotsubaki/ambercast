# Grounding document

## Grounding shape {#grounding-shape}

`GroundingDocument` is a strict object bound to exactly one Plan digest. [repo:src/core/ir/schema.ts:1367]

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `schemaVersion` | integer | required | literal `1` | Grounding format version. | repo:src/core/ir/schema.ts:64,1368 |
| `planDigest` | `HexSha256` | required | `/^[0-9a-f]{64}$/` | Digest of the associated plan. | repo:src/core/ir/schema.ts:35,1369 |
| `entries` | record `StepId` → `GroundingEntry` | required | strict entry branches | Cached step grounding keyed by ID. | repo:src/core/ir/schema.ts:1370 |

## Entry variants {#entry-variants}

| object | field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `ElementGroundingEntry` | `kind` | string | required | literal `element` | Element-entry discriminator. | repo:src/core/ir/schema.ts:1093 |
|  | `fingerprint` | `Fingerprint` | required | strict v2 fingerprint | Accessibility-neighborhood evidence. | repo:src/core/ir/schema.ts:1095 |
| `AiGroundingEntry` | `kind` | string | required | literal `ai` | AI-entry discriminator. | repo:src/core/ir/schema.ts:1114 |
|  | `trace` | `TraceRecord` | required | strict trace | Replayable successful trace. | repo:src/core/ir/schema.ts:1116 |

`GroundingEntry` is the `kind` union of these two exact strict shapes. A missing AI entry means no trace has been recorded; an `ai` entry with empty verification is invalid. [repo:src/core/ir/schema.ts:1057-1061,1114-1117,1131-1134]

## Trace record {#trace-record}

| object | field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `TraceRecord` | `events` | `TraceEntry[]` | required | may be empty | Chronological action/assertion journal. | repo:src/core/ir/schema.ts:1057 |
|  | `verification` | `TraceAssert[]` | required | min 1 | Terminal assertions required for replayable success. | repo:src/core/ir/schema.ts:1059 |
|  | `verificationCoverage` | record `InstructionCriterionId` → integer | optional | integer nonnegative | Additive coverage-to-verification-index mapping. | repo:src/core/ir/schema.ts:1060 |
| `TraceClick` | `type`, `target` | string, `ElementRef` | required | literal `click`; strict target | Recorded click. | repo:src/core/ir/schema.ts:890 |
| `TraceNavigate` | `type`, `url` | string, `InterpolatableText` | required | literal `navigate`; no secret marker | Recorded navigation. | repo:src/core/ir/schema.ts:906 |
| `TracePress` | `type`, `target`, `key` | string, locator, string | required | literal `press`; key enum | Recorded key press. | repo:src/core/ir/schema.ts:922 |
| `TraceFill` | `type`, `target`, `value` | string, locator, text | required | literal `fill`; no secret marker | Recorded ordinary fill. | repo:src/core/ir/schema.ts:938 |
| `TraceFillSecret` | `type`, `target`, `secretRef` | string, locator, ref | required | literal `fill-secret`; whole ref | Recorded secret fill without literal value. | repo:src/core/ir/schema.ts:954 |

`TraceAction` is the `type` union of the five action records. The `key` enum is `Enter`, `Tab`, `Escape`, `ArrowDown`, `ArrowUp`; `ElementRef`, `InterpolatableText`, and `SecretRef` retain their constraints from [[spec/value-types#shared-types]]. [repo:src/core/ir/schema.ts:407-410,922-925,970-976]

## Trace verification records {#trace-verification-records}

Every `TraceAssert` branch is strict and requires `type: "assert"`; it shares the same check-specific field bundle as a Plan assertion. [repo:src/core/ir/schema.ts:997]

| variant | fields | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `text-visible` | `type`, `check`, `text` | all required | literals `assert`, `text-visible`; non-secret text | Visibility observation. | repo:src/core/ir/schema.ts:998 |
| `element-visible` | `type`, `check`, `target` | all required | literals `assert`, `element-visible`; strict locator | Element visibility observation. | repo:src/core/ir/schema.ts:1003 |
| `text-equals` | `type`, `check`, `target`, `text` | all required | literals `assert`, `text-equals`; non-secret text | Exact text observation. | repo:src/core/ir/schema.ts:1008 |
| `url-matches` | `type`, `check`, `pattern` | all required | literals `assert`, `url-matches`; non-secret text | URL observation. | repo:src/core/ir/schema.ts:1013 |
| `element-count` | `type`, `check`, `target`, `count` | all required | literals `assert`, `element-count`; integer ≥ 0 | Count observation. | repo:src/core/ir/schema.ts:1018 |

`TraceEntry` is the outer `type` union of `TraceAction` and `TraceAssert`. [repo:src/core/ir/schema.ts:1039]

## Complete minimal document {#complete-minimal-document}

This illustrative `planDigest` refers to the complete Plan example in [[spec/plan-document#complete-minimal-document]]. It is not a computed digest.

```json
{
  "schemaVersion": 1,
  "planDigest": "0000000000000000000000000000000000000000000000000000000000000000",
  "entries": {}
}
```

## Authority and binding {#authority-and-binding}

A consumer MUST recompute the Plan digest and accept Grounding only when it equals `planDigest`. [repo:src/core/ir/digest.ts:145]

## Plan digest binding {#plan-digest}

After successful replay of an existing trace, an implementation MUST leave that entry unchanged. It MUST write or overwrite an AI entry only after successful agentic execution with exact terminal success-criterion coverage. For a successful agentic execution ending in a snapshot or failed assertion, a cold path MUST write no entry and a fallback path MUST delete the stale entry that caused fallback. It MUST leave an existing entry untouched after agentic failure or abort. [repo:src/usecases/run.ts:1895-1912] [repo:src/usecases/run.ts:2051-2127]

For every `TraceFillSecret`, `secretRef` MUST belong to the containing Plan AI step's committed `secrets[].ref` grant set. A violation is an integrity failure and MUST NOT fall back to agentic execution. [repo:src/usecases/run.ts:896] [repo:src/usecases/run.ts:1075]

## Rationale {#rationale}

The problem is that element resolution and AI execution evidence are volatile while plan intent should stay reviewable. A separate cache needs an unambiguous binding back to that intent. 

The chosen design gives element steps a bounded fingerprint and AI steps a full trace with terminal verification, all keyed by stable step ID and bound by digest. It makes grounding the sole trace authority. 

One rejected alternative embedded traces in plans; it was rejected because normal successful runs would churn a reviewed artifact. Another treated an empty trace as success; it was rejected because replay needs explicit terminal evidence.  
