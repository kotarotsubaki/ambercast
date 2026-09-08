---
title: Glossary
description: Normative site-wide terminology and index of literal translation-invariant tokens for Ambercast.
---

This page is the single owner of site-wide terminology and the index of literal tokens that translators must preserve. Every definition here is normative and kept to a single sentence; follow each linked owner contract for complete field, flag, status, or error tables. Planned-only tokens have no 0.3.1 runtime semantics and are not available in current releases.

## Artifact terms {#artifact-terms}

The following schema- and resolver-bound definitions govern the core artifact model:

| term | normative definition | owning schema / command | not to be confused with |
| --- | --- | --- | --- |
| plan | A plan is a schema-valid `PlanDocument` whose `inputsDigest` records normalized-prompt provenance and whose body records named targets and executable steps. | `PlanDocument`; [Plan document](/ambercast/spec/plan-document/) | prompt or grounding |
| grounding | Grounding is a schema-valid per-plan cache whose `planDigest` binds step-keyed entries to one Plan. | `GroundingDocument`; [Grounding document](/ambercast/spec/grounding-document/) | Plan or run report |
| artifact | An artifact is a derived plan or grounding companion for an in-tree `.test.md` prompt. | layout resolver; [File layout](/ambercast/reference/file-layout/#companions) | run evidence |
| fingerprint | A fingerprint is an element-grounding value containing the literal `a11y-neighborhood-v2` algorithm and a SHA-256 hash. | `Fingerprint`; [Element fingerprint](/ambercast/spec/fingerprint/) | `planDigest` |
| inputs digest | An inputs digest is the canonical SHA-256 provenance digest of normalized prompt, Plan schema version, generator-template fingerprint, producer-bundle fingerprint, and named targets. | `computeInputsDigest`; [Freshness and digests](/ambercast/spec/freshness/) | `planDigest` |
| plan digest | A plan digest is the canonical SHA-256 of a schema-valid Plan excluding `generatorMeta`, used to bind Grounding. | `computePlanDigest`; [Freshness and digests](/ambercast/spec/freshness/) | `inputsDigest` |
| normalized test prompt | A normalized test prompt removes at most one leading U+FEFF and maps CRLF/lone CR to LF while preserving everything else. | `normalizeTestMd`; [Prompt file format](/ambercast/reference/prompt-format/#normalization-and-grants) | formatting cleanup |

`PlanDocument` and `GroundingDocument` are strict runtime trust boundaries from which JSON Schema is derived.

## Execution terms {#execution-terms}

The following command- and report-bound definitions govern execution, target resolution, and reporting contracts:

| term | normative definition | owning schema / command | not to be confused with |
| --- | --- | --- | --- |
| freshness | Freshness is the provenance condition `check` reports for Plan/Grounding artifacts, not an execution outcome. | `ambercast check`; [Freshness and digests](/ambercast/spec/freshness/) | run success |
| stale | Stale is a completed `check` status for an artifact whose freshness cannot be trusted. | `CompletedCheckResult`; [ambercast check](/ambercast/reference/cli/check/#status-vocabulary) | UI drift |
| drift | Drift is a localized change in an element's accessibility neighborhood that changes its fingerprint. | fingerprint resolver; [Element fingerprint](/ambercast/spec/fingerprint/) | stale Plan provenance |
| heal | Heal is the repair command whose non-list mode is permitted only by CI policy and an `idempotent` selected target. | `ambercast heal`; [ambercast heal](/ambercast/reference/cli/heal/) | run grounding fallback |
| target | A target is a named configured browser destination selected explicitly, by configured default, or when it is the sole configured target. | `resolveTarget`; [Configuration](/ambercast/reference/configuration/#key-table) | prompt |
| replay isolation | Replay isolation is the target policy `healReplayIsolation`; `idempotent` permits heal and `stateful` rejects it. | target config / `ambercast heal` | Plan target definition |
| report envelope | A report envelope is the versioned command-discriminated structured result returned by a reporting command. | `ReportEnvelope`; [Reports](/ambercast/reference/reports/#envelope) | persisted `report.json` |
| report persistence | Report persistence is the run-envelope state `persisted`, `failed`, or `not-attempted` for the finalized envelope write. | run `ReportEnvelope`; [Reports](/ambercast/reference/reports/#persistence) | semantic test result |
| secret reference | A secret reference is a whole-value string accepted by `SecretRef`, with one or more dot-separated segments of ASCII letters, digits, or underscores after `secrets.`. | `SecretRef`; [Prompt file format](/ambercast/reference/prompt-format/#secret-references) | literal secret |
| secret grant | A secret grant is a source-ordered complete `@ambercast-secret <secret reference>` line outside CommonMark code ranges. | `extractSecretGrants`; [Prompt file format](/ambercast/reference/prompt-format/#normalization-and-grants) | secret reference itself |

`stale` belongs to check results and is not a run result status. Heal's idempotent-target check is skipped only in list mode.

## Translation invariant registry {#translation-invariant-registry}

The following registry is the exhaustive inventory of literal tokens that must be preserved verbatim by translators across reference documentation:

| invariant | normative sentence | owner | not to be confused with |
| --- | --- | --- | --- |
| `$id` | `$id` is reserved for a JSON Schema identifier, but generated 0.3.1 schemas do not establish one. | [JSON Schemas](/ambercast/reference/json-schemas/#publication-metadata) | config `$schema` |
| `$schema` | `$schema` is the required identifier field of a present config file and the draft declaration in generated schemas. | `RawConfig`; [Configuration](/ambercast/reference/configuration/#key-table) | `$id` |
| `**` | `**` is the discovery wildcard that crosses path separators. | matcher; [Discovery patterns](/ambercast/reference/discovery-patterns/#pattern-language) | one-segment `*` |
| `--` | `--` ends option parsing and leaves following tokens as literal paths. | CLI parser; [CLI overview](/ambercast/reference/cli/overview/#command-flag-matrix) | a filename beginning `--` |
| `--allow-empty` | `--allow-empty` makes an empty selection permissible for commands that parse it. | CLI parser; [CLI overview](/ambercast/reference/cli/overview/#command-flag-matrix) | `--list` |
| `--allow-headless` | `--allow-headless` is planned-only and has no accepted 0.3.1 parser semantics. | [ambercast view](/ambercast/reference/cli/view/#planned-interface) | implemented `--headed` |
| `--cache-only` | `--cache-only` makes run reject grounding misses instead of invoking AI fallback. | `ambercast run`; [ambercast run](/ambercast/reference/cli/run/#flags) | offline test discovery |
| `--clear` | `--clear` is planned-only and has no accepted 0.3.1 baseline parser semantics. | [ambercast baseline and restore](/ambercast/reference/cli/baseline-restore/#planned-boundary) | file deletion by current commands |
| `--config` | `--config` is command-local and parsed only by generate and check. | CLI parser; [CLI overview](/ambercast/reference/cli/overview/#command-flag-matrix) | `AMBERCAST_CONFIG` |
| `--dir` | `--dir` is planned-only and has no accepted 0.3.1 init parser semantics. | [ambercast init](/ambercast/reference/cli/init/#planned-interface) | config `testDir` |
| `--dry-run` | `--dry-run` withholds artifact writes for generate and heal. | generate/heal; [ambercast generate](/ambercast/reference/cli/generate/#flags) | `--list` |
| `--force` | `--force` opts the implemented generate command out of fresh-Plan reuse. | `ambercast generate`; [ambercast generate](/ambercast/reference/cli/generate/#flags) | heal `--yes` |
| `--host` | `--host` is planned-only and has no accepted 0.3.1 viewer parser semantics. | [ambercast view](/ambercast/reference/cli/view/#undecided-items) | target `baseUrl` |
| `--json` | `--json` selects serialized structured-report output after an implemented command returns. | CLI renderer; [Reports](/ambercast/reference/reports/#envelope) | MCP JSON-RPC |
| `--list` | `--list` is parsed by every implemented command; each command page owns its listing result semantics. | CLI parser; [CLI overview](/ambercast/reference/cli/overview/#command-flag-matrix) | `--allow-empty` |
| `--no-reset` | `--no-reset` is planned-only and has no accepted 0.3.1 run parser semantics. | [ambercast baseline and restore](/ambercast/reference/cli/baseline-restore/#planned-boundary) | `--force` |
| `--port` | `--port` is planned-only and has no accepted 0.3.1 viewer parser semantics. | [ambercast view](/ambercast/reference/cli/view/#planned-interface) | config `viewer.port` |
| `--target` | `--target` names a configured execution target for each implemented command. | CLI parser / target resolver; [CLI overview](/ambercast/reference/cli/overview/#command-flag-matrix) | target definition itself |
| `--yes` | `--yes` authorizes heal settlement without an interactive confirmation. | `ambercast heal`; [ambercast heal](/ambercast/reference/cli/heal/#flags) | generate `--force` |
| `.ambercast.grounding.json` | `.ambercast.grounding.json` is the exact adjacent Grounding companion suffix. | layout resolver; [File layout](/ambercast/reference/file-layout/#companions) | Plan suffix |
| `.ambercast.plan.json` | `.ambercast.plan.json` is the exact adjacent Plan companion suffix. | layout resolver; [File layout](/ambercast/reference/file-layout/#companions) | Grounding suffix |
| `.baseline` | `.baseline` is planned-only and no 0.3.1 layout resolver derives it. | [ambercast baseline and restore](/ambercast/reference/cli/baseline-restore/#planned-storage-and-freshness) | implemented `.runs` |
| `.runs` | `.runs` is the final segment of the default `runsDir`, not an independently resolved root. | configuration / [File layout](/ambercast/reference/file-layout/#run-artifacts) | companion artifacts |
| `.test.md` | `.test.md` is the exact suffix required for a discovered prompt path to receive layout mappings. | layout resolver; [Prompt file format](/ambercast/reference/prompt-format/#file-identity) | arbitrary Markdown |
| `0.1.0` | `0.1.0` names the 2026-09-03 release in the repository changelog. | [Changelog](/ambercast/reference/changelog/#release-010) | artifact schema version |
| `0.3.1` | `0.3.1` is the current package version documented by this Reference set. | package / [Compatibility](/ambercast/reference/compatibility/#compatibility-table) | report `3.1` |
| `2 > 3 > 4 > 1 > 5 > 0` | `2 > 3 > 4 > 1 > 5 > 0` is the fixed process-exit precedence from strongest to weakest. | exit selector; [Exit codes](/ambercast/reference/exit-codes/#aggregation-priority) | numeric order |
| `@ambercast-secret` | `@ambercast-secret` begins a complete grant line outside CommonMark code. | grant extractor; [Prompt file format](/ambercast/reference/prompt-format/#normalization-and-grants) | secret reference |
| `AMBERCAST_AI_PROVIDER` | `AMBERCAST_AI_PROVIDER` supplies the environment provider override. | config environment; [Environment variables](/ambercast/reference/environment-variables/#configuration) | CLI `--ai` |
| `AMBERCAST_CONFIG` | `AMBERCAST_CONFIG` supplies the environment configuration-path override. | config environment; [Environment variables](/ambercast/reference/environment-variables/#configuration) | CLI `--config` |
| `AMBERCAST_ENV_*` | `AMBERCAST_ENV_*` is a namespace withheld from AI-provider children and not a listed Ambercast input. | child runner; [Environment variables](/ambercast/reference/environment-variables/#provider-child-environment) | `AMBERCAST_SECRET_*` |
| `AMBERCAST_SECRET_*` | `AMBERCAST_SECRET_*` resolves secret references and is withheld from AI-provider children. | secret adapter / child runner; [Environment variables](/ambercast/reference/environment-variables/#secrets) | `AMBERCAST_ENV_*` |
| `CI` | `CI` is active when defined, nonempty, and not exactly lowercase `false`. | environment info; [Environment variables](/ambercast/reference/environment-variables/#secrets) | generic truthy parsing |
| `CONFIG_INVALID` | `CONFIG_INVALID` is the structured usage-error code for invalid configuration. | report schema; [Error codes](/ambercast/reference/error-codes/#code-vocabulary) | process exit 2 itself |
| `FS_IO_ERROR` | `FS_IO_ERROR` is the structured environment-error code for filesystem I/O failure. | report schema; [Error codes](/ambercast/reference/error-codes/#code-vocabulary) | any rejected artifact |
| `GitHub Security Advisories` | GitHub Security Advisories is the private vulnerability-reporting channel. | `SECURITY.md`; [Security policy](/ambercast/reference/security-policy/#vulnerability-reporting) | public issues |
| `GroundingDocument` | `GroundingDocument` is the strict schema owning Grounding `schemaVersion`, `planDigest`, and entries. | `GroundingDocument`; [Grounding document](/ambercast/spec/grounding-document/) | `PlanDocument` |
| `INTERRUPTED` | `INTERRUPTED` is the structured environment-error code for interrupted execution. | report schema; [Error codes](/ambercast/reference/error-codes/#code-vocabulary) | assertion failure |
| `JSON-RPC` | `JSON-RPC` is planned-only for the MCP transport and has no 0.3.1 server runtime. | [ambercast mcp](/ambercast/reference/cli/mcp/#planned-interface) | CLI `--json` |
| `PlanDocument` | `PlanDocument` is the strict schema owning Plan version, provenance, targets, and steps. | `PlanDocument`; [Plan document](/ambercast/spec/plan-document/) | `GroundingDocument` |
| `SECRET_REF_PATTERN` | `SECRET_REF_PATTERN` is the whole-value anchored regular expression built from `SECRET_REF_SOURCE`. | `SecretRef`; [Prompt file format](/ambercast/reference/prompt-format/#secret-references) | unanchored fragment |
| `a11y-neighborhood-v2` | `a11y-neighborhood-v2` is the only accepted element-fingerprint algorithm literal. | `Fingerprint`; [Element fingerprint](/ambercast/spec/fingerprint/) | Plan schema version 2 |
| `ambercast` | `ambercast` is the package binary name and CLI program. | package / CLI overview | an artifact schema |
| `ambercast baseline` | `ambercast baseline` is planned-only and rejected by the 0.3.1 parser. | [ambercast baseline and restore](/ambercast/reference/cli/baseline-restore/#status) | implemented command |
| `ambercast check` | `ambercast check` is the implemented read-only freshness command. | [ambercast check](/ambercast/reference/cli/check/) | `ambercast run` |
| `ambercast generate` | `ambercast generate` is the implemented Plan-generation command. | [ambercast generate](/ambercast/reference/cli/generate/) | `ambercast run` |
| `ambercast heal` | `ambercast heal` is the implemented guarded artifact-repair command. | [ambercast heal](/ambercast/reference/cli/heal/) | run fallback |
| `ambercast init` | `ambercast init` is planned-only and rejected by the 0.3.1 parser. | [ambercast init](/ambercast/reference/cli/init/#status) | implemented command |
| `ambercast mcp` | `ambercast mcp` is planned-only and rejected by the 0.3.1 parser. | [ambercast mcp](/ambercast/reference/cli/mcp/#status) | MCP tool name |
| `ambercast restore` | `ambercast restore` is planned-only and rejected by the 0.3.1 parser. | [ambercast baseline and restore](/ambercast/reference/cli/baseline-restore/#status) | implemented command |
| `ambercast review` | `ambercast review` is planned-only even though the runtime report schema contains a review branch. | [ambercast review](/ambercast/reference/cli/review/#status) | schema availability |
| `ambercast run` | `ambercast run` is the implemented deterministic replay command. | [ambercast run](/ambercast/reference/cli/run/) | `ambercast generate` |
| `ambercast view` | `ambercast view` is planned-only and rejected by the 0.3.1 parser. | [ambercast view](/ambercast/reference/cli/view/#status) | implemented command |
| `ambercast_check` | `ambercast_check` is a planned MCP tool token with no 0.3.1 server runtime. | [MCP Tools](/ambercast/reference/mcp-tools/#tool-table) | CLI `ambercast check` |
| `ambercast_generate` | `ambercast_generate` is a planned MCP tool token with no 0.3.1 server runtime. | [MCP Tools](/ambercast/reference/mcp-tools/#tool-table) | CLI `ambercast generate` |
| `ambercast_heal` | `ambercast_heal` is a planned MCP tool token with no 0.3.1 server runtime. | [MCP Tools](/ambercast/reference/mcp-tools/#tool-table) | CLI `ambercast heal` |
| `ambercast_review` | `ambercast_review` is a planned MCP tool token with no 0.3.1 server runtime. | [MCP Tools](/ambercast/reference/mcp-tools/#tool-table) | planned CLI review |
| `ambercast_run` | `ambercast_run` is a planned MCP tool token with no 0.3.1 server runtime. | [MCP Tools](/ambercast/reference/mcp-tools/#tool-table) | CLI `ambercast run` |
| `config.schema.json` | `config.schema.json` is the generated config JSON Schema and npm config-schema export target. | [JSON Schemas](/ambercast/reference/json-schemas/#generated-artifacts) | a config instance |
| `dryRun` | `dryRun` is an input field for the CLI/MCP heal preview request; a completed `HealResult` represents preview with `application: preview-only`, not a `dryRun` field. | heal request / [MCP Tools](/ambercast/reference/mcp-tools/#heal-safety-default) | HealResult representation |
| `fresh-without-grounding` | `fresh-without-grounding` is a completed check status distinct from `fresh`. | check result; [ambercast check](/ambercast/reference/cli/check/#status-vocabulary) | missing Plan |
| `grounding.schema.json` | `grounding.schema.json` is the generated Grounding JSON Schema and npm export target. | [JSON Schemas](/ambercast/reference/json-schemas/#generated-artifacts) | Grounding instance |
| `healReplayIsolation` | `healReplayIsolation` is the target policy whose `idempotent` value is required by heal. | target config / heal | browser mode |
| `inputsDigest` | `inputsDigest` records the five-input Plan provenance digest. | `computeInputsDigest`; [Freshness and digests](/ambercast/spec/freshness/) | `planDigest` |
| `isError` | `isError` is planned MCP result classification and has no 0.3.1 MCP runtime semantics. | [MCP Tools](/ambercast/reference/mcp-tools/#tool-table) | test-red status |
| `outputSchema` | `outputSchema` is planned MCP schema metadata and has no 0.3.1 MCP runtime semantics. | [MCP Tools](/ambercast/reference/mcp-tools/#planned-tool-contract) | generated npm JSON Schema |
| `plan.schema.json` | `plan.schema.json` is the generated Plan JSON Schema and npm export target. | [JSON Schemas](/ambercast/reference/json-schemas/#generated-artifacts) | Plan instance |
| `planDigest` | `planDigest` binds Grounding to replay-relevant Plan content excluding `generatorMeta`. | `computePlanDigest`; [Freshness and digests](/ambercast/spec/freshness/) | `inputsDigest` |
| `producerBundleFingerprint` | `producerBundleFingerprint` names producer-contract provenance whose change alters `inputsDigest`. | generate provenance / [Compatibility](/ambercast/reference/compatibility/#regeneration-boundary) | element fingerprint |
| `report.json` | `report.json` is the run-only persisted finalized envelope under an invocation directory. | run / [File layout](/ambercast/reference/file-layout/#run-artifacts) | stdout envelope |
| `reportPersistence` | `reportPersistence` is the run-envelope state of its persistence attempt. | run report; [Reports](/ambercast/reference/reports/#persistence) | test status |
| `review` | `review` is a report-schema command branch, not evidence of an implemented CLI command. | `ReportEnvelope`; [Reports](/ambercast/reference/reports/#result-shapes) | available command |
| `schemaVersion` | `schemaVersion` discriminates a versioned Plan, Grounding, or report contract. | IR/report schemas | package version |
| `stderr` | `stderr` carries CLI usage errors, crash diagnostics, and persistence warnings rather than successful report output. | CLI runtime / [ambercast mcp](/ambercast/reference/cli/mcp/#planned-interface) | stdout answer |
| `stdio` | `stdio` is planned MCP transport and has no 0.3.1 server runtime. | [ambercast mcp](/ambercast/reference/cli/mcp/#planned-interface) | a network port |
| `stdout` | `stdout` carries help/version and completed command reports, while process status is assigned separately. | CLI runtime / [Reports](/ambercast/reference/reports/#envelope) | stderr diagnostics |
| `structuredContent` | `structuredContent` is planned MCP result payload and has no 0.3.1 MCP runtime semantics. | [MCP Tools](/ambercast/reference/mcp-tools/#planned-tool-contract) | CLI JSON text |
| `testIgnore` | `testIgnore` excludes a matching relative path after inclusion. | discovery matcher; [Discovery patterns](/ambercast/reference/discovery-patterns/#selection) | `testMatch` |
| `testMatch` | `testMatch` requires at least one inclusion match for a relative path. | discovery matcher; [Discovery patterns](/ambercast/reference/discovery-patterns/#selection) | `testIgnore` |
| `{{secrets.name}}` | `{{secrets.name}}` exemplifies a whole-value secret reference whose body maps to an environment key. | `SecretRef`; [Prompt file format](/ambercast/reference/prompt-format/#secret-references) | literal credential |

See also: [CLI overview](/ambercast/reference/cli/overview/), [Configuration](/ambercast/reference/configuration/), [Reports](/ambercast/reference/reports/), [Error codes](/ambercast/reference/error-codes/), [Exit codes](/ambercast/reference/exit-codes/), [JSON Schemas](/ambercast/reference/json-schemas/), [Environment variables](/ambercast/reference/environment-variables/), [MCP Tools](/ambercast/reference/mcp-tools/).
