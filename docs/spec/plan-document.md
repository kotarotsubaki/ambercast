# Plan document

This chapter defines `PlanDocument`, the committed plan file's top-level object, its minimal example, and the generation response that local generation turns into it.

## Document shape {#document-shape}

`PlanDocument` is a strict object. A producer MUST emit literal `5` and a consumer MUST reject unknown properties and other versions. [repo:src/core/ir/schema.ts:62] [repo:src/core/ir/schema.ts:1541-1546]

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `schemaVersion` | integer | required | literal `5` | Plan format version. | repo:src/core/ir/schema.ts:62,1542 |
| `source` | strict object | required | exactly `inputsDigest` | Freshness wrapper. | repo:src/core/ir/schema.ts:1543 |
| `source.inputsDigest` | string | required | `/^[0-9a-f]{64}$/` | Digest of generation inputs. | repo:src/core/ir/schema.ts:35,1543 |
| `generatorMeta` | record string → `JsonValue` | optional | JSON only | Metadata excluded from `planDigest`. | repo:src/core/ir/schema.ts:1544; repo:src/core/ir/digest.ts:153-157 |
| `targets` | record string → `TargetDefinition` | required | strict value; [[spec/value-types#shared-types]] | Referenced Target snapshot; every key must be used by a step. | repo:src/core/ir/schema.ts:1545,1569-1578 |
| `steps` | `Step[]` | required | ordered strict branches | Plan sequence; [[spec/steps#step-union]]. | repo:src/core/ir/schema.ts:1546 |

Omission and `{}` for `generatorMeta` remain distinct serialized Plan values, but neither affects `planDigest`: the digest view excludes `generatorMeta` as a whole. [repo:src/core/ir/schema.ts:1544] [repo:src/core/ir/digest.ts:153-157]

## Complete minimal document {#complete-minimal-document}

Digest strings are illustrative placeholders. The Grounding example uses the same illustrative `planDigest`, declared to refer to this exact Plan example.

```json
{
  "schemaVersion": 5,
  "source": {"inputsDigest": "0000000000000000000000000000000000000000000000000000000000000000"},
  "targets": {"app": {"surface": "web", "baseUrl": "https://example.test"}},
  "steps": [{"id": "open-home", "kind": "action", "action": "navigate", "target": "app", "url": "https://example.test"}]
}
```

## Semantic constraints {#semantic-constraints}

Step IDs MUST be unique; a duplicate reports `duplicate step id: <id>` at the later `steps[index].id`. [repo:src/core/ir/schema.ts:1551-1558] Instruction coverage requires prompt-bound local attribution and set checks in [[spec/conformance#semantic-validation]]. [repo:src/usecases/instruction-coverage-policy.ts:379-538]

## Provider-only generation response {#provider-generation-response}

The provider does not author `schemaVersion`, `source`, or `targets`; local generation adds them before committed-plan validation. Provider secret naming intent is resolved locally before a committed `SecretRef` is formed. [repo:src/core/ir/schema.ts:1611-1624] [repo:src/core/ir/schema.ts:1022-1029,1146]

Provider element-bearing step proposals use transient `GeneratedElementIntent` and `GeneratedQuotedElementIntent` with anchor coordinates matching `GeneratedInstructionCriterion`, rather than committed `ElementIntent` and `QuotedElementIntent`. [repo:src/core/ir/schema.ts:392-400,435-457]

| object | field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `GeneratedPlanResponse` | `steps` | `GeneratedStep[]` | required | generated forms in [[spec/steps#generated-forms]] | Provider proposal. | repo:src/core/ir/schema.ts:1612 |
|  | `generatorMeta` | record string → `JsonValue` | optional | JSON only | Provider metadata. | repo:src/core/ir/schema.ts:1613 |
|  | `ambiguities` | `JsonValue[]` | required | none | Steps whose target cannot be assigned. | repo:src/core/ir/schema.ts:1622 |
|  | `assumptions` | `string[]` | optional | string items only | Other assumptions absent from the prompt; report warnings, never stored in the Plan. | repo:src/core/ir/schema.ts:1623 |
| `VerificationIntent` | `criterionId` | `InstructionCriterionId` | required | step-ID regex | Proposed success criterion. | repo:src/core/ir/schema.ts:1187 |
|  | `assertion` | `TraceAssert` | required | strict trace assertion | Transient terminal evidence. | repo:src/core/ir/schema.ts:1188 |

`GeneratedPlanResponseForPolicy` relaxes an AI `verificationIntent` assertion to `JsonValue`; `GeneratedPlanResponseRequest` permits an empty `verificationIntent`. Both are transient, never committed Plan forms. [repo:src/core/ir/schema.ts:1636,1672]

## Rationale {#rationale}

The problem is preserving reviewed test intent while allowing generated execution details to be reproducible. A plan is derived data, so it exposes generation provenance without becoming the source prompt. 

The selected strict, versioned document captures target snapshots and ordered steps while leaving results outside it. That makes plan digests stable across replay and regeneration explicit when inputs change. 

One rejected alternative merged traces into the plan; it was rejected because successful execution would rewrite reviewed intent. Another migrated old plans in place; it was rejected because a derived artifact with changed semantics is safer to regenerate than silently reinterpret.
