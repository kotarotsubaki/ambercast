# Steps

## Step union {#step-union}

Every committed step is a strict branch of `Step`, discriminated by `kind`; every branch has `id: StepId` and a required `target` naming a key in `Plan.targets`. [repo:src/core/ir/schema.ts:404,742]

### Confirmation references {#confirmation-references}

An assertion or `ai` step may have a non-empty `confirms` array naming earlier `click`, `press`, `fill`, `fill-secret`, or `capture` steps whose grounding it confirms when it passes. Validation reports `confirms-unknown-step` for an unknown ID, `confirms-not-earlier` for the same or a later step, `confirms-not-action` for an ineligible step, `confirms-duplicate` for a repeated ID, and `confirms-unsorted` when IDs are not in ascending Plan order; see [[spec/conformance#semantic-validation]]. Target identity is not checked. [repo:src/core/ir/confirms-validation.ts:35]

### `action` / `click` {#action-click}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | `/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/` | Stable step identifier. | repo:src/core/ir/schema.ts:41,436 |
| `kind` | string | required | literal `action` | Outer discriminator. | repo:src/core/ir/schema.ts:438 |
| `target` | string | required | name in Plan `targets` | Execution Target. | repo:src/core/ir/schema.ts |
| `action` | string | required | literal `click` | Action discriminator. | repo:src/core/ir/schema.ts:439 |
| `intent` | `ElementIntent` | required | [[spec/value-types#shared-types]] | Source-backed element description used for first binding. | repo:src/core/ir/schema.ts:540 |

```json
{"id":"click-login","kind":"action","action":"click","target":"app","intent":{"description":"Click Log in","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":13}}}
```

### `action` / `navigate` {#action-navigate}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | Stable ID. | repo:src/core/ir/schema.ts:455 |
| `kind` | string | required | literal `action` | Outer discriminator. | repo:src/core/ir/schema.ts:457 |
| `action` | string | required | literal `navigate` | Action discriminator. | repo:src/core/ir/schema.ts:458 |
| `url` | `InterpolatableText` | required | no `{{secrets.` marker | Navigation text. | repo:src/core/ir/schema.ts:455 |

```json
{"id":"open-home","kind":"action","action":"navigate","target":"app","url":"https://example.test"}
```

At execution, every Plan navigation, cached trace navigation, and fresh agentic navigation MUST resolve against the live target `baseUrl`, use HTTP(S), and remain on that target's origin. An unresolvable, non-HTTP(S), or cross-origin destination is an integrity failure. [repo:src/usecases/run.ts:701] [repo:src/usecases/run.ts:746]

### `action` / `press` {#action-press}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | Stable ID. | repo:src/core/ir/schema.ts:474 |
| `kind` | string | required | literal `action` | Outer discriminator. | repo:src/core/ir/schema.ts:476 |
| `target` | string | required | name in Plan `targets` | Execution Target. | repo:src/core/ir/schema.ts |
| `action` | string | required | literal `press` | Action discriminator. | repo:src/core/ir/schema.ts:477 |
| `intent` | `ElementIntent` | required | [[spec/value-types#shared-types]] | Source-backed recipient description used for first binding. | repo:src/core/ir/schema.ts:574-579 |
| `key` | string | required | enum `Enter`, `Tab`, `Escape`, `ArrowDown`, `ArrowUp` | Key. | repo:src/core/ir/schema.ts:474 |

```json
{"id":"submit","kind":"action","action":"press","target":"app","intent":{"description":"Press Enter in Email","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":21}},"key":"Enter"}
```

### `action` / `fill` {#action-fill}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | Stable ID. | repo:src/core/ir/schema.ts:493 |
| `kind` | string | required | literal `action` | Outer discriminator. | repo:src/core/ir/schema.ts:495 |
| `target` | string | required | name in Plan `targets` | Execution Target. | repo:src/core/ir/schema.ts |
| `action` | string | required | literal `fill` | Action discriminator. | repo:src/core/ir/schema.ts:496 |
| `intent` | `ElementIntent` | required | [[spec/value-types#shared-types]] | Source-backed field description used for first binding. | repo:src/core/ir/schema.ts:594-599 |
| `value` | `InterpolatableText` | required | no secret marker | Non-secret or run-state text. | repo:src/core/ir/schema.ts:493 |

```json
{"id":"fill-email","kind":"action","action":"fill","target":"app","intent":{"description":"Fill Email","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":11}},"value":"a@example.test"}
```

### `action` / `fill-secret` {#action-fill-secret}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | Stable ID. | repo:src/core/ir/schema.ts:499-504 |
| `kind` | string | required | literal `action` | Outer discriminator. | repo:src/core/ir/schema.ts:499-504 |
| `target` | string | required | name in Plan `targets` | Execution Target. | repo:src/core/ir/schema.ts |
| `action` | string | required | literal `fill-secret` | Action discriminator. | repo:src/core/ir/schema.ts:499-504 |
| `intent` | `ElementIntent` | required | [[spec/value-types#shared-types]] | Source-backed secret sink description used for first binding. | repo:src/core/ir/schema.ts:617-622 |
| `secretRef` | `SecretRef` | required | whole secret-ref grammar | Secret value reference. | repo:src/core/ir/schema.ts:396,499-504 |

```json
{"id":"fill-password","kind":"action","action":"fill-secret","target":"app","intent":{"description":"Fill Password","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":14}},"secretRef":"{{secrets.LOGIN_PASSWORD}}"}
```

### `assert` / `text-visible` {#assert-text-visible}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | Stable ID. | repo:src/core/ir/schema.ts:556 |
| `kind` | string | required | literal `assert` | Outer discriminator. | repo:src/core/ir/schema.ts:558 |
| `check` | string | required | literal `text-visible` | Assertion discriminator. | repo:src/core/ir/schema.ts:559 |
| `timeoutMs` | integer | optional | 0–120000 | Assertion retry deadline in milliseconds. | repo:src/core/ir/schema.ts |
| `text` | `InterpolatableText` | required | no secret marker | Expected visible text. | repo:src/core/ir/schema.ts:556 |
| `confirms` | `StepId[]` | optional | non-empty; earlier action-kind or capture steps in ascending Plan order | Steps whose grounding this assertion confirms when it passes. | repo:src/core/ir/schema.ts:521,663 |

```json
{"id":"welcome-visible","kind":"assert","check":"text-visible","target":"app","text":"Welcome"}
```

### `assert` / `element-visible` {#assert-element-visible}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | Stable ID. | repo:src/core/ir/schema.ts:575 |
| `kind` | string | required | literal `assert` | Outer discriminator. | repo:src/core/ir/schema.ts:577 |
| `target` | string | required | name in Plan `targets` | Execution Target. | repo:src/core/ir/schema.ts |
| `check` | string | required | literal `element-visible` | Assertion discriminator. | repo:src/core/ir/schema.ts:578 |
| `timeoutMs` | integer | optional | 0–120000 | Assertion retry deadline in milliseconds. | repo:src/core/ir/schema.ts |
| `intent` | `QuotedElementIntent` | required | [[spec/value-types#shared-types]] | Source-backed quoted element description. | repo:src/core/ir/schema.ts:680 |
| `confirms` | `StepId[]` | optional | non-empty; earlier action-kind or capture steps in ascending Plan order | Steps whose grounding this assertion confirms when it passes. | repo:src/core/ir/schema.ts:521,684 |

```json
{"id":"menu-visible","kind":"assert","check":"element-visible","target":"app","intent":{"description":"Main navigation 「Main」","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":23},"quote":{"text":"Main","sourceSpan":{"startLine":1,"startColumn":18,"endLine":1,"endColumn":22}}}}
```

### `assert` / `text-equals` {#assert-text-equals}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | Stable ID. | repo:src/core/ir/schema.ts:594 |
| `kind` | string | required | literal `assert` | Outer discriminator. | repo:src/core/ir/schema.ts:596 |
| `target` | string | required | name in Plan `targets` | Execution Target. | repo:src/core/ir/schema.ts |
| `check` | string | required | literal `text-equals` | Assertion discriminator. | repo:src/core/ir/schema.ts:597 |
| `timeoutMs` | integer | optional | 0–120000 | Assertion retry deadline in milliseconds. | repo:src/core/ir/schema.ts |
| `intent` | `QuotedElementIntent` | required | [[spec/value-types#shared-types]] | Source-backed quoted element under test. | repo:src/core/ir/schema.ts:703 |
| `text` | `InterpolatableText` | required | no secret marker | Exact expected text. | repo:src/core/ir/schema.ts:594 |
| `confirms` | `StepId[]` | optional | non-empty; earlier action-kind or capture steps in ascending Plan order | Steps whose grounding this assertion confirms when it passes. | repo:src/core/ir/schema.ts:521,707 |

```json
{"id":"title","kind":"assert","check":"text-equals","target":"app","intent":{"description":"Account heading 「Account」","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":26},"quote":{"text":"Account","sourceSpan":{"startLine":1,"startColumn":18,"endLine":1,"endColumn":25}}},"text":"Account overview"}
```

### `assert` / `url-matches` {#assert-url-matches}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | Stable ID. | repo:src/core/ir/schema.ts:614 |
| `kind` | string | required | literal `assert` | Outer discriminator. | repo:src/core/ir/schema.ts:616 |
| `check` | string | required | literal `url-matches` | Assertion discriminator. | repo:src/core/ir/schema.ts:617 |
| `timeoutMs` | integer | optional | 0–120000 | Assertion retry deadline in milliseconds. | repo:src/core/ir/schema.ts |
| `pattern` | `InterpolatableText` | required | no secret marker | Expected URL matching text. | repo:src/core/ir/schema.ts:614 |
| `confirms` | `StepId[]` | optional | non-empty; earlier action-kind or capture steps in ascending Plan order | Steps whose grounding this assertion confirms when it passes. | repo:src/core/ir/schema.ts:521,730 |

```json
{"id":"on-account","kind":"assert","check":"url-matches","target":"app","pattern":"/account"}
```

### `assert` / `element-count` {#assert-element-count}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | Stable ID. | repo:src/core/ir/schema.ts:633 |
| `kind` | string | required | literal `assert` | Outer discriminator. | repo:src/core/ir/schema.ts:635 |
| `target` | string | required | name in Plan `targets` | Execution Target. | repo:src/core/ir/schema.ts |
| `check` | string | required | literal `element-count` | Assertion discriminator. | repo:src/core/ir/schema.ts:636 |
| `timeoutMs` | integer | optional | 0–120000 | Assertion retry deadline in milliseconds. | repo:src/core/ir/schema.ts |
| `intent` | `QuotedElementIntent` | required | [[spec/value-types#shared-types]] | Source-backed quoted matching element. | repo:src/core/ir/schema.ts:749 |
| `count` | integer | required | nonnegative | Expected count, including zero. | repo:src/core/ir/schema.ts:633 |
| `confirms` | `StepId[]` | optional | non-empty; earlier action-kind or capture steps in ascending Plan order | Steps whose grounding this assertion confirms when it passes. | repo:src/core/ir/schema.ts:521,753 |

```json
{"id":"one-alert","kind":"assert","check":"element-count","target":"app","intent":{"description":"Error alerts 「Error」","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":21},"quote":{"text":"Error","sourceSpan":{"startLine":1,"startColumn":15,"endLine":1,"endColumn":20}}},"count":1}
```

### `capture` {#capture}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | Stable ID. | repo:src/core/ir/schema.ts:672 |
| `kind` | string | required | literal `capture` | Step discriminator. | repo:src/core/ir/schema.ts:674 |
| `target` | string | required | name in Plan `targets` | Execution Target. | repo:src/core/ir/schema.ts |
| `intent` | `ElementIntent` | required | [[spec/value-types#shared-types]] | Source-backed capture element description used for first binding. | repo:src/core/ir/schema.ts:788 |
| `variable` | `RunVariableName` | required | `/^[a-z][a-zA-Z0-9]*$/` | Bare run-state variable name. | repo:src/core/ir/schema.ts:675 |

```json
{"id":"capture-code","kind":"capture","target":"app","intent":{"description":"Capture Code","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":13}},"variable":"code"}
```

### `ai` {#ai}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | Stable ID. | repo:src/core/ir/schema.ts:404,416-420 |
| `kind` | string | required | literal `ai` | Step discriminator. | repo:src/core/ir/schema.ts:418 |
| `instruction` | `InterpolatableText` | required | no secret marker | Agent instruction. | repo:src/core/ir/schema.ts:419 |
| `secrets` | `AiStepSecretUse[]` | optional | strict entries | Committed secret uses. | repo:src/core/ir/schema.ts:688-692 |
| `instructionCoverage` | `InstructionCriterion[]` | required | min 1 | Locally attributed criteria. | repo:src/core/ir/schema.ts:688-692 |
| `confirms` | `StepId[]` | optional | non-empty; earlier action-kind or capture steps in ascending Plan order | Steps whose grounding this agentic execution confirms when it passes. | repo:src/core/ir/schema.ts:521,824 |

```json
{"id":"complete-flow","kind":"ai","target":"app","instruction":"Finish checkout.","instructionCoverage":[{"id":"finish","kind":"success","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":17}}]}
```

### Committed AI secret uses {#committed-ai-secret-grants}

Each member of a committed AI step's optional `secrets` array is a strict `AiStepSecretUse`; it records only the resolved reference. Consent and allowlist authorization happen before Plan persistence and are not Plan provenance fields. [repo:src/core/ir/schema.ts:667-692] [repo:src/usecases/generate.ts:1405-1493]

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `ref` | `SecretRef` | required | whole secret-reference grammar | Committed secret reference. | repo:src/core/ir/schema.ts:674-675 |

```json
{"id":"complete-flow","kind":"ai","target":"app","instruction":"Finish checkout.","secrets":[{"ref":"{{secrets.CARD_NUMBER}}"}],"instructionCoverage":[{"id":"finish","kind":"success","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":17}}]}
```

Assert checks poll after a failed observation at intervals of at most 100ms until the step deadline. `timeoutMs` overrides the Target's `resolveTimeoutMs` for this deadline; zero still evaluates once.

`element-visible`, `text-equals`, and `element-count` never consult or update grounding or call AI: with or without `--resolve`, they poll `accessibilitySnapshot()` and `matchQuotedCandidates` until their deadline. [repo:src/usecases/run.ts:2780-2855]

## Generated forms {#generated-forms}

Generated click, press, fill, fill-secret, and capture forms carry `GeneratedElementIntent`; generated `element-visible`, `text-equals`, and `element-count` forms carry `GeneratedQuotedElementIntent`. Both are attributed locally to the shared committed shapes in [[spec/value-types#shared-types]]. [repo:src/core/ir/schema.ts:913-1057]

| object | field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `GeneratedFillSecretAction` | `id`, `kind`, `action`, `target` | as committed fill-secret except `secretRef` | required | `kind: action`, `action: fill-secret` | Provider form awaiting local naming. | repo:src/core/ir/schema.ts:773-805 |
|  | `secret` | `SecretNameChoice` | optional | strict choice | Existing allowlisted-name request or new-name hint. | repo:src/core/ir/schema.ts:104-115,779-785 |
| `GeneratedAiStepSecretUse` | choice | `SecretNameChoice` or `{}` | required per array member | strict choice or no provider preference | Provider naming intent awaiting local resolution. | repo:src/core/ir/schema.ts:813-821 |
| `GeneratedAiStep` | `id`, `kind`, `instruction` | as committed AI | required | `kind: ai` | Shared AI contract. | repo:src/core/ir/schema.ts:814 |
|  | `secrets` | generated uses[] | optional | strict entries | Pending secret-name resolution. | repo:src/core/ir/schema.ts:824-833 |
|  | `instructionCoverage` | generated criteria[] | required | min 1 | Pending criterion attribution. | repo:src/core/ir/schema.ts:817 |
|  | `verificationIntent` | `VerificationIntent[]` | required | min 1 in strict form | Transient verification proposals. | repo:src/core/ir/schema.ts:818 |

## Rationale {#rationale}

The problem is preventing actions from being mistaken for proof, particularly where a UI can produce a wrong pass. Explicit assertion branches make observed success criteria inspectable. 

The selected discriminated union gives every opcode a closed field contract and separates secret filling from ordinary text. Provider naming intent is resolved locally and consented before a plan is committed.

Provider-supplied anchor and column coordinates bind each criterion to one locally resolved prompt excerpt; local resolution against a four-coordinate `InstructionSourceSpan` makes the committed attribution precise, while the provider's `citation` is only a checksum confirming that resolution, never a join key.  [repo:src/usecases/instruction-coverage-policy.ts:407-443]

Terminal `url-matches` is rejected because it is a tautological success form rather than independent proof of the cited success criterion. Use a supported, non-duplicative terminal `TraceAssert`; if the success condition cannot be represented, generation fails.  [repo:src/usecases/instruction-coverage-policy.ts:403-407] [repo:src/usecases/instruction-coverage-policy.ts:622-625]

One rejected alternative used one action object with optional payload fields; it was rejected because invalid combinations become schema-invisible. Another let generic text carry secrets; it was rejected because consent boundaries and redaction would be ambiguous.
