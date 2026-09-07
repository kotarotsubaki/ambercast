---
title: 设置提示词
description: 为处理指定测试的 AI Agent 提供轻量、以审查为先的完整可复制运行提示词。
---

本页提供了一套可直接复制的完整运行提示词，旨在为处理指定测试的 Agent 建立轻量且以审查为先的工作边界。

## 可复制的提示词 {#copy-paste-prompt}

本提示词遵循以下明确的契约与行为规则：

- **声明开发服务器边界**：设置提示词明确声明了开发服务器的边界。
- **无依赖工件检查**：`check` 可以在无需 AI 或浏览器能力的情况下检查工件。
- **Diff 优先与提交限制**：提示词将展示 diff 设定为默认行为；提交代码必须经过请求。
- **未传参发现规则**：在未提供文件参数时，`generate`、`run` 和 `heal` 会各自根据配置好的发现规则来选择测试。
- **提供商解析机制**：提供商解析在存在显式覆盖时使用该覆盖，否则使用配置的提供商；在 `auto` 模式下，会先探测 claude 再探测 codex。

您可以将以下提示词完整复制并提供给 Agent：

~~~
You are working on ambercast tests in this repository.
First read https://kotarotsubaki.github.io/ambercast/zh-cn/tutorials/quick-start/. If the operator has not confirmed the application is running at the configured target base URL, ask for that confirmation before continuing. Then read https://kotarotsubaki.github.io/ambercast/zh-cn/agents/operating-contract/, https://kotarotsubaki.github.io/ambercast/zh-cn/agents/reading-structured-output/, and the relevant Reference page.
Work only on the requested .test.md prompt and its adjacent ambercast plan/grounding artifacts. Do not alter unrelated files.
Assume the project's dev server is already running at the configured target base URL. Do not start, stop, or reconfigure it unless explicitly asked.
Run check before treating existing artifacts as trustworthy. Use the documented provider configuration or invocation contract if an operation needs AI; fully grounded replay may not need a provider.
Treat generate, run, and heal as potentially side-effecting. Invoke `npx ambercast generate <requested.test.md>`, `npx ambercast run <requested.test.md>`, and `npx ambercast heal <requested.test.md>` only with the requested explicit `.test.md` path; use `npx ambercast check <requested.test.md>` with that same path. Before any unapproved artifact change, report the planned write scope. For heal, require explicit user approval; --yes only answers ambercast's confirmation prompt.
The no-argument forms of generate, run, and heal operate on all discovered tests that match the configured discovery rules. Use a no-argument form only when the operator explicitly requests that all-discovered-tests scope, and restate that scope before executing it.
Never place literal secrets in prompts, artifacts, commands, reports, or messages. Never run a real heal in CI unless the user has explicitly authorized the required configuration and action.
When finished, present the complete diff and the command/report result. Do not commit unless explicitly asked.
~~~

相关链接：[5 分钟完成您的首个测试](/ambercast/zh-cn/tutorials/quick-start/)、[操作契约](/ambercast/zh-cn/agents/operating-contract/)、[环境变量](/ambercast/zh-cn/reference/environment-variables/)
