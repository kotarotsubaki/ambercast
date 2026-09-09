---
title: "规范变更日志"
description: "工件版本的接受必须（MUST）遵循 Ambercast 计划规范，而非凭借发布版本号的直觉。"
---

## 版本历史 {#version-history}

| 变更 | 证据 | 迁移义务 |
| --- | --- | --- |
| Plan v1 → v2 增加指令覆盖率 | [src/core/ir/schema.ts:45](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L45), [src/core/ir/schema.ts:1185](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1185) | 生成者与消费者必须（MUST）拒绝 v1 并重新生成或报告其过时；不得（MUST NOT）对其进行就地迁移。[src/core/ir/schema.ts:50](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L50) |
| fingerprint v1 → v2 | [CHANGELOG.md:78](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/CHANGELOG.md#L78) | v2 是唯一被接受的标签。带有覆盖声明的当前出处文档在随后的严格/规范验证失败时，完整性必须（MUST）判定为失败；未带有该声明的伴随文档在 `run` 中可能发生缓存未命中，而 `check` grounding 检查将模式无效的内容归类为 `invalid`（公开状态依据 [新鲜度与摘要](/ambercast/zh-cn/spec/freshness/#freshness-consequences)）。[src/usecases/run.ts:498](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L498) [src/usecases/check-grounding.ts:45](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/check-grounding.ts#L45) |
| 生成者 bundle 指纹进入 `inputsDigest` | [CHANGELOG.md:8](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/CHANGELOG.md#L8) | 变更前生成的 Plan 必须（MUST）重新生成，因为它们已过时。[CHANGELOG.md:8](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/CHANGELOG.md#L8) |
| report 2.0 → 3.0 | [CHANGELOG.md:55](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/CHANGELOG.md#L55), [CHANGELOG.md:58](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/CHANGELOG.md#L58) | Report 消费者必须（MUST）接受当前的 `3.0` 契约，而不是从 Plan 版本推断兼容性。[src/report/schema.ts:15](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/report/schema.ts#L15) |
| report 3.0 → 3.1 | [src/report/schema.ts:22](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/report/schema.ts#L22) | Report 消费者必须（MUST）接受当前的 `3.1` 契约（包括可选的结构化错误诊断），而不是从 Plan 版本推断兼容性。[src/report/schema.ts:22](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/report/schema.ts#L22) |
| report 3.1 → 3.2 | [src/report/schema.ts:30](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/report/schema.ts#L30) | Report 消费者必须（MUST）接受当前的 `3.2` 契约（包括可选的 `PROMPT_PATH_INVALID` details 分支），而不是从 Plan 版本推断兼容性。[src/report/schema.ts:30](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/report/schema.ts#L30) |

## 兼容性策略 {#compatibility-policy}

工件版本的接受必须（MUST）遵循 [Ambercast 计划规范](/ambercast/zh-cn/spec/overview/#compatibility)，而非凭借发布版本号的直觉。模式版本变更可以（MAY）在次要版本中要求重新生成，因为计划是派生工件。[src/core/ir/schema.ts:45](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L45) 

## 设计理由 {#rationale}

变更日志在一个规范位置记录了兼容性变更及其重新生成后果，因此消费者无需从软件包版本控制中推断工件兼容性。

一个被否决的备选方案是仅跟踪软件包发布；该方案之所以被否决，是因为生成者契约指纹的变更可能会在不改变 Plan 模式版本的情况下使计划过时。[CHANGELOG.md:8](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/CHANGELOG.md#L8) [src/core/ir/schema.ts:45](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L45)
