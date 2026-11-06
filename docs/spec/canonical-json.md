# Canonical JSON

This chapter defines the compact digest form, the indented artifact form, and the atomic-visibility contract for storage writes.

## Digest form {#digest-form}

Digest inputs MUST use compact RFC 8785-compatible JSON encoded as UTF-8, with no inter-token whitespace. [repo:src/core/ir/canonical-json.ts:173-182] Object keys MUST sort in UTF-16 order. [repo:src/core/ir/canonical-json.ts:153] Non-finite numbers and unpaired UTF-16 surrogates MUST be rejected. [repo:src/core/ir/canonical-json.ts:100-101] [repo:src/core/ir/canonical-json.ts:20]

JCS application is recursive. [repo:src/core/ir/canonical-json.ts:91-128,130-145,147-170]

- Strings are JSON-escaped after rejecting unpaired surrogates.
- Finite numbers use ECMAScript number rendering.
- Booleans are `true` or `false`, and null is `null`.
- Arrays retain order.
- Objects sort keys.
- Undefined, bigint, function, symbol, and non-plain objects are rejected.

UTF-8 bytes of that compact text, not JavaScript object identity or pretty text, are the digest preimage. [repo:src/core/ir/canonical-json.ts:181-182]

## Artifact form {#artifact-form}

Committed artifacts MUST use the canonical artifact form: the same key ordering and scalar rendering as digest form, two-space indentation, and a final newline. [repo:src/core/ir/canonical-json.ts:190-196] Producers MUST NOT use pretty JSON bytes as a digest preimage. [repo:src/core/ir/canonical-json.ts:23]

## Persistence {#persistence}

Storage writes MUST have atomic visibility: readers see a complete old file or complete new file, never a partial write. [repo:src/ports/storage.ts:178-182] Callers MUST ignore reserved `.ambercast-tmp-` staging names if listed after interrupted writes. [repo:src/ports/storage.ts:111-114]

An atomic writer MAY use the reserved temporary prefix and rename strategy used by the filesystem adapter, but that staging mechanism is not a portable conformance requirement. Every `StorageAdapter.writeText` implementation MUST provide the atomic-visibility contract above. [repo:src/ports/storage.ts:111-114,178-182] The on-disk form is two-space indented, sorted with the same scalar rendering as the digest form, and ends in one newline. [repo:src/core/ir/canonical-json.ts:190-196]

## Rationale {#rationale}

The problem is making hashes independent of incidental JSON formatting while preserving artifacts humans can review.

The selected single value walker has compact digest and pretty artifact outputs, so ordering and scalar semantics cannot drift between the two.

One rejected alternative used pretty bytes for hashing; it was rejected because whitespace becomes semantic. Another delegated ordering to each caller; it was rejected because equivalent values would then have non-repeatable digests.
