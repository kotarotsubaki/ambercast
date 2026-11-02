---
title: JSON Schema 规范
description: 说明 Ambercast 配置、执行计划、定位缓存与报告文档所用 JSON Schema 的发布元数据、生成文件与结构约束边界。
---

Ambercast 发布 JSON Schema draft 2020-12 文件，用来验证配置文件、执行计划文档、定位缓存与报告。本页列出已发布的元数据、生成的文件，以及这些 Schema 无法表达的内容。

## 发布元数据 {#publication-metadata}

`main` 上的当前契约由 4 个 Schema 描述。比最新发布版本更新的 Schema 版本，会在发布后列入[兼容性](/ambercast/zh-cn/reference/compatibility/#compatibility-table)。

| artifact | 公开路径与 `$id` | 版本 | `title` | `description` | 适用范围 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| config | `https://kotarotsubaki.github.io/ambercast/schemas/config.schema.json` | 未指定版本；config 无 `schemaVersion` | `ambercast config schema` | `Validates the parsed contents of a present Ambercast configuration file.` | 当前存在的配置文档。 | 可用 |
| plan | `https://kotarotsubaki.github.io/ambercast/schemas/plan.v5.schema.json` | 5 | `ambercast plan schema v5` | `Validates the complete generated plan document that is reviewed and committed beside its source test prompt.` | 当前完整的 `PlanDocument`，包含目标（targets）与步骤（steps）。 | 可用 |
| grounding | `https://kotarotsubaki.github.io/ambercast/schemas/grounding.v4.schema.json` | 4 | `ambercast grounding schema v4` | `Validates the committed grounding cache associated with one plan digest.` | 包含 `planDigest` 及以步骤为键的记录项的 `GroundingDocument`。 | 可用 |
| report | `https://kotarotsubaki.github.io/ambercast/schemas/report.v3.schema.json` | 3 (`schemaVersion: "3.11"`) | `ambercast report schema v3.0` | `Zod schema for the complete versioned output of a reporting command.` | 结构化报告信封（envelope）及其命令专属结果。 | 可用 |

另有 5 个冻结快照，供已废弃契约的使用者使用。站点从已提交的文件发布这些快照，npm 软件包不导出它们。

| artifact | 公开路径与 `$id` | 版本 | `title` | `description` | 适用范围 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| plan （历史快照） | `https://kotarotsubaki.github.io/ambercast/schemas/plan.v2.schema.json` | 2 | `ambercast plan schema v2` | `Validates the complete generated plan document that is reviewed and committed beside its source test prompt.` | 为已废弃契约的使用者保留的冻结执行计划 v2 快照。 | 可用 |
| plan （历史快照） | `https://kotarotsubaki.github.io/ambercast/schemas/plan.v3.schema.json` | 3 | `ambercast plan schema v3` | `Validates the complete generated plan document that is reviewed and committed beside its source test prompt.` | 为已废弃契约的使用者保留的冻结执行计划 v3 快照。 | 可用 |
| plan （历史快照） | `https://kotarotsubaki.github.io/ambercast/schemas/plan.v4.schema.json` | 4 | `ambercast plan schema v4` | `Validates the complete generated plan document that is reviewed and committed beside its source test prompt.` | 为已废弃契约的使用者保留的冻结执行计划 v4 快照。 | 可用 |
| grounding （历史快照） | `https://kotarotsubaki.github.io/ambercast/schemas/grounding.v2.schema.json` | 2 | `ambercast grounding schema v2` | `Validates the committed grounding cache associated with one plan digest.` | 为已废弃契约的使用者保留的冻结定位缓存 v2 快照。 | 可用 |
| grounding （历史快照） | `https://kotarotsubaki.github.io/ambercast/schemas/grounding.v3.schema.json` | 3 | `ambercast grounding schema v3` | `Validates the committed grounding cache associated with one plan digest.` | 为已废弃契约的使用者保留的冻结定位缓存 v3 快照。 | 可用 |

每个 `$id` 都与其公开路径 URL 一致。站点提供的 4 个当前 Schema，与 `dist/schema/` 中的文件逐字节相同。npm 软件包把这 4 个文件导出为 `ambercast/schema/<name>.json`。

站点配置把 `site` 设为 `https://kotarotsubaki.github.io` 主机，基路径设为 `/ambercast`。上述发布 URL 均使用该主机。

## 生成的产物 {#generated-artifacts}

| 生成的文件 | 验证对象 | 生成来源 | npm 导出 |
| --- | --- | --- | --- |
| `plan.schema.json` | 执行计划 `schemaVersion` 为 5，并包含来源出处（provenance source）、目标（targets）与步骤（steps）的当前完整 `PlanDocument`。 | 转换为 JSON Schema 2020-12 的 Zod `PlanDocument`。 | `ambercast/schema/plan.json` → `./dist/schema/plan.schema.json` |
| `grounding.schema.json` | 定位缓存 `schemaVersion` 为 4，并包含 `planDigest` 及以步骤为键的记录项的 `GroundingDocument`。 | 转换为 JSON Schema 2020-12 的 Zod `GroundingDocument`。 | `ambercast/schema/grounding.json` → `./dist/schema/grounding.schema.json` |
| `config.schema.json` | `$schema` 为必填项，其余声明的设置项均为可选项的当前配置文档。 | 转换为 JSON Schema 2020-12 的 Zod `RawConfig`。 | `ambercast/schema/config.json` → `./dist/schema/config.schema.json` |
| `report.schema.json` | Report `schemaVersion` 为 3.11 的结构化报告信封（envelope）及其命令专属结果。 | 转换为 JSON Schema 2020-12 的 Zod `ReportEnvelope`。 | `ambercast/schema/report.json` → `./dist/schema/report.schema.json` |

`npm run build` 先编译软件包，再运行 `node dist/schema-gen.js`。该脚本递归创建 Schema 目录，并写入上述 4 个 Schema 文件。它还会在 `dist/manifest/` 下写入清单文件。

已校验的生成文件通过 `$schema` 声明 JSON Schema draft 2020-12。每个文件还声明发布元数据中所示的 `$id`。

## 结构约束边界 {#structural-boundary}

执行计划、定位缓存、config 与报告的 JSON Schema 均派生自 Zod。它们不是独立维护的手写定义。

重复的执行计划步骤 ID 属于仅在 Zod 中生效的语义细化约束。JSON Schema 2020-12 无法表达数组项之间投影字段的唯一性。

仅验证生成的执行计划 JSON Schema，并不能确立步骤 ID 无重复。[符合性](/ambercast/zh-cn/spec/conformance/)记录了两者合并后的约束边界。

## 报告 Schema {#report-schema}

`report.schema.json` 与其他 Schema 一同生成，并导出为 `ambercast/schema/report.json` → `./dist/schema/report.schema.json`。它验证结构化报告信封及其命令专属结果。验证范围包括 Report `schemaVersion` 3.11、必需的步骤 Target 标识，以及已执行的 run 与已完成的 heal 结果中的会话清单。

## 另请参阅 {#see-also}

- [执行计划文档](/ambercast/zh-cn/spec/plan-document/)
- [定位缓存文档](/ambercast/zh-cn/spec/grounding-document/)
- [配置](/ambercast/zh-cn/reference/configuration/#key-table)
- [符合性](/ambercast/zh-cn/spec/conformance/)
- [报告](/ambercast/zh-cn/reference/reports/#envelope)
