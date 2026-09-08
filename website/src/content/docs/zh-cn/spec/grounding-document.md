---
title: "Grounding 文档"
description: "`GroundingDocument` 是一个严格对象，绑定到恰好一个 Plan 摘要。"
---

## Grounding 形状 {#grounding-shape}

`GroundingDocument` 是一个严格对象，绑定到恰好一个 Plan 摘要。 [src/core/ir/schema.ts:1367](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1367)

| 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `schemaVersion` | integer | 必填 | 字面量 `1` | Grounding 格式版本。 | [src/core/ir/schema.ts:64](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L64), [src/core/ir/schema.ts:1368](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1368) |
| `planDigest` | `HexSha256` | 必填 | `/^[0-9a-f]{64}$/` | 关联计划的摘要。 | [src/core/ir/schema.ts:35](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L35), [src/core/ir/schema.ts:1369](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1369) |
| `entries` | record `StepId` → `GroundingEntry` | 必填 | 严格条目分支 | 按 ID 索引的已缓存步骤 grounding。 | [src/core/ir/schema.ts:1370](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1370) |

## 条目变体 {#entry-variants}

| 对象 | 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| `ElementGroundingEntry` | `kind` | string | 必填 | 字面量 `element` | 元素条目鉴别器。 | [src/core/ir/schema.ts:1093](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1093) |
|  | `fingerprint` | `Fingerprint` | 必填 | 严格 v2 指纹 | 无障碍邻域证据。 | [src/core/ir/schema.ts:1095](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1095) |
| `AiGroundingEntry` | `kind` | string | 必填 | 字面量 `ai` | AI 条目鉴别器。 | [src/core/ir/schema.ts:1114](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1114) |
|  | `trace` | `TraceRecord` | 必填 | 严格 trace | 可重放的成功 trace。 | [src/core/ir/schema.ts:1116](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1116) |

`GroundingEntry` 是这两种确切严格形状的 `kind` 联合。缺失 AI 条目意味着未记录任何 trace；带有空验证（verification）的 `ai` 条目是无效的。 [src/core/ir/schema.ts:1057-1061](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1057-L1061), [src/core/ir/schema.ts:1114-1117](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1114-L1117), [src/core/ir/schema.ts:1131-1134](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1131-L1134)

## Trace 记录 {#trace-record}

| 对象 | 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| `TraceRecord` | `events` | `TraceEntry[]` | 必填 | 可为空 | 按时间顺序的操作/断言日志。 | [src/core/ir/schema.ts:1057](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1057) |
|  | `verification` | `TraceAssert[]` | 必填 | 最小为 1 | 可重放成功所必需的终结断言。 | [src/core/ir/schema.ts:1059](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1059) |
|  | `verificationCoverage` | record `InstructionCriterionId` → integer | 可选 | 非负整数 | 累加式的覆盖到验证索引映射。 | [src/core/ir/schema.ts:1060](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1060) |
| `TraceClick` | `type`, `target` | string, `ElementRef` | 必填 | 字面量 `click`；严格 target | 已记录的点击。 | [src/core/ir/schema.ts:890](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L890) |
| `TraceNavigate` | `type`, `url` | string, `InterpolatableText` | 必填 | 字面量 `navigate`；无 secret 标记 | 已记录的导航。 | [src/core/ir/schema.ts:906](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L906) |
| `TracePress` | `type`, `target`, `key` | string, locator, string | 必填 | 字面量 `press`；key 枚举 | 已记录的按键。 | [src/core/ir/schema.ts:922](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L922) |
| `TraceFill` | `type`, `target`, `value` | string, locator, text | 必填 | 字面量 `fill`；无 secret 标记 | 已记录的普通填充。 | [src/core/ir/schema.ts:938](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L938) |
| `TraceFillSecret` | `type`, `target`, `secretRef` | string, locator, ref | 必填 | 字面量 `fill-secret`；完整 ref | 不含字面值的已记录 secret 填充。 | [src/core/ir/schema.ts:954](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L954) |

