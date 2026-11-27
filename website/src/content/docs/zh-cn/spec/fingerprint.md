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

## 组成部分 {#components}

可选的 `components` 记录使用 `a11y-components-v1`，与完整指纹来自同一个规范化描述符。各哈希按[规范 JSON](/ambercast/zh-cn/spec/canonical-json/#digest-form) 生成规范 UTF-8 JSON，再计算 SHA-256 并编码为小写十六进制 (`src/core/ir/fingerprint.ts:74-94`)。

| 字段 | 规范 JSON 原像 |
| --- | --- |
| `structure` | `{ role, name, parentRole, siblingBeforeRole, siblingAfterRole }` |
| `parentName` | `{ slot: "parent", name }` |
| `siblingBeforeName` | `{ slot: "siblingBefore", name }` |
| `siblingAfterName` | `{ slot: "siblingAfter", name }` |

在 `structure` 中，`name` 是目标的规范化名称。`role`、`parentRole`、`siblingBeforeRole` 和 `siblingAfterRole` 保留精确角色。不存在兄弟节点时，对应角色为 `null`。

各槽位原像的 `name` 是对应邻近节点的规范化名称。不存在兄弟节点时，不构造原像，而将名称哈希设为 `null`。

对于顶层目标，`parentName` 对合成根节点的空名称计算哈希，因此该哈希保持稳定。

生成时先检查描述符的所有角色和名称是否受到密钥污染，再产生指纹和组成部分。如果存在污染，两者都不产生。存在未配对的代理项时也不产生两者。

匹配验证和操作前复核沿用现有检查，不增加密钥污染拒绝条件 (`src/core/ir/fingerprint.ts:343-448`)。

没有 `ignoredNames` 时，匹配必须比较完整指纹 (MUST)。有此字段时，必须比较 `structure` 和未忽略槽位的名称哈希 (MUST)。三个槽位全部忽略时，只比较 `structure`。

操作前，ambercast 仍比较本次回放确定目标时的完整指纹。即使是忽略的文字，在确定目标后发生变化也会阻止操作。

## 摘要 {#digest}

实现必须 (MUST) 使用[规范 JSON](/ambercast/zh-cn/spec/canonical-json/#digest-form) 序列化描述符，并对其计算 SHA-256 (`src/core/ir/fingerprint.ts:6`) (`src/core/ir/digest.ts:35`)。

非 v2 标签无法通过严格的定位缓存模式校验 (`src/core/ir/schema.ts:319-322`)。

在 `run` 中，声明了 `trace.verificationCoverage` 的当前出处原始定位缓存文档，会把随后的严格校验或规范校验失败变成完整性失败。没有该声明时，不可用的伴随文件按缓存未命中处理 (`src/usecases/run.ts:773-851`)。

在 `check` 中，定位缓存检查会在比较出处之前，把模式无效的伴随文件归为 `invalid`。公开报告的状态遵循[新鲜度与摘要](/ambercast/zh-cn/spec/freshness/#freshness-consequences)中定义的仓库策略映射 (`src/usecases/check-grounding.ts:50`)。

## 匹配 {#matching}

指纹不匹配必须视为未命中 (MUST)，但已保存的 `ignoredNames` 允许按上述成分规则匹配时除外。目标仍须由角色和规范化名称唯一确定，空名称也遵循此规则。

有已保存的成分时，`structure` 不同表示差异类型为 `structure`。结构相同而未忽略的名称哈希不同，表示 `neighbor-names`。变化的槽位按 `parent`、`siblingBefore`、`siblingAfter` 的固定顺序列出。

没有成分时，省略差异类型。严格记录项的完整指纹不同但成分全部相同时，也省略差异类型和槽位。这种不一致的记录仍为未命中；ambercast 不会修复成分或放宽匹配。

只有允许 resolve 且意图一致的已保存记录项发生指纹不匹配时，才可能添加忽略槽位。重新确定的角色、规范化名称和结构必须与已保存的记录一致。ambercast 按重新确定目标时的名称哈希计算变化，并将槽位加入原列表，消除重复。

没有名称变化时，保留原列表。不满足条件时，重新生成不含忽略槽位的严格记录项。不允许 resolve 的回放可以使用已保存的忽略槽位，但不会添加槽位。

确认目标或用例全部通过后，ambercast 按写回权限保存新记录项。已命中的记录项保持不变。只有重建严格记录项才能减少忽略槽位。

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
