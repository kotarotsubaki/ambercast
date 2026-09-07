---
title: Your first test in 5 minutes
description: Guide your first generated test from prompt creation through generation, replay, and review.
---

This tutorial guides you through creating and running your first generated test with ambercast. By relying on built-in defaults—including a target application running at `http://localhost:3000` and tests placed in `tests/ambercast`—you can generate and replay an end-to-end test without creating a configuration file.

## Prerequisites {#prerequisites}

Before generating and running tests, verify that your environment meets the walkthrough-wide requirements:

- **Node.js**: Version 22.14 or later.
- **AI Provider**: An installed, authenticated Claude Code or Codex CLI. The first `generate` directly requires Node.js and an installed, authenticated provider. If no provider is available for generation, ambercast outputs the environment error code `AI_EXECUTOR_UNAVAILABLE`.
- **Browser Driver**: A Chromium binary. The walkthrough includes `run`, which configures a browser driver. Generation itself does not configure a browser driver, so Chromium is required by `run`, not by generation.

ambercast applies default settings for your workspace:

- The default `testDir` is `tests/ambercast`.
- The default target is `web-user` at `http://localhost:3000` using Chromium.

If a configuration file exists, `$schema` is required; no-file configuration is handled outside `RawConfig`. For this tutorial, you do not need to create a configuration file.

## Steps {#steps}

1. Do not create a configuration file. Create exactly `tests/ambercast/find-page.test.md`:

```markdown
# Find a page

When I open the application, navigate to the search page, search for "ambercast", and see "Search results".
```

Its terminal `.test.md` suffix is eligible for companion-path resolution.

2. Have a human or operator start and confirm the application at `http://localhost:3000`, then run `npx ambercast generate tests/ambercast/find-page.test.md`.

Successful generation exits `0` with result status `generated`. Its report field is `planFile`, while generation writes both derived companions beside the named prompt. When an agent uses the setup prompt ([Setup prompt](/ambercast/agents/setup-prompt/#copy-paste-prompt)), it assumes the server is already running and does not start it without a request.

3. Run `npx ambercast run tests/ambercast/find-page.test.md`.

On a passed replay, the process exits with code `0`. In addition, `run` creates a per-invocation `report.json` below the configured runs directory.

4. Run `git status --short` first. Review every changed tracked file with `git diff -- <path>`; for every untracked prompt, plan, or grounding path shown there, inspect its full contents or run `git diff --no-index /dev/null <path>`. Then have a human commit the reviewed three files.

An agent presents the complete change set and commits only after an explicit request in the conversation; neither a CLI flag nor `--yes` is that approval ([Setup prompt](/ambercast/agents/setup-prompt/#copy-paste-prompt)).

### Scope note

The no-argument forms `npx ambercast generate` and `npx ambercast run` discover every test matching the configured test directory, match, and ignore rules. Use either form only in a separately approved all-discovered-tests operation; this tutorial's commands intentionally name one `.test.md`.

## Completion state {#completion-state}

- The resolver maps the prompt to `tests/ambercast/find-page.ambercast.plan.json` and `tests/ambercast/find-page.ambercast.grounding.json`.
- `npx ambercast run` exited `0` and reports `passed` for the case.

Links: [Configuration](/ambercast/reference/configuration/), [File layout](/ambercast/reference/file-layout/), [ambercast generate](/ambercast/reference/cli/generate/), [ambercast run](/ambercast/reference/cli/run/), [Write effective prompts](/ambercast/how-to/write-effective-prompts/).