`TraceAction` 是这五种操作记录的 `type` 联合。`key` 枚举为 `Enter`、`Tab`、`Escape`、`ArrowDown`、`ArrowUp`；`ElementRef`、`InterpolatableText` 和 `SecretRef` 保留其来自 [值类型](/ambercast/zh-cn/spec/value-types/#shared-types) 的约束。 [src/core/ir/schema.ts:407-410](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L407-L410), [src/core/ir/schema.ts:922-925](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L922-L925), [src/core/ir/schema.ts:970-976](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L970-L976)

## Trace 验证记录 {#trace-verification-records}

每个 `TraceAssert` 分支都是严格的，且要求 `type: "assert"`；它与 Plan 断言共享相同的特定检查字段包。 [src/core/ir/schema.ts:997](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L997)

| 变体 | 字段 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `text-visible` | `type`, `check`, `text` | 全部必填 | 字面量 `assert`、`text-visible`；非 secret 文本 | 可见性观察。 | [src/core/ir/schema.ts:998](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L998) |
| `element-visible` | `type`, `check`, `target` | 全部必填 | 字面量 `assert`、`element-visible`；严格 locator | 元素可见性观察。 | [src/core/ir/schema.ts:1003](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1003) |
| `text-equals` | `type`, `check`, `target`, `text` | 全部必填 | 字面量 `assert`、`text-equals`；非 secret 文本 | 精确文本观察。 | [src/core/ir/schema.ts:1008](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1008) |
| `url-matches` | `type`, `check`, `pattern` | 全部必填 | 字面量 `assert`、`url-matches`；非 secret 文本 | URL 观察。 | [src/core/ir/schema.ts:1013](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1013) |
| `element-count` | `type`, `check`, `target`, `count` | 全部必填 | 字面量 `assert`、`element-count`；整数 ≥ 0 | 计数观察。 | [src/core/ir/schema.ts:1018](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1018) |

`TraceEntry` 是 `TraceAction` 和 `TraceAssert` 的外层 `type` 联合。 [src/core/ir/schema.ts:1039](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L1039)

## 完整最小文档 {#complete-minimal-document}

此说明性的 `planDigest` 引用了 [计划文档](/ambercast/zh-cn/spec/plan-document/#complete-minimal-document) 中的完整 Plan 示例。它不是计算得出的摘要。

```json
{
  "schemaVersion": 1,
  "planDigest": "0000000000000000000000000000000000000000000000000000000000000000",
  "entries": {}
}
```

## 权威性与绑定 {#authority-and-binding}

消费方必须（MUST）重新计算 Plan 摘要，且仅当其等于 `planDigest` 时才接受 Grounding。 [src/core/ir/digest.ts:145](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/digest.ts#L145)

## Plan digest 绑定 {#plan-digest}

在成功重放现有 trace 之后，实现必须（MUST）保持该条目不变。它必须（MUST）仅在伴随确切终结成功标准覆盖的智能体执行成功后，才写入或覆盖 AI 条目。对于以快照或失败断言结束的成功智能体执行，冷路径必须（MUST）不写入任何条目，而后备路径必须（MUST）删除导致后备的陈旧条目。在智能体执行失败或中止后，它必须（MUST）保持现有条目不变。 [src/usecases/run.ts:1895-1912](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L1895-L1912) [src/usecases/run.ts:2051-2127](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L2051-L2127)

对于每个 `TraceFillSecret`，`secretRef` 必须（MUST）属于所在 Plan AI 步骤已提交的 `secrets[].ref` 授权集。违规属于完整性故障，且严禁（MUST NOT）回退到智能体执行。 [src/usecases/run.ts:896](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L896) [src/usecases/run.ts:1075](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L1075)

## 设计理由 {#rationale}

问题在于元素解析与 AI 执行证据是易失的，而计划意图应当保持可审查。独立的缓存需要明确无歧义地绑定回该意图。 

所选设计为元素步骤赋予有界的指纹，并为 AI 步骤赋予带有终结验证的完整 trace，全部以稳定的步骤 ID 为键并通过摘要进行绑定。这使得 grounding 成为 trace 的唯一权威来源。 

一个被否决的备选方案是将 trace 嵌入到计划中；它被否决的原因是正常的成功运行会导致已审查的工件频繁变动。另一个备选方案是将空 trace 视为成功；它被否决是因为重放需要显式的终结证据。  
