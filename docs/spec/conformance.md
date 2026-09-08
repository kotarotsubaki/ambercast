# Conformance

## Structural validation {#structural-validation}

Ambercast's publication pipeline MUST derive Plan, Grounding, and configuration JSON Schema from the Zod runtime schemas, not maintain a hand-written parallel schema. [repo:src/core/ir/schema.ts:5] [repo:src/core/config/schema.ts:1] The build tool serializes the following projections and package exports expose their generated files. [repo:src/build-tools/generate-json-schema.ts:29-50] [repo:package.json:23-35]

| Zod projection | JSON Schema getter | generated file | package export |
| --- | --- | --- | --- |
| `PlanDocument` | `getPlanJsonSchema()` | `plan.schema.json` | `ambercast/schema/plan.json` → `./dist/schema/plan.schema.json` |
| `GroundingDocument` | `getGroundingJsonSchema()` | `grounding.schema.json` | `ambercast/schema/grounding.json` → `./dist/schema/grounding.schema.json` |
| `RawConfig` | `getConfigJsonSchema()` | `config.schema.json` | `ambercast/schema/config.json` → `./dist/schema/config.schema.json` |

The Plan and Grounding getters derive their values from `PlanDocument` and `GroundingDocument`; the configuration getter derives its value from `RawConfig`. [repo:src/core/ir/json-schema.ts:15-37] [repo:src/core/config/json-schema.ts:7-24] An external consumer conforms when it validates the published structural and semantic contract; it need not use Zod or reproduce Ambercast's publication pipeline.

## Semantic validation {#semantic-validation}

JSON Schema validation alone is insufficient. A conforming validator MUST additionally enforce the following. Issue codes are stable implementation values; a policy issue is mapped by its caller (generation, check, or run) rather than defining a second public status here. [repo:src/usecases/instruction-coverage-policy.ts:70]

