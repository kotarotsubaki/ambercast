# Element fingerprint

This chapter defines the element fingerprint that grounding stores for an element step, how the fingerprint is computed, and how a stored fingerprint is matched.

## Algorithm {#algorithm}

`Fingerprint.algorithm` MUST be `a11y-neighborhood-v2`. [repo:src/core/ir/schema.ts:303] [repo:src/core/ir/schema.ts:320] Its descriptor comprises the target role/name plus direct parent and immediately preceding/following sibling role/name. Only an absent adjacent sibling is `null`; a matching node always has a direct parent, and a top-level node uses the synthetic root as that parent. [repo:src/core/ir/fingerprint.ts:174] [repo:src/core/ir/fingerprint.ts:216] Names MUST be NFC-normalized, whitespace-collapsed, and trimmed; roles remain exact. [repo:src/core/ir/fingerprint.ts:106]

The algorithm [repo:src/core/ir/fingerprint.ts:241] [repo:src/core/ir/fingerprint.ts:348] MUST:

1. Parse a valid accessibility tree.
2. Find exactly one node whose role exactly equals the reference and whose name matches after NFC, whitespace-run collapse, and trim.
3. Build `{role,name,parent,siblingBefore,siblingAfter}`.
4. Encode absent siblings as `null`.
5. Serialize the descriptor as RFC 8785-compatible canonical UTF-8 JSON.
6. SHA-256 those bytes.
7. Store lowercase hexadecimal output with the v2 tag.

Descendants and non-adjacent siblings MUST NOT enter the preimage. [repo:src/core/ir/fingerprint.ts:46-50]

## Digest {#digest}

Implementations MUST serialize the descriptor with [[spec/canonical-json#digest-form]] and SHA-256 it. [repo:src/core/ir/fingerprint.ts:6] [repo:src/core/ir/digest.ts:35]

A tag other than v2 fails strict Grounding schema validation. [repo:src/core/ir/schema.ts:319-322]

In `run`, a current-provenance raw Grounding document that claims `trace.verificationCoverage` turns a subsequent strict or canonical failure into an integrity failure. Without that claim, the unusable companion is a cache miss. [repo:src/usecases/run.ts:773-851]

In `check`, grounding inspection classifies a schema-invalid companion as `invalid` before provenance comparison. The public report status is the repository-policy mapping defined in [[spec/freshness#freshness-consequences]]. [repo:src/usecases/check-grounding.ts:50]

## Matching {#matching}

A fingerprint mismatch MUST be treated as a miss, never as evidence that the old element is safe to replay. This follows the implemented version gate and mismatch invalidation. [repo:src/core/ir/schema.ts:320] [repo:src/core/ir/fingerprint.ts:436]

`hit`, `fingerprint-mismatch`, `element-not-found`, `ambiguous-match`, and `snapshot-invalid` are distinct resolution outcomes. An absent or malformed tree is `element-not-found`; more than one normalized role/name match is `ambiguous-match`; an old or differing hash is `fingerprint-mismatch`. [repo:src/core/ir/fingerprint.ts:348] [repo:src/core/ir/fingerprint.ts:436] An unpaired surrogate produces no fingerprint at generation and `element-not-found` at resolution. [repo:src/core/ir/fingerprint.ts:57-59] [repo:src/core/ir/fingerprint.ts:251-253]

An empty-name reference matches only nodes whose normalized name is empty.

## Quote matching {#quote-matching}

`matchQuotedCandidates(tree, {text, roleHint?})` makes one linear accessibility-tree walk from the synthetic root's children, in fingerprint matching order. It applies `normalizeName` (NFC, whitespace-run collapse, trim) to both literal query text and node names, compares an optional role hint exactly, and never interpolates `{{run.x}}`-shaped strings. It returns ordered `{role, name}` pairs or `{kind: 'snapshot-invalid'}` for an invalid tree. [repo:src/core/ir/fingerprint.ts:106-108] [repo:src/core/ir/fingerprint.ts:125-172]

This primitive serves first binding's literal-quote polling and local verification of an AI proposal, as well as the grounding-free evaluation of element assertions; see [[spec/steps#step-union]].

## Rationale {#rationale}

The problem is detecting local UI drift without allowing a stale locator to replay against a visually similar element. The bounded neighborhood makes that evidence explicit.

The chosen design hashes target, parent, and immediately adjacent siblings after stable text normalization. It distinguishes a miss from a match rather than permitting heuristic reuse.

One rejected alternative was a whole-tree hash; it was rejected because unrelated changes create excessive misses. Another was selector-derived identity; it was rejected because selectors are implementation detail rather than retained intent evidence.

The v1 parser could not provide fail-closed scanning of accessibility evidence. Version 2 changes the algorithm tag so a v1 fingerprint cannot be interpreted as v2 evidence. Its operational outcome follows the current-provenance and coverage-claim rules in [[spec/fingerprint#digest]], rather than unconditionally falling back to re-resolution. [repo:CHANGELOG.md:257] [repo:src/usecases/run.ts:773-851]
