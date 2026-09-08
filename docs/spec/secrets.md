# Secrets in plans

## Authorization {#authorization}

Plans MUST represent secret values only with [[spec/value-types#shared-types]] `SecretRef`; the contiguous `{{secrets.` interpolation marker is forbidden from `InterpolatableText`. [repo:src/core/ir/schema.ts:33] [repo:src/core/ir/schema.ts:125] `fill-secret` MUST carry its `SourceSpan`; AI secret grants MUST carry one span per reference. [repo:src/core/ir/schema.ts:515] [repo:src/core/ir/schema.ts:690]

## Grant origin {#grant-origin}

Authorization MUST come from a complete `@ambercast-secret {{secrets.X}}` line in normalized prompt text, outside CommonMark code constructs. [repo:src/core/ir/secret-grant-source.ts:4] Repeated lines are distinct grant occurrences, and their spans are one-based physical lines. [repo:src/core/ir/secret-grant-source.ts:28]

Attribution MUST locate the provider citation exactly once in normalized prompt text, require that it contains the named literal reference, then resolve that unique range to exactly one parsed grant; otherwise generation surfaces `citation-not-found`, `citation-not-unique`, `citation-missing-ref`, or `citation-unresolved`. [repo:src/core/errors/secret-grant-unattributable-error.ts:77] The committed form records `SourceSpan`, never the provider citation. [repo:src/core/ir/schema.ts:515-520] [repo:src/core/ir/schema.ts:690-692] [repo:src/core/ir/schema.ts:758-763] [repo:src/core/ir/schema.ts:798-800]

## Sink and redaction {#sink-and-redaction}

Secret sink origins MUST be HTTP(S) origins and MUST NOT contain the contiguous `{{secrets.` interpolation marker; this schema constraint does not itself prove the absence of arbitrary secret-looking literals. [repo:src/core/ir/schema.ts:83] [repo:src/core/ir/schema.ts:95] Consumers MUST preserve references rather than literal passwords in committed grounding trace data. [repo:src/core/ir/schema.ts:949]

The sink policy parses and normalizes origins at runtime; an absent configured entry for the requested secret in `secretSinkOrigins` allows only `baseUrl`, an empty entry allows none, and a non-empty entry replaces that default. For each actual `fill-secret`, the run pipeline MUST check the live page origin immediately before resolving its secret; the browser adapter MUST repeat the policy after element acquisition and immediately before filling, so navigation or DOM changes cannot bypass the live-origin boundary. [repo:src/core/ir/schema.ts:152-157] [repo:src/usecases/run.ts:765] [repo:src/usecases/run.ts:896] [repo:src/adapters/browser/chromium.ts:413]

## Literal-secret rejection {#literal-secret-rejection}

This section is the canonical owner of literal-secret detector semantics. Reference pages MUST only summarize the detector boundary for their local purpose and link here. Before persistence or report serialization, generation MUST inspect every provider-derived JSON string and object key, including `generatorMeta` and ambiguities, using lexical-key and array-index traversal order. For each string value or object key, an embedded `{{secrets.` marker (SEC-17) MUST be rejected before the four primitive detectors below are checked; among those, the first match in the fixed order below MUST be rejected. [repo:src/usecases/generator-secret-policy.ts:585]

| id | detector | matching value | exception | classified failure |
| --- | --- | --- | --- | --- |
| SEC-01 | `credential-prefix-sk` | begins `sk-` | a valid whole-value `SecretRef` in a string value or object key; `source.inputsDigest` only | `SECRET_LITERAL_REJECTED`, exit `2` |
| SEC-02 | `credential-prefix-ghp` | begins `ghp_` | a valid whole-value `SecretRef` in a string value or object key; `source.inputsDigest` only | `SECRET_LITERAL_REJECTED`, exit `2` |
| SEC-03 | `credential-prefix-aws-access-key` | begins `AKIA` | a valid whole-value `SecretRef` in a string value or object key; `source.inputsDigest` only | `SECRET_LITERAL_REJECTED`, exit `2` |
| SEC-04 | `high-entropy-token` | token-shaped (at least 32 UTF-16 code units, no whitespace, every character in `[A-Za-z0-9+/=_.-]`) and Shannon entropy at least 4.0 bits, with frequency keys iterated as Unicode code points but each probability denominator using the UTF-16 code-unit length | a valid whole-value `SecretRef` in a string value or object key; `source.inputsDigest` only; also exempt at a `steps[<index>].url`, `steps[<index>].pattern`, or `targets[<key>].baseUrl` value position | `SECRET_LITERAL_REJECTED`, exit `2` |
| SEC-17 | `embedded-secret-reference` | a string value or object key, other than a valid whole-value `SecretRef`, containing the `{{secrets.` marker | `source.inputsDigest` only | `SECRET_LITERAL_REJECTED`, exit `2` |

A valid whole-value `SecretRef` exempts a string value or object key from every detector in this section; every other key is passed to the detector before its value is traversed. The rejection diagnostic MUST contain only detector and redacted JSON-like path; it MUST NOT retain the detected literal, and a detected object key uses `[redacted-key]`. [repo:src/usecases/generator-secret-policy.ts:585] [repo:src/usecases/generator-secret-policy.ts:615] [repo:src/report/error-mapping.ts:23] [repo:src/core/errors/exit-codes.ts:31]

## Boundary-specific secrecy requirements {#boundary-specific-secrecy}

| id | boundary | requirement | evidence |
| --- | --- | --- | --- |
| SEC-05 | generation | Provider-derived JSON MUST pass literal-secret rejection before persistence or report serialization. | repo:src/usecases/generator-secret-policy.ts:585 |
| SEC-06 | fingerprint generation | A descriptor containing a nonempty resolved secret as an exact match MUST produce `secret-contaminated`; substring matching applies only when the comparison value is at least 3 UTF-16 code units, and it MUST NOT yield a fingerprint. | repo:src/core/ir/fingerprint.ts:278 |
| SEC-07 | committed traces | `TraceFillSecret` MUST store `secretRef`, not a materialized value. | repo:src/core/ir/schema.ts:949 |
| SEC-08 | grounding persistence | The run pipeline MUST refuse to write grounding when a scanned string value exactly equals any nonempty resolved secret, or contains one whose resolved value is at least 3 UTF-16 code units; it MUST classify this as an integrity violation. | repo:src/usecases/run.ts:1252 [repo:src/usecases/run.ts:3425] |
| SEC-09 | diagnostics and reportable errors | The run pipeline MUST redact JSON strings and object keys before diagnostics/report serialization. | repo:src/usecases/run.ts:1542 |
| SEC-10 | AI-bound accessibility evidence | Accessibility evidence sent to an AI provider MUST redact resolved values from string values and object keys; screenshot bytes MUST NOT cross this boundary. | repo:src/usecases/run.ts:2023 |
| SEC-11 | screenshot persistence | A screenshot MUST NOT be retained when resolved-secret detection finds a value in accessibility capture, capture is uninspectable after resolution, or detection fails. | repo:src/usecases/run.ts:2550 |
| SEC-12 | AI trace secret markers | Every string-valued descendant of a cached AI trace, except the dedicated `TraceFillSecret.secretRef` field, MUST NOT contain the contiguous `{{secrets.` marker. A violation is an integrity failure and MUST NOT fall back to provider execution. | repo:src/usecases/run.ts:984 |
| SEC-13 | cached AI trace materialized secrets | Before replay, the pipeline MUST resolve each `fill-secret` reference in the stored trace's events and verification lists that is granted by the containing Plan AI step. The resulting values join values already resolved in the current case. It MUST then scan every trace value except the fixed `type`, `check`, `target.strategy`, `key`, and `secretRef` vocabulary; an exact match of any nonempty resolved secret, or a substring match when that secret has at least 3 UTF-16 code units, is an integrity failure and MUST NOT fall back to provider execution. | repo:src/usecases/run.ts:1075-1129; repo:src/usecases/run.ts:1252-1313; repo:src/usecases/run.ts:2190-2209 |
| SEC-14 | AI `fill.value` credential literals | Before browser execution, stored-trace and fresh agentic `fill.value` MUST reject the `sk-`, `ghp_`, and `AKIA` detectors unconditionally. A high-entropy match is permitted only when removing captured current-case values leaves no detector match; this exception does not apply to the prefix detectors. A violation is an integrity failure: stored trace validation MUST NOT fall back, and fresh agentic execution MUST NOT reach browser execution or journal persistence. | repo:src/usecases/run.ts:984-1040; repo:src/usecases/run.ts:1350-1405; repo:src/usecases/run.ts:1954-1975; repo:src/usecases/run.ts:2190-2209 |
| SEC-15 | captured run values at provider boundaries | A legacy stored trace without `verificationCoverage` MUST NOT contain a nonempty current-case captured value, except an unresolved `{{run.name}}` placeholder, in any non-fixed-vocabulary value; matching is by substring. Fresh agentic navigation URLs, `fill.value`, and text/assertion patterns MUST NOT exactly equal a current-case captured value. Stored-trace violations fail before browser replay or a provider receives `priorTrace`; fresh violations fail before browser execution and persistence. Consumers MUST use authorized `RunRef` interpolation rather than materializing captured values. | repo:src/usecases/run.ts:1013-1063; repo:src/usecases/run.ts:1316-1347; repo:src/usecases/run.ts:1420-1458; repo:src/usecases/run.ts:2190-2209 |
| SEC-16 | fresh agentic action/assert materialized secrets | Before materialization, every fresh agentic action and assertion MUST scan its non-fixed-vocabulary values against all nonempty resolved secrets in the current case. `type`, `check`, `target.strategy`, `key`, and `secretRef` are the only closed-vocabulary exclusions. A scanned value MUST fail on exact equality, or on containing a resolved secret of at least 3 UTF-16 code units. The failure is an integrity failure before browser execution; it MUST NOT append the action or passing assertion to the journal, update Grounding, or reach artifact persistence. | repo:src/usecases/run.ts:1252-1263; repo:src/usecases/run.ts:1286-1313; repo:src/usecases/run.ts:1420-1427; repo:src/usecases/run.ts:1954-1975; repo:src/usecases/run.ts:1991-2013; repo:src/usecases/run.ts:2051-2116 |

Canvas, image, and CSS-rendered pixels, plus the interval between accessibility scanning and screenshot capture, remain residual disclosure risks; this implementation does not claim to detect them. [repo:src/usecases/run.ts:2610]

For every `TraceFillSecret`, the recorded `secretRef` MUST be contained in the enclosing Plan AI step's grant set. An ungranted reference is an integrity failure and MUST NOT cause fallback. [repo:src/usecases/run.ts:896] [repo:src/usecases/run.ts:1075]

## Rationale {#rationale}

The problem is allowing an agent to fill a required credential without turning prompt prose, logs, or UI evidence into a secret channel. Authorization must be auditable and narrow. 

The selected design requires an explicit normalized-prompt grant, locally attributed span, whole-value reference, and allowed sink origin. It is fail-closed when any link in that chain is ambiguous. 

One rejected alternative inferred permission from matching text; it was rejected because examples and prose are not authorization. Another persisted literal values in traces; it was rejected because committed artifacts and diagnostics are long-lived disclosure surfaces.  
