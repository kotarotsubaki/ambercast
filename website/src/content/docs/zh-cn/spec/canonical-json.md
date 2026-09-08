---
title: "规范 JSON"
description: "摘要输入必须（MUST）使用以 UTF-8 编码且不含标记间空白的紧凑 RFC 8785 兼容 JSON。"
---

## 摘要形式 {#digest-form}

摘要输入必须（MUST）使用以 UTF-8 编码且不含标记间空白的紧凑 RFC 8785 兼容 JSON。[src/core/ir/canonical-json.ts:172](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/canonical-json.ts#L172) 对象键必须（MUST）按 UTF-16 顺序排序。[src/core/ir/canonical-json.ts:147](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/canonical-json.ts#L147) 非有限数值与未配对的 UTF-16 代理项必须（MUST）被拒绝。[src/core/ir/canonical-json.ts:9](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/canonical-json.ts#L9) [src/core/ir/canonical-json.ts:20](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/canonical-json.ts#L20)

JCS 的应用是递归的：字符串在拒绝未配对代理项后进行 JSON 转义；有限数值使用 ECMAScript 数值渲染；布尔值为 `true`/`false`；null 为 `null`；数组保留顺序；对象对键进行排序；undefined、bigint、function、symbol 以及非普通对象均被拒绝。[src/core/ir/canonical-json.ts:55](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/canonical-json.ts#L55), [src/core/ir/canonical-json.ts:92](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/canonical-json.ts#L92), [src/core/ir/canonical-json.ts:112](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/canonical-json.ts#L112), [src/core/ir/canonical-json.ts:130](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/canonical-json.ts#L130) 该紧凑文本的 UTF-8 字节，而非 JavaScript 对象标识或美化文本，才是摘要原像。[src/core/ir/canonical-json.ts:172](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/canonical-json.ts#L172)

## 工件形式 {#artifact-form}

已提交的工件必须（MUST）使用规范工件形式：采用与摘要形式相同的键排序及标量渲染、两空格缩进，以及末尾换行符。[src/core/ir/canonical-json.ts:186](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/canonical-json.ts#L186) 生成者不得（MUST NOT）使用美化 JSON 字节作为摘要原像。[src/core/ir/canonical-json.ts:23](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/canonical-json.ts#L23)

## 持久化 {#persistence}

存储写入必须（MUST）具备原子可见性：读取者看到的是完整的旧文件或完整的新文件，绝不会看到部分写入。[src/ports/storage.ts:89](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/ports/storage.ts#L89) 若在写入中断后列出保留的 `.ambercast-tmp-` 暂存名称，调用方必须（MUST）予以忽略。[src/ports/storage.ts:56](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/ports/storage.ts#L56)

原子写入器可以（MAY）使用文件系统适配器所采用的保留临时前缀与重命名策略，但该暂存机制并不是可移植的一致性要求。每个 `StorageAdapter.writeText` 实现都必须（MUST）提供上述原子可见性契约。[src/ports/storage.ts:56](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/ports/storage.ts#L56), [src/ports/storage.ts:89](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/ports/storage.ts#L89) 磁盘存储形式采用两空格缩进，排序并使用与摘要形式相同的标量渲染，且以单个换行符结尾。[src/core/ir/canonical-json.ts:186](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/canonical-json.ts#L186)

## 设计理由 {#rationale}

面临的问题在于使哈希独立于附带的 JSON 格式，同时保留人类可审查的工件。

所选的单一值遍历器同时具有紧凑摘要与美化工件输出，因此两者的排序与标量语义不会发生漂移。

一个被否决的备选方案曾使用美化字节进行哈希；它被否决是因为空白字符会因此带上语义。另一个备选方案将排序委托给各个调用方；它被否决是因为等价的值随后会产生不可重复的摘要。
