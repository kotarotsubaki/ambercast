# Steps

## Step union {#step-union}

Every committed step is a strict branch of `Step`, discriminated by `kind`; every branch has `id: StepId`. [repo:src/core/ir/schema.ts:404,742]

### `action` / `click` {#action-click}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | `/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/` | Stable step identifier. | repo:src/core/ir/schema.ts:41,436 |
| `kind` | string | required | literal `action` | Outer discriminator. | repo:src/core/ir/schema.ts:438 |
| `action` | string | required | literal `click` | Action discriminator. | repo:src/core/ir/schema.ts:439 |
| `target` | `ElementRef` | required | accessibility branch currently | Element to click. | repo:src/core/ir/schema.ts:436 |

```json
{"id":"click-login","kind":"action","action":"click","target":{"strategy":"accessibility","role":"button","name":"Log in"}}
```

### `action` / `navigate` {#action-navigate}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | Stable ID. | repo:src/core/ir/schema.ts:455 |
| `kind` | string | required | literal `action` | Outer discriminator. | repo:src/core/ir/schema.ts:457 |
| `action` | string | required | literal `navigate` | Action discriminator. | repo:src/core/ir/schema.ts:458 |
| `url` | `InterpolatableText` | required | no `{{secrets.` marker | Navigation text. | repo:src/core/ir/schema.ts:455 |

```json
{"id":"open-home","kind":"action","action":"navigate","url":"https://example.test"}
```

At execution, every Plan navigation, cached trace navigation, and fresh agentic navigation MUST resolve against the live target `baseUrl`, use HTTP(S), and remain on that target's origin. An unresolvable, non-HTTP(S), or cross-origin destination is an integrity failure. [repo:src/usecases/run.ts:701] [repo:src/usecases/run.ts:746]

### `action` / `press` {#action-press}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | Stable ID. | repo:src/core/ir/schema.ts:474 |
| `kind` | string | required | literal `action` | Outer discriminator. | repo:src/core/ir/schema.ts:476 |
| `action` | string | required | literal `press` | Action discriminator. | repo:src/core/ir/schema.ts:477 |
| `target` | `ElementRef` | required | strict locator | Recipient. | repo:src/core/ir/schema.ts:474 |
| `key` | string | required | enum `Enter`, `Tab`, `Escape`, `ArrowDown`, `ArrowUp` | Key. | repo:src/core/ir/schema.ts:474 |

```json
{"id":"submit","kind":"action","action":"press","target":{"strategy":"accessibility","role":"textbox","name":"Email"},"key":"Enter"}
```

### `action` / `fill` {#action-fill}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | Stable ID. | repo:src/core/ir/schema.ts:493 |
| `kind` | string | required | literal `action` | Outer discriminator. | repo:src/core/ir/schema.ts:495 |
| `action` | string | required | literal `fill` | Action discriminator. | repo:src/core/ir/schema.ts:496 |
| `target` | `ElementRef` | required | strict locator | Field. | repo:src/core/ir/schema.ts:493 |
| `value` | `InterpolatableText` | required | no secret marker | Non-secret or run-state text. | repo:src/core/ir/schema.ts:493 |

```json
{"id":"fill-email","kind":"action","action":"fill","target":{"strategy":"accessibility","role":"textbox","name":"Email"},"value":"a@example.test"}
```

### `action` / `fill-secret` {#action-fill-secret}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | Stable ID. | repo:src/core/ir/schema.ts:515 |
| `kind` | string | required | literal `action` | Outer discriminator. | repo:src/core/ir/schema.ts:517 |
| `action` | string | required | literal `fill-secret` | Action discriminator. | repo:src/core/ir/schema.ts:518 |
| `target` | `ElementRef` | required | strict locator | Secret sink field. | repo:src/core/ir/schema.ts:515 |
| `secretRef` | `SecretRef` | required | whole secret-ref grammar | Secret value reference. | repo:src/core/ir/schema.ts:515 |
| `secretGrantSpan` | `SourceSpan` | required | strict span; ordered lines | Local grant provenance. | repo:src/core/ir/schema.ts:520 |

```json
{"id":"fill-password","kind":"action","action":"fill-secret","target":{"strategy":"accessibility","role":"textbox","name":"Password"},"secretRef":"{{secrets.LOGIN_PASSWORD}}","secretGrantSpan":{"startLine":1,"endLine":1}}
```

