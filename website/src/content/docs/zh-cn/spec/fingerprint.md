---
title: "元素指纹"
description: "本章定义定位缓存为元素步骤保存的元素指纹、指纹的计算方法，以及已保存指纹的匹配方法。"
---

## 算法 {#algorithm}

`Fingerprint.algorithm` 必须 (MUST) 为 `a11y-neighborhood-v2` (`src/core/ir/schema.ts:303`) (`src/core/ir/schema.ts:320`)。

描述符包含目标的 role 和 name，以及直接父节点、紧邻的前一个和后一个兄弟节点的 role 和 name。只有不存在的相邻兄弟节点记为 `null`；匹配的节点始终有直接父节点，顶层节点以合成根节点作为父节点 (`src/core/ir/fingerprint.ts:174`) (`src/core/ir/fingerprint.ts:216`)。

名称必须 (MUST) 经过 NFC 规范化、折叠连续空白并去除首尾空白；role 保持精确匹配 (`src/core/ir/fingerprint.ts:106`)。

算法必须 (MUST) 完成以下步骤 (`src/core/ir/fingerprint.ts:241`) (`src/core/ir/fingerprint.ts:348`)：

1. 解析有效的无障碍树。
2. 找到恰好一个节点，其 role 与引用完全相等，其 name 经过 NFC 规范化、连续空白折叠和首尾空白去除后与引用匹配。
3. 构建 `{role,name,parent,siblingBefore,siblingAfter}`。
4. 将缺失的兄弟节点编码为 `null`。
5. 将描述符序列化为与 RFC 8785 兼容的规范 UTF-8 JSON。
6. 对这些字节计算 SHA-256。
7. 存储带有 v2 标签的小写十六进制输出。

后代节点和不相邻的兄弟节点不得 (MUST NOT) 进入原像 (`src/core/ir/fingerprint.ts:46-50`)。

## 摘要 {#digest}

实现必须 (MUST) 使用[规范 JSON](/ambercast/zh-cn/spec/canonical-json/#digest-form) 序列化描述符，并对其计算 SHA-256 (`src/core/ir/fingerprint.ts:6`) (`src/core/ir/digest.ts:35`)。

非 v2 标签无法通过严格的定位缓存模式校验 (`src/core/ir/schema.ts:319-322`)。

在 `run` 中，声明了 `trace.verificationCoverage` 的当前出处原始定位缓存文档，会把随后的严格校验或规范校验失败变成完整性失败。没有该声明时，不可用的伴随文件按缓存未命中处理 (`src/usecases/run.ts:773-851`)。

在 `check` 中，定位缓存检查会在比较出处之前，把模式无效的伴随文件归为 `invalid`。公开报告的状态遵循[新鲜度与摘要](/ambercast/zh-cn/spec/freshness/#freshness-consequences)中定义的仓库策略映射 (`src/usecases/check-grounding.ts:50`)。

## 匹配 {#matching}

指纹不匹配必须 (MUST) 按未命中处理，不得把它当作旧元素可以安全回放的证据。这遵循已实现的版本门禁和不匹配失效机制 (`src/core/ir/schema.ts:320`) (`src/core/ir/fingerprint.ts:436`)。

`hit`、`fingerprint-mismatch`、`element-not-found`、`ambiguous-match` 和 `snapshot-invalid` 是互不相同的解析结果。树缺失或格式错误时为 `element-not-found`；归一化后的 role 和 name 匹配多个节点时为 `ambiguous-match`；哈希过旧或不同时为 `fingerprint-mismatch` (`src/core/ir/fingerprint.ts:348`) (`src/core/ir/fingerprint.ts:436`)。未配对的代理项在生成时不产生指纹，在解析时产生 `element-not-found` (`src/core/ir/fingerprint.ts:57-59`) (`src/core/ir/fingerprint.ts:251-253`)。

名称为空的引用只匹配规范化后名称为空的节点。

## 引用匹配 {#quote-matching}

`matchQuotedCandidates(tree, {text, roleHint?})` 按指纹匹配的顺序，从合成根节点的子节点开始，对无障碍树做一次线性遍历。它对字面查询文本和节点名称都应用 `normalizeName` (NFC 规范化、连续空白折叠、首尾空白去除)，精确比较可选的 role 提示，且从不插值形如 `{{run.x}}` 的字符串。它返回有序的 `{role, name}` 对；树无效时返回 `{kind: 'snapshot-invalid'}` (`src/core/ir/fingerprint.ts:106-108`) (`src/core/ir/fingerprint.ts:125-172`)。

该原语用于首次绑定时基于字面引用的轮询，也用于对 AI 提议的本地验证，以及元素断言在不依赖定位缓存时的求值，详见[步骤](/ambercast/zh-cn/spec/steps/#step-union)。

## 设计理由 {#rationale}

要解决的问题是，在不允许陈旧的定位器对外观相似的元素回放的前提下，检测局部 UI 漂移。有界邻域让这一证据变得明确。

所选设计在稳定的文本规范化之后，对目标、父节点和紧邻的兄弟节点做哈希。它把未命中和匹配明确区分开，不允许启发式复用。

被否决的备选方案之一是整树哈希，因为无关的变更会造成过多未命中。另一个是由选择器派生的标识，因为选择器属于实现细节，不是需要保留的意图证据。

v1 解析器无法对无障碍证据做故障关闭式扫描。版本 2 更改了算法标签，所以 v1 指纹不会被解释为 v2 证据。其运行结果遵循[元素指纹](/ambercast/zh-cn/spec/fingerprint/#digest)中关于当前出处和覆盖声明的规则，而不是无条件回退到重新解析 (`CHANGELOG.md:257`) (`src/usecases/run.ts:773-851`)。
