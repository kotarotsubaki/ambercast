---
title: JSON Schemas
description: Publication metadata, generated files, and structural limits of the JSON Schemas for Ambercast configuration, plan, grounding, and report documents.
---

Ambercast publishes JSON Schema draft 2020-12 files that validate configuration files, plan documents, grounding caches, and reports. This page lists the published metadata, the generated files, and what the schemas cannot express.

## Publication metadata {#publication-metadata}

Four schemas describe the current contracts on `main`. A schema version newer than the latest release appears in [Compatibility](/ambercast/reference/compatibility/#compatibility-table) once it ships.

| artifact | public path and `$id` | version | `title` | `description` | scope | state |
| --- | --- | --- | --- | --- | --- | --- |
| config | `https://kotarotsubaki.github.io/ambercast/schemas/config.schema.json` | unversioned; config has no `schemaVersion` | `ambercast config schema` | `Validates the parsed contents of a present Ambercast configuration file.` | A present configuration document. | available |
| plan | `https://kotarotsubaki.github.io/ambercast/schemas/plan.v5.schema.json` | 5 | `ambercast plan schema v5` | `Validates the complete generated plan document that is reviewed and committed beside its source test prompt.` | A completed current `PlanDocument`, including targets and steps. | available |
| grounding | `https://kotarotsubaki.github.io/ambercast/schemas/grounding.v4.schema.json` | 4 | `ambercast grounding schema v4` | `Validates the committed grounding cache associated with one plan digest.` | A `GroundingDocument` with `planDigest` and step-keyed entries. | available |
| report | `https://kotarotsubaki.github.io/ambercast/schemas/report.v3.schema.json` | 3 (`schemaVersion: "3.11"`) | `ambercast report schema v3.0` | `Zod schema for the complete versioned output of a reporting command.` | A structured report envelope and its command-specific results. | available |

Five frozen snapshots remain for consumers of retired contracts. The site publishes them from committed files, and the npm package does not export them.

| artifact | public path and `$id` | version | `title` | `description` | scope | state |
| --- | --- | --- | --- | --- | --- | --- |
| plan (historical snapshot) | `https://kotarotsubaki.github.io/ambercast/schemas/plan.v2.schema.json` | 2 | `ambercast plan schema v2` | `Validates the complete generated plan document that is reviewed and committed beside its source test prompt.` | A frozen Plan v2 snapshot retained for consumers of the retired contract. | available |
| plan (historical snapshot) | `https://kotarotsubaki.github.io/ambercast/schemas/plan.v3.schema.json` | 3 | `ambercast plan schema v3` | `Validates the complete generated plan document that is reviewed and committed beside its source test prompt.` | A frozen Plan v3 snapshot retained for consumers of the retired contract. | available |
| plan (historical snapshot) | `https://kotarotsubaki.github.io/ambercast/schemas/plan.v4.schema.json` | 4 | `ambercast plan schema v4` | `Validates the complete generated plan document that is reviewed and committed beside its source test prompt.` | A frozen Plan v4 snapshot retained for consumers of the retired contract. | available |
| grounding (historical snapshot) | `https://kotarotsubaki.github.io/ambercast/schemas/grounding.v2.schema.json` | 2 | `ambercast grounding schema v2` | `Validates the committed grounding cache associated with one plan digest.` | A frozen Grounding v2 snapshot retained for consumers of the retired contract. | available |
| grounding (historical snapshot) | `https://kotarotsubaki.github.io/ambercast/schemas/grounding.v3.schema.json` | 3 | `ambercast grounding schema v3` | `Validates the committed grounding cache associated with one plan digest.` | A frozen Grounding v3 snapshot retained for consumers of the retired contract. | available |

Each `$id` equals its public-path URL. The site serves the four current schemas as byte-identical copies of the files in `dist/schema/`. The npm package exports those four as `ambercast/schema/<name>.json`.

The site configuration sets `site` to the `https://kotarotsubaki.github.io` host with base `/ambercast`. The publication URLs above use that host.

## Generated artifacts {#generated-artifacts}

| generated file | validates | generated from | npm export |
| --- | --- | --- | --- |
| `plan.schema.json` | A completed current `PlanDocument` with Plan `schemaVersion` 5, provenance source, targets, and steps. | Zod `PlanDocument` converted as JSON Schema 2020-12. | `ambercast/schema/plan.json` → `./dist/schema/plan.schema.json` |
| `grounding.schema.json` | A `GroundingDocument` with Grounding `schemaVersion` 4, `planDigest`, and step-keyed entries. | Zod `GroundingDocument` converted as JSON Schema 2020-12. | `ambercast/schema/grounding.json` → `./dist/schema/grounding.schema.json` |
| `config.schema.json` | A present configuration document whose `$schema` is required and whose declared settings are otherwise optional. | Zod `RawConfig` converted as JSON Schema 2020-12. | `ambercast/schema/config.json` → `./dist/schema/config.schema.json` |
| `report.schema.json` | A structured report envelope and its command-specific results with Report `schemaVersion` 3.11. | Zod `ReportEnvelope` converted as JSON Schema 2020-12. | `ambercast/schema/report.json` → `./dist/schema/report.schema.json` |

`npm run build` compiles the package and then runs `node dist/schema-gen.js`. That script creates the schema directory recursively and writes the four schema files above. It also writes manifest files under `dist/manifest/`.

The checked generated files declare JSON Schema draft 2020-12 through `$schema`. Each also declares the `$id` shown in the publication metadata.

## Structural boundary {#structural-boundary}

Plan, grounding, config, and report JSON Schemas are derived from Zod. They are not maintained as separate handwritten definitions.

Duplicate plan step IDs are a Zod-only semantic refinement. JSON Schema 2020-12 cannot express uniqueness of a projected field across array items.

Validating only the generated plan JSON Schema does not establish duplicate-step-ID uniqueness. [Conformance](/ambercast/spec/conformance/) documents the combined boundary.

## Report schema {#report-schema}

`report.schema.json` is generated alongside the other schemas and exported as `ambercast/schema/report.json` → `./dist/schema/report.schema.json`. It validates the structured report envelope and its command-specific results. That coverage includes Report `schemaVersion` 3.11, required step Target identity, and the session inventory on executed run and completed heal results.

## See also {#see-also}

- [Plan document](/ambercast/spec/plan-document/)
- [Grounding document](/ambercast/spec/grounding-document/)
- [Configuration](/ambercast/reference/configuration/#key-table)
- [Conformance](/ambercast/spec/conformance/)
- [Reports](/ambercast/reference/reports/#envelope)