### `assert` / `text-visible` {#assert-text-visible}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | Stable ID. | repo:src/core/ir/schema.ts:556 |
| `kind` | string | required | literal `assert` | Outer discriminator. | repo:src/core/ir/schema.ts:558 |
| `check` | string | required | literal `text-visible` | Assertion discriminator. | repo:src/core/ir/schema.ts:559 |
| `text` | `InterpolatableText` | required | no secret marker | Expected visible text. | repo:src/core/ir/schema.ts:556 |

```json
{"id":"welcome-visible","kind":"assert","check":"text-visible","text":"Welcome"}
```

### `assert` / `element-visible` {#assert-element-visible}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | Stable ID. | repo:src/core/ir/schema.ts:575 |
| `kind` | string | required | literal `assert` | Outer discriminator. | repo:src/core/ir/schema.ts:577 |
| `check` | string | required | literal `element-visible` | Assertion discriminator. | repo:src/core/ir/schema.ts:578 |
| `target` | `ElementRef` | required | strict locator | Expected visible element. | repo:src/core/ir/schema.ts:575 |

```json
{"id":"menu-visible","kind":"assert","check":"element-visible","target":{"strategy":"accessibility","role":"navigation","name":"Main"}}
```

### `assert` / `text-equals` {#assert-text-equals}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | Stable ID. | repo:src/core/ir/schema.ts:594 |
| `kind` | string | required | literal `assert` | Outer discriminator. | repo:src/core/ir/schema.ts:596 |
| `check` | string | required | literal `text-equals` | Assertion discriminator. | repo:src/core/ir/schema.ts:597 |
| `target` | `ElementRef` | required | strict locator | Element under test. | repo:src/core/ir/schema.ts:594 |
| `text` | `InterpolatableText` | required | no secret marker | Exact expected text. | repo:src/core/ir/schema.ts:594 |

```json
{"id":"title","kind":"assert","check":"text-equals","target":{"strategy":"accessibility","role":"heading","name":"Account"},"text":"Account"}
```

### `assert` / `url-matches` {#assert-url-matches}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | Stable ID. | repo:src/core/ir/schema.ts:614 |
| `kind` | string | required | literal `assert` | Outer discriminator. | repo:src/core/ir/schema.ts:616 |
| `check` | string | required | literal `url-matches` | Assertion discriminator. | repo:src/core/ir/schema.ts:617 |
| `pattern` | `InterpolatableText` | required | no secret marker | Expected URL matching text. | repo:src/core/ir/schema.ts:614 |

```json
{"id":"on-account","kind":"assert","check":"url-matches","pattern":"/account"}
```

### `assert` / `element-count` {#assert-element-count}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | Stable ID. | repo:src/core/ir/schema.ts:633 |
| `kind` | string | required | literal `assert` | Outer discriminator. | repo:src/core/ir/schema.ts:635 |
| `check` | string | required | literal `element-count` | Assertion discriminator. | repo:src/core/ir/schema.ts:636 |
| `target` | `ElementRef` | required | strict locator | Matching element. | repo:src/core/ir/schema.ts:633 |
| `count` | integer | required | nonnegative | Expected count, including zero. | repo:src/core/ir/schema.ts:633 |

```json
{"id":"one-alert","kind":"assert","check":"element-count","target":{"strategy":"accessibility","role":"alert","name":"Error"},"count":1}
```

### `capture` {#capture}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | Stable ID. | repo:src/core/ir/schema.ts:672 |
| `kind` | string | required | literal `capture` | Step discriminator. | repo:src/core/ir/schema.ts:674 |
| `target` | `ElementRef` | required | strict locator | Source element. | repo:src/core/ir/schema.ts:672 |
| `variable` | `RunVariableName` | required | `/^[a-z][a-zA-Z0-9]*$/` | Bare run-state variable name. | repo:src/core/ir/schema.ts:675 |

```json
{"id":"capture-code","kind":"capture","target":{"strategy":"accessibility","role":"textbox","name":"Code"},"variable":"code"}
```

