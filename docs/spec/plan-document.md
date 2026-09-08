# Plan document

## Document shape {#document-shape}

`PlanDocument` is a strict object. A producer MUST emit literal version 2 and a consumer MUST reject unknown properties and other versions. [repo:src/core/ir/schema.ts:1189]

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `schemaVersion` | integer | required | literal `2` | Plan format version. | repo:src/core/ir/schema.ts:57,1190 |
| `source` | strict object | required | exactly `inputsDigest` | Freshness wrapper. | repo:src/core/ir/schema.ts:1191 |
| `source.inputsDigest` | string | required | `/^[0-9a-f]{64}$/` | Digest of generation inputs. | repo:src/core/ir/schema.ts:35,1191 |
| `generatorMeta` | record string → `JsonValue` | optional | JSON only | Metadata excluded from `planDigest`. | repo:src/core/ir/schema.ts:1189-1193; repo:src/core/ir/digest.ts:128-131 |
| `targets` | record string → `TargetDefinition` | required | strict value; [[spec/value-types#shared-types]] | Target snapshot. | repo:src/core/ir/schema.ts:1193 |
| `steps` | `Step[]` | required | ordered strict branches | Plan sequence; [[spec/steps#step-union]]. | repo:src/core/ir/schema.ts:1194 |

Omission and `{}` for `generatorMeta` remain distinct serialized Plan values, but neither affects `planDigest`: the digest view excludes `generatorMeta` as a whole. [repo:src/core/ir/schema.ts:1189-1193] [repo:src/core/ir/digest.ts:128-131]

## Complete minimal document {#complete-minimal-document}

Digest strings are illustrative placeholders. The Grounding example uses the same illustrative `planDigest`, declared to refer to this exact Plan example.

```json
{
  "schemaVersion": 2,
  "source": {"inputsDigest": "0000000000000000000000000000000000000000000000000000000000000000"},
  "targets": {"app": {"baseUrl": "https://example.test", "browser": "chromium"}},
  "steps": [{"id": "open-home", "kind": "action", "action": "navigate", "url": "https://example.test"}]
}
```

## Semantic constraints {#semantic-constraints}

Step IDs MUST be unique; a duplicate reports `duplicate step id: <id>` at the later `steps[index].id`. [repo:src/core/ir/schema.ts:1180-1204] Instruction coverage requires prompt-bound local attribution and set checks in [[spec/conformance#semantic-validation]]. [repo:src/usecases/instruction-coverage-policy.ts:337-496]

## Provider-only generation response {#provider-generation-response}

The provider does not author `schemaVersion`, `source`, or `targets`; local generation adds them before committed-plan validation. [repo:src/core/ir/schema.ts:1227]

| object | field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `GeneratedPlanResponse` | `steps` | `GeneratedStep[]` | required | generated forms in [[spec/steps#generated-forms]] | Provider proposal. | repo:src/core/ir/schema.ts:1234 |
|  | `generatorMeta` | record string → `JsonValue` | optional | JSON only | Provider metadata. | repo:src/core/ir/schema.ts:1236 |
|  | `ambiguities` | `JsonValue[]` | required | none | Ambiguity payloads. | repo:src/core/ir/schema.ts:1237 |
| `VerificationIntent` | `criterionId` | `InstructionCriterionId` | required | step-ID regex | Proposed success criterion. | repo:src/core/ir/schema.ts:844 |
|  | `assertion` | `TraceAssert` | required | strict trace assertion | Transient terminal evidence. | repo:src/core/ir/schema.ts:846 |

`GeneratedPlanResponseForPolicy` relaxes an AI `verificationIntent` assertion to `JsonValue`; `GeneratedPlanResponseRequest` permits an empty `verificationIntent`. Both are transient, never committed Plan forms. [repo:src/core/ir/schema.ts:1250,1286]

## Rationale {#rationale}

The problem is preserving reviewed test intent while allowing generated execution details to be reproducible. A plan is derived data, so it exposes generation provenance without becoming the source prompt. 

The selected strict, versioned document captures target snapshots and ordered steps while leaving results outside it. That makes plan digests stable across replay and regeneration explicit when inputs change. 

One rejected alternative merged traces into the plan; it was rejected because successful execution would rewrite reviewed intent. Another migrated old plans in place; it was rejected because a derived artifact with changed semantics is safer to regenerate than silently reinterpret.  
