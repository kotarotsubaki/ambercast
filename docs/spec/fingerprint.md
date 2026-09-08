# Element fingerprint

## Algorithm {#algorithm}

`Fingerprint.algorithm` MUST be `a11y-neighborhood-v2`. [repo:src/core/ir/schema.ts:221] Its descriptor comprises the target role/name plus direct parent and immediately preceding/following sibling role/name. Only an absent adjacent sibling is `null`; a matching node always has a direct parent, and a top-level node uses the synthetic root as that parent. [repo:src/core/ir/fingerprint.ts:164] [repo:src/core/ir/fingerprint.ts:259] Names MUST be NFC-normalized, whitespace-collapsed, and trimmed; roles remain exact. [repo:src/core/ir/fingerprint.ts:82]

The algorithm MUST: (1) parse a valid accessibility tree; (2) find exactly one node whose role exactly equals the reference and whose name matches after NFC, whitespace-run collapse, and trim; (3) build `{role,name,parent,siblingBefore,siblingAfter}`; (4) encode absent siblings as `null`; (5) serialize the descriptor as RFC 8785-compatible canonical UTF-8 JSON; (6) SHA-256 those bytes; and (7) store lowercase hexadecimal output with the v2 tag. [repo:src/core/ir/fingerprint.ts:240,340] Descendants and non-adjacent siblings MUST NOT enter the preimage. [repo:src/core/ir/fingerprint.ts:39]

## Digest {#digest}

Implementations MUST serialize the descriptor with [[spec/canonical-json#digest-form]] and SHA-256 it. [repo:src/core/ir/fingerprint.ts:6] [repo:src/core/ir/digest.ts:33] A tag other than v2 fails strict Grounding schema validation. In `run`, a current-provenance raw Grounding document that claims `trace.verificationCoverage` turns a subsequent strict or canonical failure into an integrity failure; without that claim, the unusable companion is a cache miss. [repo:src/core/ir/schema.ts:215] [repo:src/usecases/run.ts:498] In `check`, grounding inspection classifies a schema-invalid companion as `invalid` before provenance comparison; the public report status is the repository-policy mapping defined in [[spec/freshness#freshness-consequences]]. [repo:src/usecases/check-grounding.ts:45]

## Matching {#matching}

A fingerprint mismatch MUST be treated as a miss, never as evidence that the old element is safe to replay. This follows the implemented version gate and mismatch invalidation. [repo:src/core/ir/schema.ts:215] [repo:src/core/ir/fingerprint.ts:39]

`hit`, `fingerprint-mismatch`, `element-not-found`, `ambiguous-match`, and `snapshot-invalid` are distinct resolution outcomes. An absent or malformed tree is `element-not-found`; more than one normalized role/name match is `ambiguous-match`; an old or differing hash is `fingerprint-mismatch`. [repo:src/core/ir/fingerprint.ts:347,388] An unpaired surrogate produces no fingerprint at generation and `element-not-found` at resolution. [repo:src/core/ir/fingerprint.ts:181]

## Rationale {#rationale}

The problem is detecting local UI drift without allowing a stale locator to replay against a visually similar element. The bounded neighborhood makes that evidence explicit. 

The chosen design hashes target, parent, and immediately adjacent siblings after stable text normalization. It distinguishes a miss from a match rather than permitting heuristic reuse. 

One rejected alternative was a whole-tree hash; it was rejected because unrelated changes create excessive misses. Another was selector-derived identity; it was rejected because selectors are implementation detail rather than retained intent evidence.  

The v1 parser could not provide fail-closed scanning of accessibility evidence. Version 2 changes the algorithm tag so a v1 fingerprint cannot be interpreted as v2 evidence. Its operational outcome follows the current-provenance and coverage-claim rules in [[spec/fingerprint#digest]], rather than unconditionally falling back to re-resolution. [repo:CHANGELOG.md:78] [repo:src/usecases/run.ts:498]