### `ai` {#ai}

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `id` | `StepId` | required | step-ID regex | Stable ID. | repo:src/core/ir/schema.ts:404,416-420 |
| `kind` | string | required | literal `ai` | Step discriminator. | repo:src/core/ir/schema.ts:418 |
| `instruction` | `InterpolatableText` | required | no secret marker | Agent instruction. | repo:src/core/ir/schema.ts:419 |
| `secrets` | `AiStepSecretGrant[]` | optional | strict entries | Authorized secret uses. | repo:src/core/ir/schema.ts:713 |
| `instructionCoverage` | `InstructionCriterion[]` | required | min 1 | Locally attributed criteria. | repo:src/core/ir/schema.ts:714 |

```json
{"id":"complete-flow","kind":"ai","instruction":"Finish checkout.","instructionCoverage":[{"id":"finish","kind":"success","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":17}}]}
```

### Committed AI secret grants {#committed-ai-secret-grants}

Each member of a committed AI step's optional `secrets` array is a strict `AiStepSecretGrant`; it records the authorized reference and its locally derived grant provenance. [repo:src/core/ir/schema.ts:684]

| field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- |
| `ref` | `SecretRef` | required | whole secret-reference grammar | Authorized secret reference. | repo:src/core/ir/schema.ts:690 |
| `sourceSpan` | `SourceSpan` | required | strict, one-based inclusive lines | Prompt grant that authorizes `ref`. | repo:src/core/ir/schema.ts:692 |

```json
{"id":"complete-flow","kind":"ai","instruction":"Finish checkout.","secrets":[{"ref":"{{secrets.CARD_NUMBER}}","sourceSpan":{"startLine":4,"endLine":4}}],"instructionCoverage":[{"id":"finish","kind":"success","sourceSpan":{"startLine":1,"startColumn":1,"endLine":1,"endColumn":17}}]}
```

## Generated forms {#generated-forms}

| object | field | type | required/optional | constraint | description | evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `GeneratedFillSecretAction` | `id`, `kind`, `action`, `target`, `secretRef` | as committed fill-secret | required | `kind: action`, `action: fill-secret` | Provider form. | repo:src/core/ir/schema.ts:758 |
|  | `citation` | `Citation` | required | 1–4096 characters | Replaced locally by `secretGrantSpan`. | repo:src/core/ir/schema.ts:763 |
| `GeneratedAiStepSecretGrant` | `ref` | `SecretRef` | required | whole reference | Provider grant ref. | repo:src/core/ir/schema.ts:798 |
|  | `citation` | `Citation` | required | 1–4096 characters | Attribution evidence. | repo:src/core/ir/schema.ts:800 |
| `GeneratedAiStep` | `id`, `kind`, `instruction` | as committed AI | required | `kind: ai` | Shared AI contract. | repo:src/core/ir/schema.ts:814 |
|  | `secrets` | generated grants[] | optional | strict entries | Pending grant attribution. | repo:src/core/ir/schema.ts:816 |
|  | `instructionCoverage` | generated criteria[] | required | min 1 | Pending criterion attribution. | repo:src/core/ir/schema.ts:817 |
|  | `verificationIntent` | `VerificationIntent[]` | required | min 1 in strict form | Transient verification proposals. | repo:src/core/ir/schema.ts:818 |

## Rationale {#rationale}

The problem is preventing actions from being mistaken for proof, particularly where a UI can produce a wrong pass. Explicit assertion branches make observed success criteria inspectable. 

The selected discriminated union gives every opcode a closed field contract and separates secret filling from ordinary text. Provider citations are transformed into local spans before a plan is committed. 

Verbatim provider citations bind each criterion to one locally checked prompt excerpt; local conversion to a four-coordinate `InstructionSourceSpan` makes the committed attribution precise without asking the provider to count lines.  [repo:src/usecases/instruction-coverage-policy.ts:337-415]

Terminal `url-matches` is rejected because it is a tautological success form rather than independent proof of the cited success criterion. Use a supported, non-duplicative terminal `TraceAssert`; if the success condition cannot be represented, generation fails.  [repo:src/usecases/instruction-coverage-policy.ts:361-365] [repo:src/usecases/instruction-coverage-policy.ts:589-606]

One rejected alternative used one action object with optional payload fields; it was rejected because invalid combinations become schema-invisible. Another let generic text carry secrets; it was rejected because secret provenance and redaction would be ambiguous.  
