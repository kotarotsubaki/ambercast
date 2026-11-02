---
title: 发现模式
description: 决定 ambercast 发现哪些测试提示词的模式语法、选择阶段、默认值和排序。
---

ambercast 用 `testMatch` 和 `testIgnore` 的模式匹配相对于 `testDir` 的路径。模式语言只有 `*` 和 `**` 两个通配符。

## 模式语言 {#pattern-language}

语法只包含下面的通配符。其他字符一律按字面处理。

| 语法 | 含义 |
| --- | --- |
| `*` | 在一个路径段内，匹配零个或多个 `/` 以外的字符（`[^/]*`）。 |
| `**/` | 匹配零个或多个完整的路径段，可以一个也没有（`(?:.*/)?`）。 |
| 后面不带 `/` 的 `**` | 匹配零个或多个任意字符，包括 `/`（`.*`）。 |
| 其他所有字符 | 按字面处理。字符类、花括号、extglob 等 glob 语法没有特殊含义。 |
| 整个模式 | 两端锚定。只匹配子串不算匹配。 |

## 选择 {#selection}

| 阶段 | 规则 |
| --- | --- |
| 包含 | 路径必须匹配至少一个 `testMatch` 模式。`testMatch` 为空时什么也不选。 |
| 排除 | 匹配任一 `testIgnore` 模式的路径会被排除，即使它也匹配 `testMatch`。 |
| 路径形式 | 匹配器收到的是相对于 `testDir`、以 `/` 分隔的 POSIX 路径，不会收到绝对路径。 |
| 顺序 | 发现过程会跳过非文件、去除重复项，并按字典序排序。 |
| 缺失的根目录 | `testDir` 不存在时，选择为空。其他读取失败会变成 `FsIoError`，并报告为 `FS_IO_ERROR`。 |

排序后的顺序就是各命令使用的稳定执行顺序。

如果想让某个提示词不参与常规发现，又能单独运行，就用 `testIgnore` 排除它，再传入它的字面路径。`--list` 不会对任何选择做资格校验。

## 默认值 {#defaults}

默认情况下，ambercast 包含 `.test.md` 提示词，并排除运行目录和两种配套文件的后缀。

| 键 | 默认模式 |
| --- | --- |
| `testMatch` | `["**/*.test.md"]` |
| `testIgnore` | `["**/.runs/**", "**/*.ambercast.plan.json", "**/*.ambercast.grounding.json"]` |

## 示例 {#worked-examples}

| 模式或配置 | 候选路径 | 结果 | 原因 |
| --- | --- | --- | --- |
| `**/*.test.md` | `login.test.md` | 匹配 | `**/` 可以跨越零个路径段。 |
| `**/*.test.md` | `nested/checkout.test.md` | 匹配 | `**/` 跨越了父级路径段。 |
| `ui/*.test.md` | `ui/auth/login.test.md` | 不匹配 | `*` 不能跨越 `/`。 |
| `login.test.md` | `login.test.md.bak` | 不匹配 | 整个路径都必须匹配。 |
| 包含 `**/*.test.md`，忽略 `**/.runs/**` | `nested/.runs/cached.test.md` | 不匹配 | 包含之后，`testIgnore` 优先。 |
| `{login,nested}/*.test.md` | `login/login.test.md` | 不匹配 | 花括号按字面处理，不是备选展开。 |

## 另请参阅 {#see-also}

- [配置](/ambercast/zh-cn/reference/configuration/#key-table)
- [文件布局](/ambercast/zh-cn/reference/file-layout/#companions)
- [选择要运行的测试](/ambercast/zh-cn/how-to/select-tests/)
