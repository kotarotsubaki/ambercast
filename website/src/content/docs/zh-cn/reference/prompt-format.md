---
title: 提示词文件格式
description: ambercast 把哪些文件当作测试提示词、如何规范化它们，以及如何处理机密引用。
---

测试提示词是一个 Markdown 文件，用自然语言描述一个端到端测试用例。

## 文件识别 {#file-identity}

| 条件 | 结果 |
| --- | --- |
| 路径位于 `testDir` 内，以 `.test.md` 结尾，且后缀前有非空的名称。 | 布局据此推导执行计划、定位缓存和用例的路径。 |
| 路径在 `testDir` 之外、后缀不同，或文件名只有 `.test.md`。 | 命令以 `PROMPT_PATH_INVALID`（退出码 2）停止。 |

该错误的 `details.reason` 为 `outside-test-dir`、`not-test-md` 或 `no-name`。`--list` 不做资格校验，因此不会产生这个错误。错误的契约见[报告](/ambercast/zh-cn/reference/reports/#errors)。

发现哪些文件由 `testMatch` 和 `testIgnore` 控制。后缀 `.test.md` 是布局要求的精确条件，不是通用的 Markdown 规则。模式的细节见[发现模式](/ambercast/zh-cn/reference/discovery-patterns/#selection)。

## 规范化 {#normalization}

ambercast 先规范化提示词，再从中提取内容。

| 操作 | 规则 |
| --- | --- |
| 开头的 BOM | 最多移除一个开头的 U+FEFF。第二个开头的 U+FEFF 和其他位置的 U+FEFF 都保留。 |
| 换行符 | 把每个 CRLF 和单独的 CR 转换为一个 LF。 |
| 其余所有内容 | 原样保留。ambercast 不裁剪、不合并空白、不重排，也不改写。 |

## 机密引用 {#secret-references}

你同意某个建议的机密名称后，`generate` 会把形如 `{{secrets.name}}` 的机密引用写入执行计划的 `secretRef` 字段。提示词中不能出现机密引用。代码片段和代码块之外含有 `{{secrets.` 的提示词，会以 `SECRET_SYNTAX_REJECTED` 被拒绝，见[旧版机密语法](#legacy-secret-syntax)。

| 符号 | 定义 | 含义 |
| --- | --- | --- |
| `SECRET_REF_SOURCE` | `\{\{secrets\.[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*\}\}` | `secrets.` 之后是一段或多段用点号分隔、由 ASCII 字母、数字和下划线组成的片段。 |
| `SECRET_REF_PATTERN` | 两端锚定的 `SECRET_REF_SOURCE` | 承载机密的字段只接受整个值恰好是一个引用的情况。 |

前后不能附带其他文字。有效的引用必须占满整个字段值。

## 旧版机密语法 {#legacy-secret-syntax}

早期的提示词可以包含这样的授权行：

```markdown
@ambercast-secret {{secrets.password}}
```

ambercast 不再接受这种语法。请删除所有这样的行，然后按[迁移机密授权](/ambercast/zh-cn/how-to/upgrade/#migrate-secret-grants)操作。当前的同意与允许列表机制见[执行计划中的机密](/ambercast/zh-cn/spec/secrets/)。

## 终点断言与指令覆盖 {#terminal-assertions-and-instruction-coverage}

每条终点成功断言都必须被对应的指令覆盖。仅仅到达某个 URL 不能算证明。请写出在目的页面上可见的标题、消息或元素。

> `…I reach the dashboard and see the heading "Welcome back".`

## 字面量机密的拒绝 {#literal-secret-rejection}

在持久化或序列化报告之前，ambercast 会按字面量机密策略检查生成的或来自提供方的 JSON。检测到的值会以 `SECRET_LITERAL_REJECTED` 被拒绝，字面量不会保留在诊断信息中。

该策略不会因为提示词文字看起来像凭据就拒绝提示词。检测器的契约见[执行计划中的机密](/ambercast/zh-cn/spec/secrets/#literal-secret-rejection)。

## 另请参阅 {#see-also}

- [发现模式](/ambercast/zh-cn/reference/discovery-patterns/#selection)
- [环境变量](/ambercast/zh-cn/reference/environment-variables/#secrets)
- [编写有效的提示词](/ambercast/zh-cn/how-to/write-effective-prompts/)
- [管理机密](/ambercast/zh-cn/how-to/manage-secrets/)
- [执行计划中的机密](/ambercast/zh-cn/spec/secrets/)
