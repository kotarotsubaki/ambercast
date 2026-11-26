---
title: "定位缓存文档"
description: "本章定义 `GroundingDocument`，即绑定到一个执行计划摘要并提交的定位缓存，以及它的条目、轨迹记录，还有实现何时写入或保留条目。"
---

## 定位缓存的形态 {#grounding-shape}

`GroundingDocument` 是一个严格对象，只绑定到一个执行计划摘要 (`src/core/ir/schema.ts:1753`)。

| 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `schemaVersion` | integer | 必填 | 字面量 `5` | 定位缓存格式版本。| `src/core/ir/schema.ts:74,1754` |
| `planDigest` | `HexSha256` | 必填 | `/^[0-9a-f]{64}$/` | 关联执行计划的摘要。| `src/core/ir/schema.ts:35,1755` |
| `entries` | record `StepId` → `GroundingEntry` | 必填 | 严格条目分支 | 按 ID 索引的已缓存步骤 定位缓存。| `src/core/ir/schema.ts:1756` |

## 版本兼容性 {#version-compatibility}

读取方先按原有 v4 结构验证 v4 文档，再接受它。v4 元素记录项不得包含 `components` 或 `ignoredNames` (MUST NOT)。

发布的 v5 Schema 仅接受 v5；冻结的 v4 Schema 描述仍可读取的旧格式。

新写入的文档使用 v5。如果运行没有改写任何内容，就必须保持文件及其版本不变 (MUST)。匹配成功的现有记录项保持不变，ambercast 不会为其补充组成部分。

当其他记录项需要写回时，未改动的 v4 记录项可以不带组成部分保留在 v5 文档中。新解析并确认的元素绑定记录绑定时观察到的组成部分。记录项的保持以规范值比较；写入文档可能规范化原有的非规范文本。

## 条目变体 {#entry-variants}

