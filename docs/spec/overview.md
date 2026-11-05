# Ambercast Plan Specification

## Status {#status}

This specification describes the artifacts accepted by ambercast 0.9.0. The implementation accepts Plan schema version 5 and Grounding schema version 4. [repo:src/core/ir/schema.ts:62] [repo:src/core/ir/schema.ts:74]

## Normative language {#normative-language}

The words **MUST**, **SHOULD**, and **MAY** are to be interpreted as RFC 2119 requirement words. A conforming producer MUST emit only the versions and structures defined here; a consumer MUST reject a structure it cannot validate.

## Dependency model {#dependency-model}

<figure class="ac-flow" aria-label="Dependency chain from the normalized prompt to replay. The digest binds the normalized prompt, schema, producer inputs, and targets. The plan records the digest as its inputsDigest. planDigest binds the replay-relevant plan content. The grounding document is bound to planDigest and accepted only when it equals the recomputed digest. Replay reads the bound grounding.">
<div class="ac-flow-node"><div class="ac-flow-head"><span class="ac-flow-num">PROMPT</span></div><p class="ac-flow-title">Normalized prompt</p></div>
<div class="ac-flow-link"><svg aria-hidden="true" viewbox="0 0 28 52" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2v46M8 42l6 6 6-6"></path></svg><span class="ac-flow-cond"><b>The digest binds the normalized prompt, schema, producer inputs, and targets</b></span></div>
<div class="ac-flow-node"><div class="ac-flow-head"><span class="ac-flow-num">DIGEST</span></div><p class="ac-flow-title">inputsDigest</p></div>
<div class="ac-flow-link"><svg aria-hidden="true" viewbox="0 0 28 52" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2v46M8 42l6 6 6-6"></path></svg><span class="ac-flow-cond"><b>The plan records the digest as its inputsDigest</b></span></div>
<div class="ac-flow-node ac-flow-stage"><div class="ac-flow-head"><span class="ac-flow-num">PLAN</span><span class="ac-flow-chip ac-flow-chip-ai">May call AI</span></div><p class="ac-flow-title">PlanDocument</p></div>
<div class="ac-flow-link"><svg aria-hidden="true" viewbox="0 0 28 52" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2v46M8 42l6 6 6-6"></path></svg><span class="ac-flow-cond"><b>planDigest binds the replay-relevant plan content</b></span></div>
<div class="ac-flow-node"><div class="ac-flow-head"><span class="ac-flow-num">DIGEST</span></div><p class="ac-flow-title">planDigest</p></div>
<div class="ac-flow-link"><svg aria-hidden="true" viewbox="0 0 28 52" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2v46M8 42l6 6 6-6"></path></svg><span class="ac-flow-cond"><b>The grounding document is bound to planDigest and accepted only when it equals the recomputed digest</b></span></div>
<div class="ac-flow-node ac-flow-stage"><div class="ac-flow-head"><span class="ac-flow-num">GROUNDING</span></div><p class="ac-flow-title">GroundingDocument</p></div>
<div class="ac-flow-link"><svg aria-hidden="true" viewbox="0 0 28 52" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2v46M8 42l6 6 6-6"></path></svg><span class="ac-flow-cond"><b>Replay reads the bound grounding</b></span></div>
<div class="ac-flow-node"><div class="ac-flow-head"><span class="ac-flow-num">REPLAY</span><span class="ac-flow-chip ac-flow-chip-replay">No AI calls when the cached grounding replays</span></div><p class="ac-flow-title">Replay</p></div>
</figure>

Every digest path MUST use [[spec/canonical-json#digest-form]]. `inputsDigest` binds normalized prompt, schema, producer inputs, and targets; `planDigest` binds replay-relevant plan content. [repo:src/core/ir/digest.ts:130] [repo:src/core/ir/digest.ts:153]

A Plan records its `inputsDigest`, and `planDigest` is computed from the Plan. A Grounding document is accepted only when its `planDigest` equals the recomputed digest, as [[spec/grounding-document#authority-and-binding]] defines. Replay then reads the bound Grounding.

## Compatibility {#compatibility}

| Artifact | Accepted value | Evidence |
| --- | --- | --- |
| Plan `schemaVersion` | `5` | repo:src/core/ir/schema.ts:62 |
| Grounding `schemaVersion` | `4` | repo:src/core/ir/schema.ts:74 |
| Fingerprint algorithm | `a11y-neighborhood-v2` | repo:src/core/ir/schema.ts:303 |
| Report `schemaVersion` | `3.11` | repo:src/report/schema.ts:58 |

## Reading order {#reading-order}

Read [[spec/plan-document#document-shape]], [[spec/steps#step-union]], and [[spec/value-types#shared-types]] first; then [[spec/freshness#inputs-digest]], [[spec/grounding-document#grounding-shape]], and [[spec/fingerprint#algorithm]]. Implementers MUST finish with [[spec/canonical-json#digest-form]], [[spec/secrets#authorization]], and [[spec/conformance#semantic-validation]].

## Rationale {#rationale}

The problem is that readers must distinguish authored intent from derived execution and volatile grounding before they can safely interpret fields.

The selected dependency-first presentation makes digest boundaries and compatibility versions visible before the detailed schemas.

One rejected alternative was a single undifferentiated artifact; it was rejected because plan and UI evidence have different invalidation rules. Another was chapter-local versioning; it was rejected because compatibility is a document-system contract.