| id | applicable target | constraint | issue code / failure | evidence |
| --- | --- | --- | --- | --- |
| CON-01 | Plan | Plan step IDs MUST be unique. | `duplicate step id: <id>` | repo:src/core/ir/schema.ts:1195 |
| CON-02 | `SourceSpan` | `endLine` MUST be at least `startLine`. | `endLine must be greater than or equal to startLine` | repo:src/core/ir/schema.ts:261 |
| CON-03 | generated criteria | Citation MUST be non-whitespace and occur exactly once in normalized prompt. | `citation-whitespace-only`, `citation-not-found`, `citation-not-unique` | repo:src/usecases/instruction-coverage-policy.ts:376 |
| CON-04 | generated criteria | Criterion IDs and resolved citation ranges MUST be unique; citation boundaries MUST NOT split a surrogate pair. | `criterion-id-duplicate`, `criterion-range-duplicate`, `source-span-invalid` | repo:src/usecases/instruction-coverage-policy.ts:376 |
| CON-05 | generated AI step | At least one criterion MUST be `success`; success IDs and verification-intent IDs MUST form an exact bijection. | `success-criterion-missing`, `intent-id-duplicate`, `intent-id-missing`, `intent-id-unknown`, `intent-id-action` | repo:src/usecases/instruction-coverage-policy.ts:418 |
| CON-06 | generated verification intent | Terminal assertion MUST be a supported `TraceAssert` and MUST NOT be `url-matches`. | `intent-assertion-unsupported`, `terminal-url-matches-forbidden` | repo:src/usecases/instruction-coverage-policy.ts:433 |
| CON-07 | committed criteria | Criteria MUST be nonempty, have unique IDs and spans, re-extract to non-whitespace prompt text, and use valid nonzero-width UTF-16 coordinates. | `criterion-id-duplicate`, `criterion-range-duplicate`, `source-span-invalid`, `source-span-whitespace-only`, `success-criterion-missing` | repo:src/usecases/instruction-coverage-policy.ts:467 |
| CON-08 | committed criteria | Criteria MUST already be in canonical source/end/kind/ID order. | `criterion-order-invalid` | repo:src/usecases/instruction-coverage-policy.ts:489 |
| CON-09 | committed secret claims | Every persisted claim MUST match a current grant span and reference; a grant MUST have exactly one claimant; no parsed grant MUST remain unused. | `stale-grant-span`, `multiply-attributed-grant`, `uncovered-grant` | repo:src/usecases/generator-secret-policy.ts:365 |
| CON-10 | generated secret claim | A provider citation MUST occur exactly once, contain its `SecretRef`, and resolve to exactly one parsed grant. | `citation-not-found`, `citation-not-unique`, `citation-missing-ref`, `citation-unresolved` | repo:src/usecases/generator-secret-policy.ts:275 |
| CON-11 | grounding coverage | `verificationCoverage` MUST map every success criterion and only success criteria to one distinct in-range terminal-verification index; every terminal index MUST be mapped. | `verification-coverage-id-missing`, `verification-coverage-id-unknown`, `verification-coverage-id-action`, `verification-coverage-index-duplicate`, `verification-coverage-index-invalid` | repo:src/usecases/instruction-coverage-policy.ts:560 |
| CON-12 | grounding terminal evidence | A terminal assertion MUST NOT be `url-matches` or duplicate an event assertion after run-value materialization. | `terminal-url-matches-forbidden`, `verification-assertion-repeated` | repo:src/usecases/instruction-coverage-policy.ts:589 |
| CON-13 | grounding binding | Grounding MUST be accepted only when its `planDigest` equals the recomputed Plan digest. | inspection classification `stale` | repo:src/usecases/check-grounding.ts:45 |
| CON-14 | coverage-bearing grounding bytes | A grounding document that claims coverage MUST use canonical artifact bytes. | inspection classification `invalid` | repo:src/usecases/check-grounding.ts:57 |
| CON-15 | cached AI trace secret use | Every `TraceFillSecret.secretRef` MUST belong to the containing Plan AI step's committed grant set. Violation is an integrity failure and MUST NOT fall back. | integrity failure | repo:src/usecases/run.ts:896 |
| CON-16 | navigation | Every Plan, cached-trace, and fresh-agentic navigation MUST resolve against the target `baseUrl`, use HTTP(S), and remain target same-origin. | integrity failure | repo:src/usecases/run.ts:701 |
| CON-17 | cached AI trace secret markers | Every string-valued descendant of a cached AI trace, except the dedicated `TraceFillSecret.secretRef` field, MUST NOT contain the contiguous `{{secrets.` marker. Violation is an integrity failure and MUST NOT fall back. | integrity failure | repo:src/usecases/run.ts:984 |
| CON-18 | cached AI trace `RunRef` | A `RunRef` MUST be well formed, name only a capture variable declared before the containing AI step, and have a value available in the current case. Malformed, unauthorized, or unavailable references are integrity failures and MUST NOT fall back. | integrity failure | repo:src/usecases/run.ts:648 [repo:src/usecases/run.ts:3180] |
| CON-19 | cached AI trace materialized secrets | Before replay, resolve each granted `fill-secret` reference in the trace's events and verification lists; together with current-case resolved values, scan every value except fixed `type`, `check`, `target.strategy`, `key`, and `secretRef` vocabulary. A nonempty resolved secret is forbidden by exact match, and by substring match when it has at least 3 UTF-16 code units. | integrity failure; MUST NOT fall back | repo:src/usecases/run.ts:1075-1129; repo:src/usecases/run.ts:1252-1313; repo:src/usecases/run.ts:2190-2209 |
| CON-20 | stored and fresh AI `fill.value` credential literals | Stored traces and fresh agentic actions MUST reject `sk-`, `ghp_`, and `AKIA` fill values unconditionally. A high-entropy fill value is accepted only when its residual text after removal of captured current-case values has no detector match. Stored-trace failure MUST NOT fall back; fresh failure occurs before browser execution or journal persistence. | integrity failure | repo:src/usecases/run.ts:984-1040; repo:src/usecases/run.ts:1350-1405; repo:src/usecases/run.ts:1954-1975; repo:src/usecases/run.ts:2190-2209 |
| CON-21 | captured values across AI boundaries | A legacy stored trace without `verificationCoverage` MUST NOT contain a nonempty captured current-case value, except an unresolved `{{run.name}}` placeholder, in any non-fixed-vocabulary value; the check is substring matching. Fresh agentic navigation URLs, fill values, and assertion text/patterns MUST NOT exactly equal a captured value. These values MUST use authorized `RunRef` interpolation instead; violations fail before the stored trace reaches browser/provider fallback or fresh input reaches browser/persistence. | integrity failure | repo:src/usecases/run.ts:1013-1063; repo:src/usecases/run.ts:1316-1347; repo:src/usecases/run.ts:1420-1458; repo:src/usecases/run.ts:2190-2209 |
| CON-22 | fresh agentic action/assert materialized secrets | Before materialization, every fresh agentic action and assertion MUST scan non-fixed-vocabulary values against every nonempty resolved secret observed in the case. The only closed-vocabulary exclusions are `type`, `check`, `target.strategy`, `key`, and `secretRef`. Exact equality is forbidden for every nonempty secret; substring matching is forbidden when the secret is at least 3 UTF-16 code units. A match is an integrity failure before browser execution, journal append, Grounding update, or persistence. | integrity failure | repo:src/usecases/run.ts:1252-1263; repo:src/usecases/run.ts:1286-1313; repo:src/usecases/run.ts:1420-1427; repo:src/usecases/run.ts:1954-1975; repo:src/usecases/run.ts:1991-2013; repo:src/usecases/run.ts:2051-2116 |
| CON-23 | positional/discovered prompt-path selection | A selected prompt path MUST resolve inside `testDir` with an exact `.test.md` suffix and a non-empty name component, checked once for the whole selection before any per-file work begins; `--list` MUST NOT apply this check. | `PROMPT_PATH_INVALID` | repo:src/core/layout/resolve.ts:191; repo:src/usecases/prompt-path-eligibility.ts:25 |

CON-23 applies during file selection, before every other CON item. CON-03 through CON-06 and CON-10 apply before Plan construction; CON-07 through CON-09 apply to committed Plans; CON-11 through CON-22 apply to Grounding/replay validation. Grounding/replay validation checks trace secret-marker, resolved-secret, credential-literal, and captured-value boundaries, plus dynamic `RunRef` authority, before browser operations receive materialized values. [repo:src/usecases/instruction-coverage-policy.ts:337] [repo:src/usecases/generator-secret-policy.ts:191] [repo:src/usecases/check-grounding.ts:18] [repo:src/usecases/run.ts:648] [repo:src/usecases/run.ts:984]

## Verification procedure {#verification-procedure}

Consumers MUST parse the artifact structurally, calculate current digests under [[spec/freshness#inputs-digest]], then apply semantic checks before replay. A failed Grounding validation MUST NOT authorize cached replay. [repo:src/core/ir/schema.ts:215] [repo:src/core/ir/digest.ts:145]

## Rationale {#rationale}

The problem is that portable JSON Schema can validate shape but cannot compare sibling values, prompt source, or relationships across records. 

The chosen design makes the small semantic layer explicit and reports stable error codes after structural parsing. It keeps all expressible constraints in Zod/derived JSON Schema. 

One rejected alternative hid all rules in non-portable refinements; it was rejected because schema consumers would lose them. Another relied only on JSON Schema; it was rejected because provenance and coverage cannot be proven from isolated JSON values.  