| 对象 | 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| `ElementGroundingEntryV5` | `kind` | string | 必填 | 字面量 `element` | 元素条目鉴别器。| `src/core/ir/schema.ts:1443` |
|  | `locator` | `GroundingElementLocator` | 必填 | [值类型](/ambercast/zh-cn/spec/value-types/#shared-types) | 绑定到意图的观测定位器。| `src/core/ir/schema.ts:1444` |
|  | `fingerprint` | `Fingerprint` | 必填 | [元素指纹](/ambercast/zh-cn/spec/fingerprint/#algorithm) | 无障碍邻域证据。| `src/core/ir/schema.ts:1445` |
|  | `intentDigest` | `HexSha256` | 必填 | `/^[0-9a-f]{64}$/` | 此定位器绑定的已提交意图的摘要。| `src/core/ir/schema.ts:1446` |
|  | `provenance` | string | 必填 | enum `quoted-match`, `ai-proposed` | 产生此定位器的首次绑定阶段。| `src/core/ir/schema.ts:1447` |
|  | `components` | `FingerprintComponents` | optional | `a11y-components-v1` | 结构与槽位名称哈希。| `src/core/ir/schema.ts:1519` |
|  | `ignoredNames` | `FingerprintNameSlot[]` | optional | min 1; ordered; unique; requires components | 槽位列表；仍按完整指纹匹配。| `src/core/ir/schema.ts:1519` |
| `AiGroundingEntry` | `kind` | string | 必填 | 字面量 `ai` | AI 条目鉴别器。| `src/core/ir/schema.ts:1464` |
|  | `trace` | `TraceRecord` | 必填 | 严格 trace | 可回放的成功 轨迹。| `src/core/ir/schema.ts:1465` |

`GroundingEntry` 是这两种严格形状按 `kind` 区分的联合。缺少 AI 条目表示尚未记录轨迹；验证为空的 `ai` 条目无效 (`src/core/ir/schema.ts:1402-1406,1463-1466,1480-1483`)。

## 组成部分 {#components}

`components` 是可选的严格 `FingerprintComponents` 记录。它必须包含 `algorithm`、`structure`、`parentName`、`siblingBeforeName` 和 `siblingAfterName` 这五个字段。`algorithm` 必须为 `a11y-components-v1` (MUST)。

各哈希必须采用小写十六进制 SHA-256。不存在相邻兄弟节点时，其名称哈希必须为 `null` (MUST)，不能省略字段。`parentName` 始终为哈希。

`ignoredNames` 是可选的非空槽位列表。槽位不得重复，并按 `parent`、`siblingBefore`、`siblingAfter` 的固定顺序排列。包含 `ignoredNames` 的记录项必须包含 `components` (MUST)。

列表中每个槽位的名称哈希均不得为 `null` (MUST NOT)。生成方必须省略空列表 (MUST)。

未知的组成部分字段或任何无效记录项都会使整个文档不符合 Schema。Schema 验证只检查结构和组合，不验证完整指纹与组成部分是否来自同一次观察。

当前实现不会写入 `ignoredNames`。即使已保存的记录项包含 `ignoredNames`，匹配仍比较完整指纹。

## 轨迹记录 {#trace-record}

| 对象 | 字段 | 类型 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| `TraceRecord` | `events` | `TraceEntry[]` | 必填 | 可为空 | 按时间顺序的操作/断言日志。| `src/core/ir/schema.ts:1403` |
|  | `verification` | `TraceAssert[]` | 必填 | 最小为 1 | 可回放成功所必需的终结断言。| `src/core/ir/schema.ts:1404` |
|  | `verificationCoverage` | record `InstructionCriterionId` → integer | 可选 | 非负整数 | 累加式的覆盖到验证索引映射。| `src/core/ir/schema.ts:1405` |
| `TraceClick` | `type`, `element` | string, `ElementRef` | 必填 | 字面量 `click`；严格 target | 已记录的点击。| `src/core/ir/schema.ts:1235` |
| `TraceNavigate` | `type`, `url` | string, `InterpolatableText` | 必填 | 字面量 `navigate`；无 secret 标记 | 已记录的导航。| `src/core/ir/schema.ts:1251` |
| `TracePress` | `type`, `element`, `key` | string, locator, string | 必填 | 字面量 `press`；key 枚举 | 已记录的按键。| `src/core/ir/schema.ts:1267` |
| `TraceFill` | `type`, `element`, `value` | string, locator, text | 必填 | 字面量 `fill`；无 secret 标记 | 已记录的普通填充。| `src/core/ir/schema.ts:1283` |
| `TraceFillSecret` | `type`, `element`, `secretRef` | string, locator, ref | 必填 | 字面量 `fill-secret`；完整 ref | 不含字面值的已记录 secret 填充。| `src/core/ir/schema.ts:1299` |

`TraceAction` 是这五种动作记录按 `type` 区分的联合。`key` 的枚举值是 `Enter`、`Tab`、`Escape`、`ArrowDown` 和 `ArrowUp`。`ElementRef`、`InterpolatableText` 和 `SecretRef` 保留[值类型](/ambercast/zh-cn/spec/value-types/#shared-types)中的约束 (`src/core/ir/schema.ts:567-572,1267-1270,1315-1321`)。

## 轨迹验证记录 {#trace-verification-records}

每个 `TraceAssert` 分支都是严格的，并且要求 `type: "assert"`；它与执行计划中的断言共用同一组按检查类型区分的字段 (`src/core/ir/schema.ts:1342`)。

| 变体 | 字段 | 必填/可选 | 约束 | 描述 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `text-visible` | `type`, `check`, `text` | 全部必填 | 字面量 `assert`、`text-visible`；非 secret 文本 | 可见性观察。| `src/core/ir/schema.ts:1343` |
| `element-visible` | `type`, `check`, `element` | 全部必填 | 字面量 `assert`、`element-visible`；严格 locator | 元素可见性观察。| `src/core/ir/schema.ts:1348` |
| `text-equals` | `type`, `check`, `element`, `text` | 全部必填 | 字面量 `assert`、`text-equals`；非 secret 文本 | 精确文本观察。| `src/core/ir/schema.ts:1353` |
| `url-matches` | `type`, `check`, `pattern` | 全部必填 | 字面量 `assert`、`url-matches`；非 secret 文本 | URL 观察。| `src/core/ir/schema.ts:1358` |
| `element-count` | `type`, `check`, `element`, `count` | 全部必填 | 字面量 `assert`、`element-count`；整数 ≥ 0 | 计数观察。| `src/core/ir/schema.ts:1363` |

`TraceEntry` 是 `TraceAction` 与 `TraceAssert` 按外层 `type` 区分的联合 (`src/core/ir/schema.ts:1384`)。

## 完整最小文档 {#complete-minimal-document}

这个示意用的 `planDigest` 指向[执行计划文档](/ambercast/zh-cn/spec/plan-document/#complete-minimal-document)中的完整执行计划示例。它不是计算出来的摘要。

```json
{
  "schemaVersion": 5,
  "planDigest": "0000000000000000000000000000000000000000000000000000000000000000",
  "entries": {}
}
```

## 权威性与绑定 {#authority-and-binding}

消费方必须 (MUST) 重新计算执行计划摘要，并且只有当它等于 `planDigest` 时才接受定位缓存 (`src/core/ir/digest.ts:153`) (`src/core/ir/digest.ts:170`)。

## 执行计划摘要绑定 {#plan-digest}

成功回放现有轨迹之后，实现必须 (MUST) 保持该条目不变。实现必须 (MUST) 只在智能体执行成功且精确覆盖了终态成功准则之后，才写入或覆盖 AI 条目。智能体执行成功但最后一次观测是快照或失败的断言时，冷路径必须 (MUST) 不写入任何条目。智能体执行成功但最后一次观测是快照或失败的断言时，回退路径必须 (MUST) 删除引发回退的陈旧条目。智能体执行失败或中止之后，实现必须 (MUST) 保持已有条目不变 (`src/usecases/run.ts:2255-2266`) (`src/usecases/run.ts:2565`)。

元素条目只有在绑定达到 `confirmed` 时才可以写入或覆盖，这是必须 (MUST) 遵守的条件。以下任一情况都会使绑定达到 `confirmed`：

- 至少一个步骤在其非空的已提交 `confirms` 列表中列出该元素步骤，且所有这样的步骤都在同一用例中以有效依据通过。`element-visible` 断言只有在恰好一个候选匹配时才提供有效的确认依据。
- 用例的所有步骤都通过。剩余的 click、press、fill、fill-secret 和 capture 绑定都会确认。其中包括未列在 `confirms` 中的操作，以及 `element-visible` 匹配到多个候选的操作。

用例中途失败或中断时，不得 (MUST NOT) 持久化只达到 `acted` 的绑定。写入文件仍需回写开关允许 (`src/usecases/run.ts:3559-3582`) (`src/usecases/run.ts:3490-3524`) (`src/usecases/run.ts:4431-4437`) (`src/usecases/run.ts:4526-4536`)。

对于每个 `TraceFillSecret`，`secretRef` 必须 (MUST) 属于包含它的执行计划 AI 步骤中已提交的 `secrets[].ref` 集合。违反属于完整性失败，并且不得 (MUST NOT) 回退到智能体执行 (`src/usecases/run.ts:1158`) (`src/usecases/run.ts:1356`)。

定位缓存的版本 2 和 3 已废弃。在已提交的策略下，`check` 会在模式校验之前报告 `stale-grounding`；在未提交的策略下，则得到 `fresh-without-grounding`。没有 `--resolve` 时，若执行计划摘要匹配且有元素步骤需要定位缓存，`run` 会报告带 `recoverable-miss` 的 `GROUNDING_UNRESOLVED`；摘要不同则得到 `missing`。

`run --resolve` 从空缓存开始，并可以在现有写回条件下持久化 v5。对于未变化的新鲜执行计划，`generate` 会用空的 v5 定位缓存替换已废弃的缓存。在用 `ambercast run --resolve --update-cache` 重新生成缓存之前，`heal` 会报告 `FS_IO_ERROR`。版本 1 和未知版本在 `check` 中仍然无效，在 `run` 中仍然是缓存未命中。

## 设计理由 {#rationale}

问题在于，元素解析和 AI 执行的证据是易变的，而执行计划的意图应当保持可评审。独立的缓存需要一个明确的绑定，指回该意图。

所选设计为元素步骤提供有界的指纹，为 AI 步骤提供带终态验证的完整轨迹，全部以稳定的步骤 ID 为键，并由摘要绑定。这使定位缓存成为轨迹的唯一权威。

被否决的备选方案之一是把轨迹嵌入执行计划，因为正常的成功运行会不断改动经过评审的产物。另一个是把空轨迹当作成功，因为回放需要明确的终态证据。
