# Value types

## Shared types {#shared-types}

All other chapters MUST use these definitions rather than restating their shapes. Every object below is strict: unknown properties MUST be rejected. [repo:src/core/ir/schema.ts:165] [repo:src/core/ir/schema.ts:183] Regexes are quoted verbatim from the runtime authority.

| Type | field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `TargetDefinition` | `baseUrl` | string | required | `/^https?:\\/\\/[^\\s/?#]\\S*$/`; `/^(?![\\s\\S]*\\{\\{secrets\\.)[\\s\\S]*$/` | Authored HTTP(S) base URL with no secret marker. | repo:src/core/ir/schema.ts:37-38,165-166 |
|  | `browser` | string | required | literal `chromium` | Selected browser. | repo:src/core/ir/schema.ts:167 |
|  | `secretSinkOrigins` | record `SecretRef` → `SecretSinkOrigin[]` | optional | See scalar table | Permitted origins per secret. | repo:src/core/ir/schema.ts:168 |
| `AccessibilityElementRef` | `strategy` | string | required | literal `accessibility` | Locator discriminator. | repo:src/core/ir/schema.ts:183 |
|  | `role` | string | required | min 1 | Exact accessibility role. | repo:src/core/ir/schema.ts:185 |
|  | `name` | string | required | min 1 | Accessible name. | repo:src/core/ir/schema.ts:186 |
| `Fingerprint` | `algorithm` | string | required | literal `a11y-neighborhood-v2` | Locator-evidence format. | repo:src/core/ir/schema.ts:221 |
|  | `hash` | string | required | `/^[0-9a-f]{64}$/` | Lowercase SHA-256. | repo:src/core/ir/schema.ts:35,223 |
| `SourceSpan` | `startLine` | integer | required | positive | Inclusive, one-based grant start line. | repo:src/core/ir/schema.ts:259 |
|  | `endLine` | integer | required | positive; `endLine >= startLine` | Inclusive grant end line. | repo:src/core/ir/schema.ts:260,261 |
| `InstructionSourceSpan` | `startLine` | integer | required | positive | One-based UTF-16 start line. | repo:src/core/ir/schema.ts:332 |
|  | `startColumn` | integer | required | positive | One-based UTF-16 start column. | repo:src/core/ir/schema.ts:333 |
|  | `endLine` | integer | required | positive | One-based UTF-16 end line. | repo:src/core/ir/schema.ts:334 |
|  | `endColumn` | integer | required | positive | Exclusive UTF-16 end column. | repo:src/core/ir/schema.ts:335 |
| `GeneratedInstructionCriterion` | `id` | string | required | `STEP_ID_PATTERN` | Criterion pending attribution. | repo:src/core/ir/schema.ts:350 |
|  | `kind` | string | required | enum `success`, `action` | Clause role. | repo:src/core/ir/schema.ts:351 |
|  | `citation` | string | required | min 1; max `4096` | Verbatim provider excerpt. | repo:src/core/ir/schema.ts:352 |
| `InstructionCriterion` | `id` | string | required | `STEP_ID_PATTERN` | Committed criterion ID. | repo:src/core/ir/schema.ts:366 |
|  | `kind` | string | required | enum `success`, `action` | Clause role. | repo:src/core/ir/schema.ts:367 |
|  | `sourceSpan` | `InstructionSourceSpan` | required | strict nested object | Locally derived prompt location. | repo:src/core/ir/schema.ts:368 |

`ElementRef` has only `AccessibilityElementRef` today. `HexSha256` is `/^[0-9a-f]{64}$/`; `StepId` and `InstructionCriterionId` are `/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/`; `RunVariableName` is `/^[a-z][a-zA-Z0-9]*$/`; `RunRef` is `/^\\{\\{run\\.[A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)*\\}\\}$/`. [repo:src/core/ir/schema.ts:35,41,198,237,311,381,396]

## Scalar and reference contracts {#scalar-contracts}

| Type | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `SecretRef` | string | value | `/^\\{\\{secrets\\.[A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)*\\}\\}$/` | Whole secret reference. | repo:src/core/ir/schema.ts:31,33,74 |
| `SecretSinkOrigin` | string | value | `/^https?:\\/\\/[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*(?::(?:6553[0-5]|655[0-2][0-9]|65[0-4][0-9]{2}|6[0-4][0-9]{3}|[1-5][0-9]{4}|[1-9][0-9]{0,3}))?$/`; no-secret pattern | HTTP(S) origin only. | repo:src/core/ir/schema.ts:40,95-97 |
| `InterpolatableText` | string | value | `/^(?![\\s\\S]*\\{\\{secrets\\.)[\\s\\S]*$/` | Text may contain run interpolation but no secret token. | repo:src/core/ir/schema.ts:37,125 |
| `Citation` | string | value | min 1; max `4096` | Exact prompt substring before attribution. | repo:src/core/ir/schema.ts:273,279 |
| `JsonValue` | JSON scalar/array/object | value | RFC 8259 recursive union | Metadata or provider ambiguity value. | repo:src/core/ir/schema.ts:1167 |

An absent secret entry in `secretSinkOrigins` defaults that secret to `baseUrl`; an explicit empty array denies all origins; a non-empty array replaces the default. [repo:src/core/ir/schema.ts:152-157] `SourceSpan` ordering and all `InstructionSourceSpan` prompt-coordinate checks are semantic validation. [repo:src/core/ir/schema.ts:254,328]

## Examples {#examples}

```json
{"strategy":"accessibility","role":"button","name":"Sign in"}
```

```json
{"algorithm":"a11y-neighborhood-v2","hash":"0000000000000000000000000000000000000000000000000000000000000000"}
```

## Rationale {#rationale}

Shared objects solve the problem of plan, generation response, and grounding gradually acquiring incompatible locators, references, and provenance. The design puts strict runtime definitions in one schema and derives JSON Schema from it. 

The selected design separates whole-value secret and run references from ordinary text, and separates provider citation from committed source span. Local code, not an AI-produced excerpt, is therefore authoritative for durable provenance. 

One rejected alternative was independently defining a locator and secret syntax in each document; it was rejected because review could not expose compatible-looking drift. Another was treating citations as durable authority; it was rejected because prompt-relative verification must be deterministic and local.  
