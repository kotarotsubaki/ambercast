# Specification changelog

## Version history {#version-history}

| Change | Evidence | Migration obligation |
| --- | --- | --- |
| Plan v1 → v2 adds instruction coverage | repo:src/core/ir/schema.ts:45, repo:src/core/ir/schema.ts:1185 | Producers and consumers MUST reject v1 and regenerate or report it stale; they MUST NOT migrate it in place. [repo:src/core/ir/schema.ts:50] |
| fingerprint v1 → v2 | repo:CHANGELOG.md:78 | v2 is the only accepted tag. A current-provenance document with a coverage claim MUST fail integrity if strict/canonical validation then fails; a companion without that claim may be a cache miss in `run`, while `check` grounding inspection classifies schema-invalid content as `invalid` (public status per [[spec/freshness#freshness-consequences]]). [repo:src/usecases/run.ts:498] [repo:src/usecases/check-grounding.ts:45] |
| producer bundle fingerprint enters `inputsDigest` | repo:CHANGELOG.md:8 | Plans generated before the change MUST be regenerated because they are stale. [repo:CHANGELOG.md:8] |
| report 2.0 → 3.0 | repo:CHANGELOG.md:55, repo:CHANGELOG.md:58 | Report consumers MUST accept the current `3.0` contract, not infer compatibility from the Plan version. [repo:src/report/schema.ts:15] |
| report 3.0 → 3.1 | repo:src/report/schema.ts:22 | Report consumers MUST accept the current `3.1` contract, including optional structured error diagnostics, rather than infer compatibility from the Plan version. [repo:src/report/schema.ts:22] |
| report 3.1 → 3.2 | repo:src/report/schema.ts:30 | Report consumers MUST accept the current `3.2` contract, including the optional `PROMPT_PATH_INVALID` details branch, rather than infer compatibility from the Plan version. [repo:src/report/schema.ts:30] |
| report 3.2 → 3.3 | repo:src/report/schema.ts:30 | Report consumers MUST accept the current `3.3` contract, including optional AI-call accounting fields, rather than infer compatibility from the Plan version. [repo:src/report/schema.ts:30] |
| report 3.3 → 3.4 | repo:src/report/schema.ts:30 | Report consumers MUST accept the current `3.4` contract, including the optional `BROWSER_LAUNCH_FAILED` details branch, rather than infer compatibility from the Plan version. [repo:src/report/schema.ts:30] |

## Compatibility policy {#compatibility-policy}

Artifact version acceptance MUST follow [[spec/overview#compatibility]], not release-number intuition. A schema-version change MAY require regeneration in a minor release because plans are derived artifacts. [repo:src/core/ir/schema.ts:45] 

## Rationale {#rationale}

The changelog records compatibility changes and their regeneration consequence in one normative location, so a consumer need not infer artifact compatibility from package versioning. 

One rejected alternative tracked only package releases; it was rejected because a producer-contract fingerprint change can stale plans without changing the Plan schema version. [repo:CHANGELOG.md:8] [repo:src/core/ir/schema.ts:45]
