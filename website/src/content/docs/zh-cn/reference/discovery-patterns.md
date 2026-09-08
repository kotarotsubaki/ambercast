---
title: 发现模式
description: 定义 ambercast 测试发现中的配置匹配规则与路径排序约定。
---

本文档定义 ambercast 中通过配置进行测试发现的匹配与排序规则。发现匹配器使用专用的模式语言，仅包含两种通配符标记，并在路径边界进行完整锚定。

## 模式语言 {#pattern-language}

| 语法 | 精确含义 |
| --- | --- |
| `*` | 单个路径段内除 `/` 之外的零个或多个字符（`[^/]*`）。 |
| `**/` | 零个或多个完整路径段，包含空路径段（`(?:.*/)?`）。 |
| 后面不接 `/` 的 `**` | 零个或多个任意字符，包含 `/`（`.*`）。 |
| 其他字符 | 字面文本；正则表达式元字符均被转义。字符类、大括号、extglob 以及其他通用 glob 语法均无特殊含义。 |
| 整个模式 | 匹配使用 `^` 和 `$` 进行边界锚定；子字符串不计入匹配。 |

实现中的语法仅包含 `*` 和 `**` 这两个通配符标记；其余所有字符均为字面文本。

## 选择机制 {#selection}

| 阶段 | 约定 |
| --- | --- |
| 包含 | 路径必须至少匹配一个 `testMatch` 模式。空的 `testMatch` 不选择任何内容。 |
| 排除 | 匹配任何 `testIgnore` 的路径均会被排除，即使其同时匹配了 `testMatch`。 |
| 路径形式 | 匹配器接收相对于 `testDir` 的 `/` 分隔 POSIX 路径，从不接收绝对路径。 |
| 排序 | 发现流程会跳过非文件条目，对选中的路径进行去重，并返回字典序排序结果。 |
| 根目录缺失 | `testDir` 缺失时返回空的选择结果；其他目录读取失败会转化为 `FsIoError`。 |

选定路径的排序是提供给下游使用场景的稳定执行顺序。

## 默认配置 {#defaults}

| 配置项 | 默认模式 |
| --- | --- |
| `testMatch` | `["**/*.test.md"]` |
| `testIgnore` | `["**/.runs/**", "**/*.ambercast.plan.json", "**/*.ambercast.grounding.json"]` |

默认配置首先包含 `.test.md` 提示词，随后排除运行目录以及两种伴生文件后缀。

## 示例解析 {#worked-examples}

| 模式 / 配置 | 候选路径 | 结果 | 原因 |
| --- | --- | --- | --- |
| `**/*.test.md` | `login.test.md` | 匹配 | `**/` 可跨越零个路径段。 |
| `**/*.test.md` | `nested/checkout.test.md` | 匹配 | `**/` 跨越父级路径段。 |
| `ui/*.test.md` | `ui/auth/login.test.md` | 不匹配 | `*` 无法跨越 `/`。 |
| `login.test.md` | `login.test.md.bak` | 不匹配 | 必须完整匹配整个路径。 |
| 包含 `**/*.test.md`；忽略 `**/.runs/**` | `nested/.runs/cached.test.md` | 不匹配 | 在包含之后，`testIgnore` 生效并予以排除。 |
| `{login,nested}/*.test.md` | `login/login.test.md` | 不匹配 | 大括号被视为字面量，不表示交替匹配。 |

相关链接：[配置](/ambercast/zh-cn/reference/configuration/#key-table)、[文件布局](/ambercast/zh-cn/reference/file-layout/#companions)、[选择要运行的测试](/ambercast/zh-cn/how-to/select-tests/)。
