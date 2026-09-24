# Specification changelog

## Version history {#version-history}

| Change | Evidence | Migration obligation |
| --- | --- | --- |
| TP2 changes target config from `targets.<name>.browser` to `targets.<name>.executor` and adds the `EXECUTOR_UNSUPPORTED` report error code; the Plan schema is unchanged | repo:src/core/config/schema.ts, repo:src/report/error-mapping.ts | Replace the old target browser key with `executor: { kind: "playwright", browser: "chromium" }` when explicit executor selection is needed. Report consumers must recognize `EXECUTOR_UNSUPPORTED`; Plan regeneration is not required by this schema change. |
| Plan v3 → v4 adds required step Target names, renames element references, and removes Plan browser selection | repo:src/core/ir/schema.ts | Regenerate v3 plans; v4 is the accepted Plan format. |
| grounding v1 → v2 renames trace locator fields to `element` | repo:src/core/ir/schema.ts | Regenerate grounding with Plan v4. |
| report 3.6 → 3.7 adds step Target names and per-Target sessions | repo:src/report/schema.ts | Consumers MUST accept report `3.7` fields. |
| Plan v1 → v2 adds instruction coverage | repo:src/core/ir/schema.ts:45, repo:src/core/ir/schema.ts:1185 | Producers and consumers MUST reject v1 and regenerate or report it stale; they MUST NOT migrate it in place. [repo:src/core/ir/schema.ts:50] |
| fingerprint v1 → v2 | repo:CHANGELOG.md:78 | v2 is the only accepted tag. A current-provenance document with a coverage claim MUST fail integrity if strict/canonical validation then fails; a companion without that claim may be a cache miss in `run`, while `check` grounding inspection classifies schema-invalid content as `invalid` (public status per [[spec/freshness#freshness-consequences]]). [repo:src/usecases/run.ts:498] [repo:src/usecases/check-grounding.ts:45] |
| producer bundle fingerprint enters `inputsDigest` | repo:CHANGELOG.md:8 | Plans generated before the change MUST be regenerated because they are stale. [repo:CHANGELOG.md:8] |
| report 2.0 → 3.0 | repo:CHANGELOG.md:55, repo:CHANGELOG.md:58 | Report consumers MUST accept the current `3.0` contract, not infer compatibility from the Plan version. [repo:src/report/schema.ts:15] |
| report 3.0 → 3.1 | repo:src/report/schema.ts:22 | Report consumers MUST accept the current `3.1` contract, including optional structured error diagnostics, rather than infer compatibility from the Plan version. [repo:src/report/schema.ts:22] |
| report 3.1 → 3.2 | repo:src/report/schema.ts:30 | Report consumers MUST accept the current `3.2` contract, including the optional `PROMPT_PATH_INVALID` details branch, rather than infer compatibility from the Plan version. [repo:src/report/schema.ts:30] |
| report 3.2 → 3.3 | repo:src/report/schema.ts:30 | Report consumers MUST accept the current `3.3` contract, including optional AI-call accounting fields, rather than infer compatibility from the Plan version. [repo:src/report/schema.ts:30] |
| report 3.3 → 3.4 | repo:src/report/schema.ts:30 | Report consumers MUST accept the current `3.4` contract, including the optional `BROWSER_LAUNCH_FAILED` details branch, rather than infer compatibility from the Plan version. [repo:src/report/schema.ts:30] |
| Plan v2 → v3 removes secret-grant provenance | repo:src/core/ir/schema.ts:58, repo:src/core/ir/schema.ts:674 | Producers and consumers MUST reject v2 and regenerate or report it stale; they MUST NOT migrate it in place. [repo:src/core/ir/schema.ts:49] |
| report 3.4 → 3.5 | repo:src/report/schema.ts:42 | Report consumers MUST accept the current `3.5` contract, including the three new secret-policy error codes (`SECRET_ENV_VAR_COLLISION`, `SECRET_CONSENT_REQUIRED`, `SECRET_SYNTAX_REJECTED`), the optional `GROUNDING_UNRESOLVED` details branch (`stepId`, `reason`), and the optional `GenerateResult.secrets`/`warnings` fields, rather than infer compatibility from the Plan version. [repo:src/report/schema.ts:42] |
| report 3.5 → 3.6 | repo:src/report/schema.ts:42 | Report consumers MUST accept the current `3.6` contract, including the optional `repairTrace` diagnostic field on all four completed heal-result branches. It projects each case's Stage 1, Stage 2, and Stage 3 attempt-and-outcome history (issue #383 / SPEC-9 through SPEC-12), rather than infer compatibility from the Plan version. An admission-denied phase adds no `repairTrace` entry and is represented only by `stopReason: "attempt-limit" \| "deadline"`; interrupted work produces no completed result at all (reported as `skipped`) and therefore has neither a `repairTrace` entry nor a `stopReason`. [repo:src/report/schema.ts:42] |

## Compatibility policy {#compatibility-policy}

Artifact version acceptance MUST follow [[spec/overview#compatibility]], not release-number intuition. A schema-version change MAY require regeneration in a minor release because plans are derived artifacts. [repo:src/core/ir/schema.ts:45] 

## Rationale {#rationale}

The changelog records compatibility changes and their regeneration consequence in one normative location, so a consumer need not infer artifact compatibility from package versioning. 

One rejected alternative tracked only package releases; it was rejected because a producer-contract fingerprint change can stale plans without changing the Plan schema version. [repo:CHANGELOG.md:8] [repo:src/core/ir/schema.ts:45]
