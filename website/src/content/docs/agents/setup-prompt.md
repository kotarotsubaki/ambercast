---
title: Setup prompt
description: Complete copy-pasteable operating prompt providing a thin, review-first boundary for an agent working on a requested test.
---

This page provides the complete copy-pasteable operating prompt that establishes a thin, review-first boundary for an agent working on a requested test.

## Copy-paste prompt {#copy-paste-prompt}

The prompt defines the following operational rules:

1. Provider resolution uses an explicit override when present, otherwise the configured provider, and in auto mode probes claude before codex.
2. `check` can inspect artifacts without AI or browser capabilities.
3. The default for this prompt is presenting a diff; commits require a request.
4. The setup prompt states the dev-server boundary.
5. With no file arguments, `generate`, `run`, and `heal` each select tests through configured discovery rules.

~~~
You are working on ambercast tests in this repository.
First read https://kotarotsubaki.github.io/ambercast/tutorials/quick-start/. If the operator has not confirmed the application is running at the configured target base URL, ask for that confirmation before continuing. Then read https://kotarotsubaki.github.io/ambercast/agents/operating-contract/, https://kotarotsubaki.github.io/ambercast/agents/reading-structured-output/, and the relevant Reference page.
Work only on the requested .test.md prompt and its adjacent ambercast plan/grounding artifacts. Do not alter unrelated files.
Assume the project's dev server is already running at the configured target base URL. Do not start, stop, or reconfigure it unless explicitly asked.
Run check before treating existing artifacts as trustworthy. Use the documented provider configuration or invocation contract if an operation needs AI; fully grounded replay may not need a provider.
Treat generate, run, and heal as potentially side-effecting. Invoke `npx ambercast generate <requested.test.md>`, `npx ambercast run <requested.test.md>`, and `npx ambercast heal <requested.test.md>` only with the requested explicit `.test.md` path; use `npx ambercast check <requested.test.md>` with that same path. Before any unapproved artifact change, report the planned write scope. For heal, require explicit user approval; --yes only answers ambercast's confirmation prompt.
The no-argument forms of generate, run, and heal operate on all discovered tests that match the configured discovery rules. Use a no-argument form only when the operator explicitly requests that all-discovered-tests scope, and restate that scope before executing it.
Never place literal secrets in prompts, artifacts, commands, reports, or messages. Never run a real heal in CI unless the user has explicitly authorized the required configuration and action.
When finished, present the complete diff and the command/report result. Do not commit unless explicitly asked.
~~~

Links: [Your first test in 5 minutes](/ambercast/tutorials/quick-start/), [Operating contract](/ambercast/agents/operating-contract/), [Environment variables](/ambercast/reference/environment-variables/)
