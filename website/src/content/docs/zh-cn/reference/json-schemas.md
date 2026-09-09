---
title: JSON Schema 规范
description: 规范重新构建时的发布约定，并梳理当前生成的 JSON Schema 产物与结构约束边界。
---

本文档定义了重新构建时的发布约定，并系统梳理当前生成的 JSON Schema 产物。Ambercast 为配置文档、已生成的 Plan、已提交的 grounding 缓存以及报告命令的版本化输出定义了对应的 Schema 规范，以支持对各类结构化文档内容的验证。

## 发布元数据 {#publication-metadata}

ambercast 已发布这些元数据，以及在站点与 npm 之间内容完全一致的 Schema 文件。

| 产物 | 公开路径与 `$id` | 版本 | `title` | `description` | 适用范围 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| config | `https://kotarotsubaki.github.io/ambercast/schemas/config.schema.json` | 未指定版本；config 无 `schemaVersion` | `ambercast config schema` | `Validates the parsed contents of a present Ambercast configuration file.` | 当前存在的配置文档。 | 可用 |
| plan | `https://kotarotsubaki.github.io/ambercast/schemas/plan.v2.schema.json` | 2 | `ambercast plan schema v2` | `Validates the complete generated plan document that is reviewed and committed beside its source test prompt.` | 完整的 `PlanDocument`，包含来源出处（provenance）、目标（targets）与步骤（steps）。 | 可用 |
| grounding | `https://kotarotsubaki.github.io/ambercast/schemas/grounding.v1.schema.json` | 1 | `ambercast grounding schema v1` | `Validates the committed grounding cache associated with one plan digest.` | 包含 `planDigest` 及以步骤为主键记录项的 `GroundingDocument`。 | 可用 |
| report | `https://kotarotsubaki.github.io/ambercast/schemas/report.v3.schema.json` | 3 (`schemaVersion: "3.2"`) | `ambercast report schema v3.0` | `Zod schema for the complete versioned output of a reporting command.` | 结构化报告外层信封（envelope）及其命令专属结果。 | 可用 |

- 每个 `$id` 均与其公开路径 URL 完全一致；内容完全一致（byte-identical）的 Schema 文件已发布至文档站点以及 npm 的 `schemas/` 导出。
- 当前 Astro 配置将 `site` 设定为主机 `https://kotarotsubaki.github.io`，基路径为 `/ambercast`；上述发布 URL 均基于该主机。

## 生成的构建产物 {#generated-artifacts}

| 生成的文件 | 验证对象 | 生成来源 | npm 导出 |
| --- | --- | --- | --- |
| `plan.schema.json` | 包含 Plan `schemaVersion` 2、来源出处（provenance source）、目标（targets）与步骤（steps）的完整 `PlanDocument`。 | Zod `PlanDocument` 转换为 JSON Schema 2020-12。 | `ambercast/schema/plan.json` → `./dist/schema/plan.schema.json` |
| `grounding.schema.json` | 包含 Grounding `schemaVersion` 1、`planDigest` 及以步骤为主键记录项的 `GroundingDocument`。 | Zod `GroundingDocument` 转换为 JSON Schema 2020-12。 | `ambercast/schema/grounding.json` → `./dist/schema/grounding.schema.json` |
| `config.schema.json` | 当前存在的配置文档，其 `$schema` 为必填项，其余声明的设置项均为可选项。 | Zod `RawConfig` 转换为 JSON Schema 2020-12。 | `ambercast/schema/config.json` → `./dist/schema/config.schema.json` |
| `report.schema.json` | 包含 Report `schemaVersion` 3.2 的结构化报告外层信封（envelope）及其命令专属结果。 | Zod `ReportEnvelope` 转换为 JSON Schema 2020-12。 | `ambercast/schema/report.json` → `./dist/schema/report.schema.json` |

- 执行 `npm run build` 会先编译软件包，随后运行 `node dist/schema-gen.js`；该命令会以递归方式创建 Schema 目录，并精确写入上述四个文件。
- 已校验的生成文件通过 `$schema` 声明了 JSON Schema draft 2020-12，并且包含发布元数据中所示的 `$id`。

## 结构约束边界 {#structural-boundary}

- Plan、Grounding 以及 config 的 JSON Schema 均派生自 Zod，而非作为独立的手写定义进行维护。
- 重复的 Plan 步骤 ID 以及 `SourceSpan.endLine >= startLine` 属于仅在 Zod 中生效的语义细化约束，因为 JSON Schema 2020-12 无法表达这些跨项或跨属性约束。
- 仅验证生成的 Plan JSON Schema 并不能确立重复步骤 ID 的唯一性或 `SourceSpan` 的行号顺序约束；[符合性](/ambercast/zh-cn/spec/conformance/) 记录了这一组合约束边界。

## 报告 Schema {#report-schema}

`report.schema.json` 与其他 Schema 一同生成，并作为 `ambercast/schema/report.json` → `./dist/schema/report.schema.json` 导出。它验证包含 Report `schemaVersion` 3.2 的结构化报告外层信封（envelope）及其命令专属结果。

## 相关链接

- [配置](/ambercast/zh-cn/reference/configuration/#key-table)
- [报告](/ambercast/zh-cn/reference/reports/#envelope)
- [符合性](/ambercast/zh-cn/spec/conformance/)
- [计划文档](/ambercast/zh-cn/spec/plan-document/)
- [Grounding 文档](/ambercast/zh-cn/spec/grounding-document/)
