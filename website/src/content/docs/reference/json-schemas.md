---
title: JSON Schemas
description: Publication contract and inventory of generated JSON Schemas for Ambercast configuration, plan, grounding, and report artifacts.
---

Ambercast defines JSON Schema draft 2020-12 specifications for validating configuration files, intermediate representation documents (plans and grounding caches), and execution reports. This reference details the planned publication metadata contract, the current inventory of generated schema files, structural validation boundaries, and report schema generation status.

## Publication metadata {#publication-metadata}

Ambercast 0.3.1 does not yet publish these metadata or identical site/npm bytes.

| artifact | public path and `$id` | version | `title` | `description` | scope | state |
| --- | --- | --- | --- | --- | --- | --- |
| config | `https://kotarotsubaki.github.io/ambercast/schemas/config.schema.json` | unversioned; config has no `schemaVersion` | `ambercast config schema` | `Validates the parsed contents of a present Ambercast configuration file.` | A present configuration document. | planned (not implemented in 0.3.1) |
| plan | `https://kotarotsubaki.github.io/ambercast/schemas/plan.v2.schema.json` | 2 | `ambercast plan schema v2` | `Validates the complete generated plan document that is reviewed and committed beside its source test prompt.` | A completed `PlanDocument`, including provenance, targets, and steps. | planned (not implemented in 0.3.1) |
| grounding | `https://kotarotsubaki.github.io/ambercast/schemas/grounding.v1.schema.json` | 1 | `ambercast grounding schema v1` | `Validates the committed grounding cache associated with one plan digest.` | A `GroundingDocument` with `planDigest` and step-keyed entries. | planned (not implemented in 0.3.1) |
| report | `https://kotarotsubaki.github.io/ambercast/schemas/report.v3.schema.json` | 3 (`schemaVersion: "3.3"`) | `ambercast report schema v3` | `Zod schema for the complete versioned output of a reporting command.` | A structured report envelope and its command-specific results. | planned (not implemented in 0.3.1) |

Each `$id` equals its public-path URL; publishing byte-identical schema files to the site and the npm `schemas/` export is planned (not implemented in 0.3.1).

The current Astro configuration sets `site` to the `https://kotarotsubaki.github.io` host with base `/ambercast`; the publication URLs above use that host and remain planned (not implemented in 0.3.1).

## Generated artifacts {#generated-artifacts}

| generated file | validates | generated from | npm export |
| --- | --- | --- | --- |
| `plan.schema.json` | A completed `PlanDocument` with Plan `schemaVersion` 2, provenance source, targets, and steps. | Zod `PlanDocument` converted as JSON Schema 2020-12. | `ambercast/schema/plan.json` → `./dist/schema/plan.schema.json` |
| `grounding.schema.json` | A `GroundingDocument` with Grounding `schemaVersion` 1, `planDigest`, and step-keyed entries. | Zod `GroundingDocument` converted as JSON Schema 2020-12. | `ambercast/schema/grounding.json` → `./dist/schema/grounding.schema.json` |
| `config.schema.json` | A present configuration document whose `$schema` is required and whose declared settings are otherwise optional. | Zod `RawConfig` converted as JSON Schema 2020-12. | `ambercast/schema/config.json` → `./dist/schema/config.schema.json` |

Running `npm run build` compiles the package and then runs `node dist/schema-gen.js`, which creates the schema directory recursively and writes exactly the three files above.

The checked generated files declare JSON Schema draft 2020-12 through `$schema` and do not contain `$id`.

For specifications defining the underlying structure of these documents, see [Plan document](/ambercast/spec/plan-document/), [Grounding document](/ambercast/spec/grounding-document/), and [Configuration](/ambercast/reference/configuration/#key-table).

## Structural boundary {#structural-boundary}

Plan, Grounding, and config JSON Schemas are derived from Zod rather than maintained as separate handwritten definitions.

Duplicate Plan step IDs and `SourceSpan.endLine >= startLine` are Zod-only semantic refinements because JSON Schema 2020-12 cannot express those cross-item/cross-property constraints.

Validating only the generated Plan JSON Schema does not establish duplicate-step-ID uniqueness or `SourceSpan` line ordering; [Conformance](/ambercast/spec/conformance/) documents the combined boundary.

## Report schema {#report-schema}

| artifact | current state |
| --- | --- |
| Report JSON Schema | Not generated today: the generator's exhaustive write list and package export map contain only plan, grounding, and config. Runtime reports carry `schemaVersion: "3.3"`. |

No generated report-schema filename or npm export is established by the 0.3.1 implementation. For the complete runtime report envelope structure, see [Reports](/ambercast/reference/reports/#envelope).
