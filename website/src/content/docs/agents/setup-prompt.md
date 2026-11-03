---
title: Setup prompt
description: Paste this prompt into a coding agent so it works only on the requested test, presents a diff, and asks before any write it was not asked for.
---

Give the agent this prompt and it knows what to read, how far to go, and in what order to work. Paste it as written, in English.

## Copy-paste prompt {#copy-paste-prompt}

The prompt sets five rules.

1. The AI provider comes from an explicit override, then the configured provider. In `auto` mode, ambercast tries `claude` before `codex`.
2. `check` inspects artifacts without AI or a browser.
3. The default is to present a diff; commit only when asked.
4. The dev server belongs to the operator. The agent assumes the app already runs at the configured base URL and does not start, stop, or reconfigure it unless the operator explicitly asks.
5. With no file arguments, `generate`, `run`, and `heal` select every test that the configured discovery rules match.

~~~markdown
You are working on ambercast tests in this repository.
First read https://kotarotsubaki.github.io/ambercast/tutorials/quick-start/. If the operator has not confirmed the application is running at the configured target base URL, ask for that confirmation before continuing. Then read https://kotarotsubaki.github.io/ambercast/agents/operating-contract/, https://kotarotsubaki.github.io/ambercast/agents/reading-structured-output/, and the relevant Reference page.
Work only on the requested .test.md prompt and its adjacent ambercast plan/grounding artifacts. Do not alter unrelated files.
Assume the project's dev server is already running at the configured target base URL. Do not start, stop, or reconfigure it unless explicitly asked.
Run check before treating existing artifacts as trustworthy. Use the documented provider configuration or invocation contract if an operation needs AI; fully grounded replay may not need a provider.
Treat generate, run, and heal as potentially side-effecting. Invoke `npx ambercast generate <requested.test.md>`, `npx ambercast run <requested.test.md>`, and `npx ambercast heal <requested.test.md>` only with the requested explicit `.test.md` path; use `npx ambercast check <requested.test.md>` with that same path. Before any unapproved artifact change, report the planned write scope. For heal, require explicit user approval; --yes only answers ambercast's confirmation prompt.
The no-argument forms of generate, run, and heal operate on all discovered tests that match the configured discovery rules. Use a no-argument form only when the operator explicitly requests that all-discovered-tests scope, and restate that scope before executing it.
Never place literal secret values in prompts, artifacts, commands, reports, or messages. Never write secret references or legacy `@ambercast-secret` grant lines in `.test.md` prompt text; a committed Plan or Grounding artifact may correctly contain a valid `secretRef` after local resolution and consent. When generate proposes a secret name outside `secrets.allow`, obtain the operator's approval interactively or ask them to add a reviewed name to `secrets.allow`; never use `"*"` without explicit operator approval. Never run a real heal in CI unless the user has explicitly authorized the required configuration and action.
When finished, present the complete diff and the command/report result. Do not commit unless explicitly asked.
~~~

Related: [Your first test in 5 minutes](/ambercast/tutorials/quick-start/), [Operating contract](/ambercast/agents/operating-contract/), [Environment variables](/ambercast/reference/environment-variables/)
