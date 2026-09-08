---
title: 提示词文件格式
description: 说明 ambercast 0.3.1 中提示词文件所强制执行的文件标识、文本规范化、机密授权及引用语法规范。
---

ambercast 0.3.1 在处理提示词文件时，强制执行明确的源文件契约与文本规范化流水线。作为测试计划的输入基准，提示词文件必须遵循确定的命名约束、严格的代码块隔离规则以及结构化的机密引用语法。

## 文件标识 {#file-identity}

提示词文件的识别依赖于布局解析器约定的确切后缀契约：

| 条件 | 强制执行结果 |
| --- | --- |
| 路径位于 `testDir` 内，以 `.test.md` 结尾，且后缀前包含非空名称 | 布局解析器可以推导出 plan、grounding 与 case 路径 |
| 路径位于 `testDir` 外部、具有其他后缀，或是纯文件名 `.test.md` | 正向布局解析拒绝该路径并抛出 `RangeError` |

哪些路径会被纳入发现范围由 `testMatch` 与 `testIgnore` 控制；`.test.md` 是解析器的确切源文件后缀契约，并非通用的 Markdown 解析规则。

## 规范化与授权声明 {#normalization-and-grants}

在进入解析与授权提取之前，源文件必须通过确定的规范化处理：

| 操作 | 精确规则 |
| --- | --- |
| 前导 BOM | 最多移除一个前导 U+FEFF；保留第二个前导 U+FEFF 以及出现在其他任何位置的 U+FEFF。 |
| 行尾换行符 | 将每个 CRLF 和单独的 CR 转换为一个 LF。 |
| 其余所有内容 | 完整保留：不执行修剪（trimming）、空白折叠、重新排序、重新措辞或任何其他转换。 |

授权提取（grant extraction）接收规范化后的 Markdown，并按源码顺序返回机密授权声明。当候选行的物理源码范围与 CommonMark 的围栏代码块（fenced-code）、缩进代码块（indented-code）或行内代码（inline-code）节点重叠时，该候选行会被排除。

每个返回的授权均保留原始行文本、基于零的 UTF-16 起始/开区间结束偏移量，以及基于 1 的物理行号。授权行由以下正则表达式逐字匹配：

```ts
new RegExp(`^[ \\t]*@ambercast-secret[ \\t]+(${SECRET_REF_SOURCE})[ \\t]*$`)
```

其中指令行必须以 `@ambercast-secret` 明确声明。

## 机密引用 {#secret-references}

机密引用语法在模式层面受以下确切实现约束：

| 符号 | 原生实现 | 含义 |
| --- | --- | --- |
| `SECRET_REF_SOURCE` | `\\{\\{secrets\\.[A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)*\\}\\}` | `secrets.` 之后由一个或多个以点分隔的 ASCII 字母数字/下划线分段组成。 |
| `SECRET_REF_PATTERN` | `new RegExp(\`^${SECRET_REF_SOURCE}$\`)` | 承载机密的模式字段仅接受该引用作为其完整值。 |

合法的机密引用形如 `{{secrets.name}}`。`SecretRef` 不接受外围文字（surrounding prose）；通过 `SECRET_REF_PATTERN` 的全值锚定，确保承载机密的字段始终明确无歧义。

## 明文机密拒绝 {#literal-secret-rejection}

提示词格式在生成计划阶段对明文机密执行严格的拒绝机制，规范的检测器契约详见 [计划中的机密](/ambercast/zh-cn/spec/secrets/#literal-secret-rejection)。

在持久化或报告序列化之前，生成器/提供商派生的 JSON 会经受明文机密策略（literal-secret policy）检查；一旦检测到匹配值，将产生 `SecretLiteralRejectedError`，且诊断信息中不会保留该明文字面量。该生成计划策略不会仅仅因为提示词的任意正文中包含类似凭据的文本而将其拒绝。

相关链接：
- [发现模式](/ambercast/zh-cn/reference/discovery-patterns/#selection)
- [环境变量](/ambercast/zh-cn/reference/environment-variables/#secrets)
- [编写高效的 Prompt](/ambercast/zh-cn/how-to/write-effective-prompts/)
- [管理机密](/ambercast/zh-cn/how-to/manage-secrets/)
- [计划中的机密](/ambercast/zh-cn/spec/secrets/)
