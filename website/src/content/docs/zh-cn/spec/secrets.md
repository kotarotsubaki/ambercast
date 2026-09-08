---
title: "计划中的机密"
description: "计划必须（MUST）仅使用 值类型 `SecretRef` 来表示机密值；连续的 `{{secrets."
---

## 授权 {#authorization}

计划必须（MUST）仅使用 [值类型](/ambercast/zh-cn/spec/value-types/#shared-types) `SecretRef` 来表示机密值；连续的 `{{secrets.` 插值标记禁止出现在 `InterpolatableText` 中。[src/core/ir/schema.ts:33](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L33) [src/core/ir/schema.ts:125](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L125) `fill-secret` 必须（MUST）携带其 `SourceSpan`；AI 机密授权必须（MUST）为每个引用携带一个 span。[src/core/ir/schema.ts:515](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L515) [src/core/ir/schema.ts:690](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L690)

## 授权来源 {#grant-origin}

授权必须（MUST）来自归一化 prompt 文本中位于 CommonMark 代码结构之外的完整 `@ambercast-secret {{secrets.X}}` 行。[src/core/ir/secret-grant-source.ts:4](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/secret-grant-source.ts#L4) 重复的行属于互不相同的授权出现，且其 span 为基于 1 的物理行。[src/core/ir/secret-grant-source.ts:28](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/secret-grant-source.ts#L28)

归因必须（MUST）在归一化 prompt 文本中精确定位 provider 引文恰好一次，要求其包含具名的字面量引用，然后将该唯一范围解析为恰好一个已解析的授权；否则生成过程将暴露 `citation-not-found`、`citation-not-unique`、`citation-missing-ref` 或 `citation-unresolved`。[src/core/errors/secret-grant-unattributable-error.ts:77](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/errors/secret-grant-unattributable-error.ts#L77) 提交后的形式记录 `SourceSpan`，绝不记录 provider 引文。[src/core/ir/schema.ts:515-520](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L515-L520) [src/core/ir/schema.ts:690-692](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L690-L692) [src/core/ir/schema.ts:758-763](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L758-L763) [src/core/ir/schema.ts:798-800](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L798-L800)

## 接收端与脱敏 {#sink-and-redaction}

机密接收端源必须（MUST）为 HTTP(S) 源，且严禁（MUST NOT）包含连续的 `{{secrets.` 插值标记；此 schema 约束本身并不足以证明不存在形似机密的任意字面量。[src/core/ir/schema.ts:83](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L83) [src/core/ir/schema.ts:95](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L95) 使用方必须（MUST）在已提交的 grounding trace 数据中保留引用，而非字面量密码。[src/core/ir/schema.ts:949](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L949)

接收端策略在运行时解析并归一化源；若 `secretSinkOrigins` 中缺少所请求机密的配置条目，则仅允许 `baseUrl`；空的条目则不允许任何源；非空条目将替换该默认值。对于每一次实际的 `fill-secret`，运行流水线必须（MUST）在解析其机密前紧接着检查实时页面源；浏览器适配器必须（MUST）在获取元素后且填充前紧接着重复该策略检查，以确保页面导航或 DOM 变更无法绕过实时源边界。[src/core/ir/schema.ts:152-157](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L152-L157) [src/usecases/run.ts:765](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L765) [src/usecases/run.ts:896](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L896) [src/adapters/browser/chromium.ts:413](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/adapters/browser/chromium.ts#L413)

## 字面量机密拒绝 {#literal-secret-rejection}

本节是字面量机密检测器语义的权威所有者。参考页面必须（MUST）仅出于其局部目的概述检测器边界，并链接至此处。在持久化或报告序列化之前，生成过程必须（MUST）按照字典序键和数组索引的遍历顺序，检查来自 provider 的每个 JSON 字符串和对象键，包括 `generatorMeta` 和歧义项。对于每个字符串值或对象键，嵌入的 `{{secrets.` 标记（SEC-17）必须（MUST）在检查以下四种 primitive 检测器之前被拒绝；在这四者之间，必须（MUST）按以下固定顺序拒绝首个匹配的检测器。[src/usecases/generator-secret-policy.ts:585](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/generator-secret-policy.ts#L585)

| id | 检测器 | 匹配值 | 例外 | 分类故障 |
| --- | --- | --- | --- | --- |
| SEC-01 | `credential-prefix-sk` | 以 `sk-` 开头 | 作为字符串值或对象键的有效全值 `SecretRef`；仅限 `source.inputsDigest` | `SECRET_LITERAL_REJECTED`, exit `2` |
| SEC-02 | `credential-prefix-ghp` | 以 `ghp_` 开头 | 作为字符串值或对象键的有效全值 `SecretRef`；仅限 `source.inputsDigest` | `SECRET_LITERAL_REJECTED`, exit `2` |
| SEC-03 | `credential-prefix-aws-access-key` | 以 `AKIA` 开头 | 作为字符串值或对象键的有效全值 `SecretRef`；仅限 `source.inputsDigest` | `SECRET_LITERAL_REJECTED`, exit `2` |
| SEC-04 | `high-entropy-token` | 具有 token 形状（至少 32 个 UTF-16 代码单元、无空白字符、每个字符均属于 `[A-Za-z0-9+/=_.-]`）且香农熵至少 4.0 比特，其中频数键按 Unicode 码点迭代，但每个概率分母使用 UTF-16 代码单元长度 | 作为字符串值或对象键的有效全值 `SecretRef`；仅限 `source.inputsDigest`；在 `steps[<index>].url`、`steps[<index>].pattern`、`targets[<key>].baseUrl` 的值位置同样例外 | `SECRET_LITERAL_REJECTED`, exit `2` |
| SEC-17 | `embedded-secret-reference` | 包含 `{{secrets.` 标记、但不是有效全值 `SecretRef` 的字符串值或对象键 | 仅限 `source.inputsDigest` | `SECRET_LITERAL_REJECTED`, exit `2` |

有效的全值 `SecretRef` 无论作为字符串值还是对象键，均可豁免本节的所有检测器；其余的键在遍历其值之前都会传递给检测器。拒绝诊断信息必须（MUST）仅包含检测器和脱敏后的类 JSON 路径；其严禁（MUST NOT）保留检测到的字面量，且检测到的对象键使用 `[redacted-key]`。[src/usecases/generator-secret-policy.ts:585](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/generator-secret-policy.ts#L585) [src/usecases/generator-secret-policy.ts:615](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/generator-secret-policy.ts#L615) [src/report/error-mapping.ts:23](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/report/error-mapping.ts#L23) [src/core/errors/exit-codes.ts:31](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/errors/exit-codes.ts#L31)

## 特定边界的机密性要求 {#boundary-specific-secrecy}

| id | 边界 | 要求 | 证据 |
| --- | --- | --- | --- |
| SEC-05 | 生成 | 来自 provider 的 JSON 在持久化或报告序列化之前，必须（MUST）通过字面量机密拒绝检查。 | [src/usecases/generator-secret-policy.ts:585](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/generator-secret-policy.ts#L585) |
| SEC-06 | 指纹生成 | 包含非空已解析机密作为完全匹配的描述符必须（MUST）产生 `secret-contaminated`；子字符串匹配仅在比较值至少为 3 个 UTF-16 代码单元时适用，且严禁（MUST NOT）生成指纹。 | [src/core/ir/fingerprint.ts:278](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/fingerprint.ts#L278) |
| SEC-07 | 已提交的 trace | `TraceFillSecret` 必须（MUST）存储 `secretRef`，而非具体化的值。 | [src/core/ir/schema.ts:949](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L949) |
| SEC-08 | grounding 持久化 | 当扫描的字符串值与任何非空已解析机密完全相等，或包含解析值至少为 3 个 UTF-16 代码单元的机密时，运行流水线必须（MUST）拒绝写入 grounding；且必须（MUST）将其归类为完整性违规。 | [src/usecases/run.ts:1252](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L1252) [src/usecases/run.ts:3425](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L3425) |
| SEC-09 | 诊断与可报告错误 | 运行流水线在诊断/报告序列化之前，必须（MUST）对 JSON 字符串和对象键进行脱敏。 | [src/usecases/run.ts:1542](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L1542) |
| SEC-10 | 发往 AI 的无障碍证据 | 发送给 AI provider 的无障碍证据必须（MUST）对字符串值和对象键中的已解析值进行脱敏；截图字节严禁（MUST NOT）跨越此边界。 | [src/usecases/run.ts:2023](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L2023) |
| SEC-11 | 截图持久化 | 当已解析机密检测在无障碍捕获中发现机密值、捕获在解析后无法被检查、或检测失败时，截图严禁（MUST NOT）被保留。 | [src/usecases/run.ts:2550](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L2550) |
| SEC-12 | AI trace 机密标记 | 缓存的 AI trace 中除专用的 `TraceFillSecret.secretRef` 字段外，每个字符串值的后代节点严禁（MUST NOT）包含连续的 `{{secrets.` 标记。违规属于完整性故障，且严禁（MUST NOT）回退到 provider 执行。 | [src/usecases/run.ts:984](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L984) |
| SEC-13 | 缓存的 AI trace 具体化机密 | 在回放之前，流水线必须（MUST）解析存储 trace 的事件和验证列表中由所属 Plan AI 步骤授权的每个 `fill-secret` 引用。生成的值将并入当前用例中已解析的值。随后流水线必须（MUST）扫描除固定的 `type`、`check`、`target.strategy`、`key` 和 `secretRef` 词表之外的每个 trace 值；与任何非空已解析机密完全匹配，或在该机密至少具有 3 个 UTF-16 代码单元时发生子字符串匹配，均属于完整性故障，且严禁（MUST NOT）回退到 provider 执行。 | [src/usecases/run.ts:1075-1129](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L1075-L1129); [src/usecases/run.ts:1252-1313](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L1252-L1313); [src/usecases/run.ts:2190-2209](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L2190-L2209) |
| SEC-14 | AI `fill.value` 凭据字面量 | 在浏览器执行之前，存储 trace 和全新 agentic 的 `fill.value` 必须（MUST）无条件拒绝 `sk-`、`ghp_` 和 `AKIA` 检测器。仅当移除捕获的当前用例值后不再匹配任何检测器时，才允许高熵匹配；此例外不适用于前缀检测器。违规属于完整性故障：存储 trace 验证严禁（MUST NOT）回退，且全新 agentic 执行严禁（MUST NOT）进入浏览器执行或 journal 持久化。 | [src/usecases/run.ts:984-1040](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L984-L1040); [src/usecases/run.ts:1350-1405](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L1350-L1405); [src/usecases/run.ts:1954-1975](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L1954-L1975); [src/usecases/run.ts:2190-2209](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L2190-L2209) |
| SEC-15 | provider 边界处的运行时捕获值 | 没有 `verificationCoverage` 的旧版存储 trace 严禁（MUST NOT）在任何非固定词表的值中包含非空的当前用例捕获值（未解析的 `{{run.name}}` 占位符除外）；匹配方式为子字符串匹配。全新的 agentic 导航 URL、`fill.value` 以及文本/断言模式严禁（MUST NOT）完全等于当前用例捕获值。存储 trace 违规会在浏览器回放前或 provider 接收到 `priorTrace` 之前判定失败；全新违规会在浏览器执行和持久化之前判定失败。使用方必须（MUST）使用经过授权的 `RunRef` 插值，而不是具体化捕获的值。 | [src/usecases/run.ts:1013-1063](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L1013-L1063); [src/usecases/run.ts:1316-1347](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L1316-L1347); [src/usecases/run.ts:1420-1458](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L1420-L1458); [src/usecases/run.ts:2190-2209](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L2190-L2209) |
| SEC-16 | 全新 agentic 动作/断言具体化机密 | 在具体化之前，每个全新的 agentic 动作和断言必须（MUST）根据当前用例中的所有非空已解析机密，对其非固定词表的值进行扫描。`type`、`check`、`target.strategy`、`key` 和 `secretRef` 是仅有的封闭词表排除项。扫描的值若完全相等，或包含至少 3 个 UTF-16 代码单元的已解析机密，则必须（MUST）判定失败。该失败是在浏览器执行之前的完整性故障；严禁（MUST NOT）将该动作或通过的断言追加到 journal、更新 Grounding，或进入工件持久化。 | [src/usecases/run.ts:1252-1263](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L1252-L1263); [src/usecases/run.ts:1286-1313](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L1286-L1313); [src/usecases/run.ts:1420-1427](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L1420-L1427); [src/usecases/run.ts:1954-1975](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L1954-L1975); [src/usecases/run.ts:1991-2013](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L1991-L2013); [src/usecases/run.ts:2051-2116](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L2051-L2116) |

Canvas、图像和 CSS 渲染的像素，以及无障碍扫描与截图捕获之间的时间间隔，仍属于残留的泄露风险；本实现并不声称能够检测它们。[src/usecases/run.ts:2610](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L2610)

对于每个 `TraceFillSecret`，记录的 `secretRef` 必须（MUST）包含在所属 Plan AI 步骤的授权集中。未授权的引用属于完整性故障，且严禁（MUST NOT）导致回退。[src/usecases/run.ts:896](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L896) [src/usecases/run.ts:1075](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L1075)

## 设计理由 {#rationale}

所要解决的问题是允许 agent 填充所需的凭据，同时不将 prompt 文本、日志或 UI 证据变为机密通道。授权必须是可审计且收敛的。

所选设计需要明确的归一化 prompt 授权、局部归因的 span、全值引用以及允许的接收端源。当该链条中的任何环节存在歧义时，系统将采取故障关闭（fail-closed）策略。

一个被否决的备选方案是从匹配的文本中推断权限；该方案被否决是因为示例和正文文本并非授权。另一个方案是在 trace 中持久化字面量值；该方案被否决是因为已提交的工件和诊断信息是长期存在的泄露面。 
