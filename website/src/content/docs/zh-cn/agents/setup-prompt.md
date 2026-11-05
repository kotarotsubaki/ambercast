---
title: 设置提示词
description: 一段可以贴给编码 Agent 的提示词，让它只处理所要求的测试、展示差异，并在没有被要求的写入前先征求同意。
---

把这段提示词交给 Agent，它就知道要读什么、做到哪一步、按什么顺序工作。请按原样以英文粘贴。

## 可复制的提示词 {#copy-paste-prompt}

提示词设定了五条规则。

1. AI 提供方先取显式指定的值，再取配置的提供方。在 `auto` 模式下，先尝试 `claude`，再尝试 `codex`。
2. `check` 不使用 AI 和浏览器，只检查产物。
3. 默认只展示差异，只有被要求时才提交。
4. 开发服务器归操作者所有。Agent 假定应用已在配置的基础 URL 上运行，除非操作者明确要求，否则不启动、不停止也不重新配置它。
5. 不带文件参数时，`generate`、`run` 和 `heal` 会选中配置的发现规则匹配的全部测试。

~~~markdown
You are working on ambercast tests in this repository.
First read https://kotarotsubaki.github.io/ambercast/zh-cn/tutorials/quick-start/. If the operator has not confirmed the application is running at the configured target base URL, ask for that confirmation before continuing. Then read https://kotarotsubaki.github.io/ambercast/zh-cn/agents/operating-contract/, https://kotarotsubaki.github.io/ambercast/zh-cn/agents/reading-structured-output/, and the relevant Reference page.
Work only on the requested .test.md prompt and its adjacent ambercast plan/grounding artifacts. Do not alter unrelated files.
Assume the project's dev server is already running at the configured target base URL. Do not start, stop, or reconfigure it unless explicitly asked.
Run check before treating existing artifacts as trustworthy. Use the documented provider configuration or invocation contract if an operation needs AI; fully grounded replay may not need a provider.
Treat generate, run, and heal as potentially side-effecting. Invoke `npx ambercast generate <requested.test.md>`, `npx ambercast run <requested.test.md>`, and `npx ambercast heal <requested.test.md>` only with the requested explicit `.test.md` path; use `npx ambercast check <requested.test.md>` with that same path. Before any unapproved artifact change, report the planned write scope. For heal, require explicit user approval; --yes only answers ambercast's confirmation prompt.
The no-argument forms of generate, run, and heal operate on all discovered tests that match the configured discovery rules. Use a no-argument form only when the operator explicitly requests that all-discovered-tests scope, and restate that scope before executing it.
Never place literal secret values in prompts, artifacts, commands, reports, or messages. Never write secret references or legacy `@ambercast-secret` grant lines in `.test.md` prompt text; a committed Plan or Grounding artifact may correctly contain a valid `secretRef` after local resolution and consent. When generate proposes a secret name outside `secrets.allow`, obtain the operator's approval interactively or ask them to add a reviewed name to `secrets.allow`; never use `"*"` without explicit operator approval. Never run a real heal in CI unless the user has explicitly authorized the required configuration and action.
When finished, present the complete diff and the command/report result. Do not commit unless explicitly asked.
~~~

相关链接：[5 分钟内完成第一个测试](/ambercast/zh-cn/tutorials/quick-start/)、[操作契约](/ambercast/zh-cn/agents/operating-contract/)、[环境变量](/ambercast/zh-cn/reference/environment-variables/)
