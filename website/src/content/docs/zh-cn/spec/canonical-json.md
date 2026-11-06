---
title: "规范 JSON"
description: "本章定义紧凑的摘要形式、带缩进的产物形式，以及存储写入的原子可见性约定。"
---

## 摘要形式 {#digest-form}

摘要输入必须 (MUST) 使用紧凑的、兼容 RFC 8785 的 JSON，以 UTF-8 编码，且标记之间不含空白 (`src/core/ir/canonical-json.ts:173-182`)。对象键必须 (MUST) 按 UTF-16 顺序排序 (`src/core/ir/canonical-json.ts:153`)。非有限数和未配对的 UTF-16 代理项必须 (MUST) 被拒绝 (`src/core/ir/canonical-json.ts:100-101`) (`src/core/ir/canonical-json.ts:20`)。

JCS 以递归方式应用 (`src/core/ir/canonical-json.ts:91-128`) (`src/core/ir/canonical-json.ts:130-145`) (`src/core/ir/canonical-json.ts:147-170`)。

- 字符串先拒绝未配对的代理项，再做 JSON 转义。
- 有限数使用 ECMAScript 的数字表示。
- 布尔值写作 `true` 或 `false`，null 写作 `null`。
- 数组保持顺序。
- 对象的键要排序。
- undefined、bigint、function、symbol 和非普通对象会被拒绝。

摘要的原像是该紧凑文本的 UTF-8 字节，而不是 JavaScript 对象的标识或格式化后的文本 (`src/core/ir/canonical-json.ts:181-182`)。

## 产物形式 {#artifact-form}

已提交的产物必须 (MUST) 使用规范的产物形式。该形式的键顺序和标量表示与摘要形式相同，缩进为两个空格，末尾有一个换行 (`src/core/ir/canonical-json.ts:190-196`)。生产方不得 (MUST NOT) 把格式化后的 JSON 字节用作摘要原像 (`src/core/ir/canonical-json.ts:23`)。

## 持久化 {#persistence}

存储写入必须 (MUST) 具有原子可见性。读取方看到的要么是完整的旧文件，要么是完整的新文件，不会看到写了一半的内容 (`src/ports/storage.ts:178-182`)。中断的写入之后，如果列出了预留的 `.ambercast-tmp-` 暂存名，调用方必须 (MUST) 忽略它们 (`src/ports/storage.ts:111-114`)。

原子写入方可以 (MAY) 使用文件系统适配器所用的预留临时前缀和重命名策略。但这种暂存机制不是可移植的符合性要求。每个 `StorageAdapter.writeText` 实现都必须 (MUST) 提供上述原子可见性约定 (`src/ports/storage.ts:111-114`) (`src/ports/storage.ts:178-182`)。磁盘上的形式使用两个空格缩进，键顺序和标量表示与摘要形式相同，并以一个换行结尾 (`src/core/ir/canonical-json.ts:190-196`)。

## 设计依据 {#rationale}

问题在于让哈希不受偶然的 JSON 格式影响，同时保留人可以审阅的产物。

所选方案用同一个取值遍历器，输出紧凑的摘要和格式化的产物。因此两者的顺序和标量语义不会漂移。

被否决的方案有两个。一个用格式化后的字节计算哈希，因为空白会因此带上语义，所以被否决。另一个把排序交给每个调用方，因为等价的值会得到不可重复的摘要，所以被否决。
