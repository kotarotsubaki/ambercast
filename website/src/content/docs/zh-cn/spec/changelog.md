---
title: "规范变更日志"
description: "工件版本的接受必须（MUST）遵循 Ambercast 计划规范，而非凭借发布版本号的直觉。"
---

## 版本历史 {#version-history}

| 变更 | 证据 | 迁移义务 |
| --- | --- | --- |
| TP3：通过完整的 registry 统一 executor 的 kind 词汇，并删除 TP2 引入但不可达的 `executor-unregistered` 原因。未启用 `--resolve` 时，element step 的 grounding 未命中统一报告 `GROUNDING_UNRESOLVED`：退出码由 3 变为 4，且从无错误代码变为有代码。Plan v4、grounding v2 和 config schema 保持不变；report 3.7 仅缩小 browser launch 的 reason 枚举。 | repo:src/core/executor/kinds.ts, repo:src/adapters/browser/registry.ts, repo:src/usecases/run.ts, repo:src/report/schema.ts | 报告使用方应移除 `executor-unregistered`，并接受 element step 的 `GROUNDING_UNRESOLVED`。无需重新生成 Plan 或 grounding。 |
| TP2：目标配置由 `targets.<name>.browser` 改为 `targets.<name>.executor`，删除 `RunCaseOutcome.engine`，在报告契约中新增 `sessions[name].executor`；新增 `EXECUTOR_UNSUPPORTED` 错误代码，并将 `BROWSER_LAUNCH_FAILED` 原因的旧 `engine` 前缀改为 `executor`（`executor-unregistered`）；Plan schema 不变 | repo:src/core/config/schema.ts, repo:src/report/schema.ts, repo:src/report/error-mapping.ts | 若无需显式指定 executor，应删除旧 browser 键；否则迁移至 `executor: { kind: "playwright", browser: "chromium" }`（`executor.browser`）。loader 会以 `ConfigInvalidError` 拒绝旧键。报告使用方须处理已删除和新增的字段、新错误代码及更名后的原因；此次 schema 变更无需重新生成 Plan。 |
| Plan v3 → v4 adds required step Target names, renames element references, and removes Plan browser selection | repo:src/core/ir/schema.ts | Regenerate v3 plans; v4 is the accepted Plan format. |
| grounding v1 → v2 renames trace locator fields to `element` | repo:src/core/ir/schema.ts | Regenerate grounding with Plan v4. |
| report 3.6 → 3.7 adds step Target names and per-Target sessions | repo:src/report/schema.ts | Consumers MUST accept report `3.7` fields. |
| Plan v1 → v2 增加指令覆盖率 | [src/core/ir/schema.ts:45](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L45), [src/core/ir/schema.ts:1185](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1185) | 生成者与消费者必须（MUST）拒绝 v1 并重新生成或报告其过时；不得（MUST NOT）对其进行就地迁移。[src/core/ir/schema.ts:50](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L50) |
| fingerprint v1 → v2 | [CHANGELOG.md:78](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/CHANGELOG.md#L78) | v2 是唯一被接受的标签。带有覆盖声明的当前出处文档在随后的严格/规范验证失败时，完整性必须（MUST）判定为失败；未带有该声明的伴随文档在 `run` 中可能发生缓存未命中，而 `check` grounding 检查将模式无效的内容归类为 `invalid`（公开状态依据 [新鲜度与摘要](/ambercast/zh-cn/spec/freshness/#freshness-consequences)）。[src/usecases/run.ts:498](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L498) [src/usecases/check-grounding.ts:45](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/check-grounding.ts#L45) |
| 生成者 bundle 指纹进入 `inputsDigest` | [CHANGELOG.md:8](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/CHANGELOG.md#L8) | 变更前生成的 Plan 必须（MUST）重新生成，因为它们已过时。[CHANGELOG.md:8](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/CHANGELOG.md#L8) |
| report 2.0 → 3.0 | [CHANGELOG.md:55](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/CHANGELOG.md#L55), [CHANGELOG.md:58](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/CHANGELOG.md#L58) | Report 消费者必须（MUST）接受当前的 `3.0` 契约，而不是从 Plan 版本推断兼容性。[src/report/schema.ts:15](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/report/schema.ts#L15) |
| report 3.0 → 3.1 | [src/report/schema.ts:22](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/report/schema.ts#L22) | Report 消费者必须（MUST）接受当前的 `3.1` 契约（包括可选的结构化错误诊断），而不是从 Plan 版本推断兼容性。[src/report/schema.ts:22](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/report/schema.ts#L22) |
| report 3.1 → 3.2 | [src/report/schema.ts:30](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/report/schema.ts#L30) | Report 消费者必须（MUST）接受当前的 `3.2` 契约（包括可选的 `PROMPT_PATH_INVALID` details 分支），而不是从 Plan 版本推断兼容性。[src/report/schema.ts:30](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/report/schema.ts#L30) |
| report 3.2 → 3.3 | [src/report/schema.ts:30](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/report/schema.ts#L30) | Report 消费者必须（MUST）接受当前的 `3.3` 契约（包括可选的 AI 调用计量字段），而不是从 Plan 版本推断兼容性。[src/report/schema.ts:30](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/report/schema.ts#L30) |
| report 3.3 → 3.4 | [src/report/schema.ts:30](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/report/schema.ts#L30) | Report 消费者必须（MUST）接受当前的 `3.4` 契约（包括可选的 `BROWSER_LAUNCH_FAILED` details 分支），而不是从 Plan 版本推断兼容性。[src/report/schema.ts:30](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/report/schema.ts#L30) |
| Plan v2 → v3 删除 secret-grant provenance | [src/core/ir/schema.ts:58](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L58), [src/core/ir/schema.ts:674](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L674) | 生成者与消费者必须（MUST）拒绝 v2 并重新生成或报告其过时；不得（MUST NOT）对其进行就地迁移。[src/core/ir/schema.ts:49](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L49) |
| report 3.4 → 3.5 | [src/report/schema.ts:42](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/report/schema.ts#L42) | Report 消费者必须（MUST）接受当前的 `3.5` 契约（包括三个新的 secret-policy error code：`SECRET_ENV_VAR_COLLISION`、`SECRET_CONSENT_REQUIRED`、`SECRET_SYNTAX_REJECTED`、可选的 `GROUNDING_UNRESOLVED` details 分支（`stepId`、`reason`），以及可选的 `GenerateResult.secrets`/`warnings` fields），而不是从 Plan 版本推断兼容性。[src/report/schema.ts:42](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/report/schema.ts#L42) |
| report 3.5 → 3.6 | [src/report/schema.ts:42](https://github.com/kotarotsubaki/ambercast/blob/787ac3dd8f07b95a303d265ea65ef1493e97a8a8/src/report/schema.ts#L42) | Report 消费者必须（MUST）接受当前的 `3.6` 契约，包括所有四个 completed heal-result 分支新增的可选 `repairTrace` 诊断字段，而不是从 Plan 版本推断兼容性。该字段投影每个案例的 Stage 1/2/3 尝试与结果历史（issue #383 / SPEC-9 至 SPEC-12）。admission-denied 阶段不会添加 `repairTrace` 条目，仅通过 `stopReason: "attempt-limit" \| "deadline"` 体现；被中断（interrupted）的工作完全不会产生 completed 结果（报告为 `skipped`），因此既没有 `repairTrace` 条目，也没有 `stopReason`。[src/report/schema.ts:42](https://github.com/kotarotsubaki/ambercast/blob/787ac3dd8f07b95a303d265ea65ef1493e97a8a8/src/report/schema.ts#L42) |

## 兼容性策略 {#compatibility-policy}

工件版本的接受必须（MUST）遵循 [Ambercast 计划规范](/ambercast/zh-cn/spec/overview/#compatibility)，而非凭借发布版本号的直觉。模式版本变更可以（MAY）在次要版本中要求重新生成，因为计划是派生工件。[src/core/ir/schema.ts:45](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L45) 

## 设计理由 {#rationale}

变更日志在一个规范位置记录了兼容性变更及其重新生成后果，因此消费者无需从软件包版本控制中推断工件兼容性。

一个被否决的备选方案是仅跟踪软件包发布；该方案之所以被否决，是因为生成者契约指纹的变更可能会在不改变 Plan 模式版本的情况下使计划过时。[CHANGELOG.md:8](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/CHANGELOG.md#L8) [src/core/ir/schema.ts:45](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L45)
