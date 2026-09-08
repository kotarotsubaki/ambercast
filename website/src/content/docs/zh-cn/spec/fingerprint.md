---
title: "元素指纹"
description: "`Fingerprint."
---

## 算法 {#algorithm}

`Fingerprint.algorithm` 必须为（MUST）`a11y-neighborhood-v2`。[src/core/ir/schema.ts:221](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L221) 其描述符包含目标 role/name 以及直接父级和紧邻的前后兄弟节点的 role/name。仅当相邻兄弟节点缺失时才为 `null`；匹配的节点始终具有直接父级，且顶层节点使用合成根节点作为该父级。[src/core/ir/fingerprint.ts:164](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/fingerprint.ts#L164) [src/core/ir/fingerprint.ts:259](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/fingerprint.ts#L259) 名称必须（MUST）经过 NFC 规范化、空白折叠并去除首尾空白；role 保持精确。[src/core/ir/fingerprint.ts:82](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/fingerprint.ts#L82)

该算法必须（MUST）：(1) 解析一棵有效的无障碍树；(2) 找到恰好一个节点，其 role 与引用完全相等，且其 name 在经过 NFC、连续空白折叠及修剪后相匹配；(3) 构建 `{role,name,parent,siblingBefore,siblingAfter}`；(4) 将缺失的兄弟节点编码为 `null`；(5) 将描述符序列化为兼容 RFC 8785 的规范 UTF-8 JSON；(6) 对这些字节计算 SHA-256；以及 (7) 存储带有 v2 标签的小写十六进制输出。[src/core/ir/fingerprint.ts:240](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/fingerprint.ts#L240), [src/core/ir/fingerprint.ts:340](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/fingerprint.ts#L340) 后代节点和非相邻兄弟节点不得（MUST NOT）进入原像。[src/core/ir/fingerprint.ts:39](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/fingerprint.ts#L39)

## 摘要 {#digest}

实现必须（MUST）使用 [规范 JSON](/ambercast/zh-cn/spec/canonical-json/#digest-form) 序列化描述符并对其计算 SHA-256。[src/core/ir/fingerprint.ts:6](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/fingerprint.ts#L6) [src/core/ir/digest.ts:33](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/digest.ts#L33) 非 v2 标签无法通过严格的 Grounding schema 校验。在 `run` 中，声明了 `trace.verificationCoverage` 的当前出处原始 Grounding 文档会将随后的严格校验或规范校验失败转化为完整性失败；若无该声明，不可用的伴随项将被视为缓存未命中。[src/core/ir/schema.ts:215](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L215) [src/usecases/run.ts:498](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L498) 在 `check` 中，grounding 检查在进行出处比对前将 schema 无效的伴随项归类为 `invalid`；公开报告状态为 [新鲜度与摘要](/ambercast/zh-cn/spec/freshness/#freshness-consequences) 中定义的仓库策略映射。[src/usecases/check-grounding.ts:45](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/check-grounding.ts#L45)

## 匹配 {#matching}

指纹不匹配必须（MUST）被视为未命中，绝不能作为旧元素可以安全重放的证据。这遵循了已实现的版本门禁和不匹配失效机制。[src/core/ir/schema.ts:215](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L215) [src/core/ir/fingerprint.ts:39](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/fingerprint.ts#L39)

`hit`、`fingerprint-mismatch`、`element-not-found`、`ambiguous-match` 和 `snapshot-invalid` 是截然不同的解析结果。缺失或畸形的树为 `element-not-found`；存在多个归一化 role/name 匹配项为 `ambiguous-match`；哈希过旧或不同为 `fingerprint-mismatch`。[src/core/ir/fingerprint.ts:347](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/fingerprint.ts#L347), [src/core/ir/fingerprint.ts:388](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/fingerprint.ts#L388) 未配对的代理项在生成时不产生指纹，在解析时产生 `element-not-found`。[src/core/ir/fingerprint.ts:181](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/fingerprint.ts#L181)

## 设计理由 {#rationale}

要解决的问题是在不允许陈旧定位器在视觉相似元素上重放的前提下检测局部 UI 漂移。有界邻域使该证据得以显式化。

所选设计在稳定的文本归一化之后，对目标、父级以及紧邻的兄弟节点进行哈希计算。它将未命中与匹配明确区分开来，而不是允许启发式复用。

一个被否决的备选方案是全树哈希；它之所以被否决，是因为无关变更会导致过多的未命中。另一个被否决的方案是基于选择器派生的标识；它之所以被否决，是因为选择器属于实现细节，而非保留的意图证据。 

v1 解析器无法提供无障碍证据的故障闭锁扫描。版本 2 更改了算法标签，因此 v1 指纹无法被解释为 v2 证据。其运行结果遵循 [元素指纹](/ambercast/zh-cn/spec/fingerprint/#digest) 中的当前出处与覆盖率声明规则，而不是无条件回退到重新解析。[CHANGELOG.md:78](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/CHANGELOG.md#L78) [src/usecases/run.ts:498](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L498)
