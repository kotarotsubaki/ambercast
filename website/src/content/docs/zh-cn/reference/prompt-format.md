---
title: 提示词文件格式
description: 说明 ambercast 测试提示词文件的精确文件标识、规范化规则和机密引用语法。
---

Ambercast 测试提示词以自然语言定义端到端测试用例。本参考说明布局解析器和解析器所强制执行的精确文件标识规则、源规范化转换与机密引用模式。

## 文件标识 {#file-identity}

提示词文件的识别依赖于布局解析器约定的确切后缀契约：

| 条件 | 强制执行结果 |
| --- | --- |
| 路径位于 `testDir` 内，以 `.test.md` 结尾，且后缀前包含非空名称 | 布局解析器可以推导出 plan、grounding 与 case 路径 |
| 路径位于 `testDir` 外部、具有其他后缀，或是纯文件名 `.test.md` | 正向布局解析拒绝该路径并抛出 `RangeError` |

哪些路径会被纳入发现范围由 `testMatch` 与 `testIgnore` 控制；`.test.md` 是解析器的确切源文件后缀契约，并非通用的 Markdown 解析规则。

## 规范化 {#normalization}

提取前，测试提示词源会经过严格的规范化：

| 操作 | 精确规则 |
| --- | --- |
| 前导 BOM | 最多移除一个前导 U+FEFF；保留第二个前导 U+FEFF 以及出现在其他任何位置的 U+FEFF。 |
| 行尾换行符 | 将每个 CRLF 和单独的 CR 转换为一个 LF。 |
| 其余所有内容 | 完整保留：不执行修剪（trimming）、空白折叠、重新排序、重新措辞或任何其他转换。 |

## 机密引用 {#secret-references}

`SecretRef` 是在同意拟议的机密名称后，由 `generate` 写入已提交 Plan 的 `secretRef` 字段的语法；人类绝不会在提示词本身中写入此语法（参见下文的[旧版机密语法](#legacy-secret-syntax)——包含此语法的提示词会被拒绝）。

机密引用用于识别模式字段中的凭据槽位：

| 符号 | 原生实现 | 含义 |
| --- | --- | --- |
| `SECRET_REF_SOURCE` | `\\{\\{secrets\\.[A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)*\\}\\}` | `secrets.` 之后由一个或多个以点分隔的 ASCII 字母数字/下划线分段组成。 |
| `SECRET_REF_PATTERN` | `new RegExp(\`^${SECRET_REF_SOURCE}$\`)` | 承载机密的模式字段仅接受该引用作为其完整值。 |

合法的机密引用形如 `{{secrets.name}}`。`SecretRef` 不接受外围文字（surrounding prose）；通过 `SECRET_REF_PATTERN` 的全值锚定，确保承载机密的字段始终明确无歧义。

## 旧版机密语法 {#legacy-secret-syntax}

旧版提示词可能包含如下授权行：

```markdown
@ambercast-secret {{secrets.password}}
```

此语法不再被接受。请删除每一行此类语法，然后遵循[迁移机密授权](/ambercast/zh-cn/how-to/upgrade/#migrate-secret-grants)；有关当前的同意和许可列表模型，请参阅[计划中的机密](/ambercast/zh-cn/spec/secrets/)。

## 终端断言与指令覆盖 {#terminal-assertions-and-instruction-coverage}

每个终端成功断言都必须由其指令覆盖。仅到达 URL 不是终端证明；请描述在目标页面可见的标题、消息或元素。

> …I reach the dashboard and see the heading "Welcome back".

## 明文机密拒绝 {#literal-secret-rejection}

提示词格式在生成计划阶段对明文机密执行严格的拒绝机制，规范的检测器契约详见 [计划中的机密](/ambercast/zh-cn/spec/secrets/#literal-secret-rejection)。

在持久化或报告序列化之前，生成器/提供商派生的 JSON 会经受明文机密策略（literal-secret policy）检查；一旦检测到匹配值，将产生 `SecretLiteralRejectedError`，且诊断信息中不会保留该明文字面量。该生成计划策略不会仅仅因为提示词的任意正文中包含类似凭据的文本而将其拒绝。

相关链接：
- [发现模式](/ambercast/zh-cn/reference/discovery-patterns/#selection)
- [环境变量](/ambercast/zh-cn/reference/environment-variables/#secrets)
- [编写高效的 Prompt](/ambercast/zh-cn/how-to/write-effective-prompts/)
- [管理机密](/ambercast/zh-cn/how-to/manage-secrets/)
- [计划中的机密](/ambercast/zh-cn/spec/secrets/)
