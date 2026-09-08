---
name: ambercast
description: Write and run ambercast prompt-only E2E tests for a web app. Author <name>.test.md prompts, drive generate / run / check / heal through the ambercast CLI, read the --json report and process exit code, and choose the next safe action. Use when the user asks for an E2E or browser test, mentions ambercast or a .test.md file, or wants an end-to-end check of a web app change.
license: MIT
compatibility: Requires the ambercast CLI (npx ambercast), Node.js 22.14 or newer, a Chromium binary installed with playwright-core, and an authenticated claude or codex CLI for the AI calls.
---

# ambercast

This skill covers ambercast, a CLI that turns a plain-language Markdown prompt into a deterministic browser test. The prompt is the only thing a person writes. The CLI generates an execution plan once with AI, then replays it in Chromium with zero AI calls until the page changes.

## When to use this skill

Use this skill when the task is to verify a web app end to end through a real browser: sign-in flows, forms, navigation, anything a user would click through. Do not use it for unit tests or API-only checks.

Confirm the prerequisites before running anything:

- Node.js 22.14 or newer.
- A Chromium binary. Install it once with `npx playwright-core install chromium`.
- An authenticated AI provider CLI: either `claude` (Claude Code) or `codex` (Codex CLI). By default the CLI probes both and uses the one that responds; `--ai` pins one for a single invocation.
- The app under test is running and reachable. The default base URL is `http://localhost:3000`.
- `ambercast.config.json` in the project root is optional. Without it, the defaults listed in the next section apply.

Install `ambercast` as a dev dependency so that `npx ambercast <command>` resolves to the project's pinned version; do not rely on `npx` downloading it ad hoc.

## Project facts come from the project

Never assume paths or names from memory or from this skill. Read them from the project every time:

| Fact | Where to read it | Default |
| --- | --- | --- |
| Prompt directory (`testDir`) | `ambercast.config.json` | `tests/ambercast` |
| Prompt glob (`testMatch`) | `ambercast.config.json` | `**/*.test.md` |
| Run evidence directory (`runsDir`) | `ambercast.config.json` | `tests/ambercast/.runs` |
| Targets and their `baseUrl` | `targets.<name>.baseUrl` in `ambercast.config.json` (an object keyed by target name) | one target named `web-user` at `http://localhost:3000` |
| Default target | `defaultTarget` in `ambercast.config.json` | `web-user` |
| Which prompts exist | `npx ambercast generate --list --json` | |

Rules:

- Use `generate --list` for discovery. It has no side effects. `run --list` writes a report under `runsDir`, so do not use it for discovery.
- Choosing a target: an explicit instruction from the user first, then `defaultTarget`, then the only target if exactly one exists. If several targets exist and none is selected, stop and ask the user which one to pass with `--target`.
- Secret names come only from the prompt: the `{{secrets.name}}` references and their grant lines are the source of truth. The environment variable `AMBERCAST_SECRET_<NAME>` only tells you whether a value is present. Never derive a logical secret name from an environment variable name; the mapping is not reversible.
- When the config and this skill disagree, the config wins.

## Writing a prompt

A prompt is a Markdown file named `<name>.test.md` inside `testDir`. It is the source of truth: the plan is generated from it and regenerated only when its meaningful content changes.

Structure:

- One H1 naming the test case.
- Plain sentences describing what the user does and what must be observable afterwards. No DSL, no selectors, no code.
- One verification per sentence, and every action sentence ends in an observable result: a page, a message, a visible value.
- Write data preparation as user actions inside the prompt (create the record through the UI before checking it).
- One file per user story. Put unrelated flows in separate files.

Secrets:

- Reference a secret as `{{secrets.name}}` and grant it on its own line, outside any code block: `@ambercast-secret {{secrets.name}}`. A grant inside a code block or code span is documentation, not a grant.
- The value comes from the environment variable `AMBERCAST_SECRET_<NAME>`: dots become underscores and letters are uppercased, so `{{secrets.api.key}}` reads `AMBERCAST_SECRET_API_KEY`.
- A reference without a grant line, or a grant without a value in the environment, fails closed with exit code 2.

### Good example
```markdown
# Sign in with a saved password

@ambercast-secret {{secrets.password}}

When I open the sign-in page, enter the username "demo@example.com" and the password {{secrets.password}}, and submit the form, I reach the dashboard and see the heading "Welcome back".
```

### Bad example
```markdown
# Login test

Go to the login page. Type demo@example.com and hunter2. Click the button.
```

The bad example puts a real password in the prompt (it must be a `{{secrets.*}}` reference with a grant line) and never says what should be true afterwards, so nothing is verified.

## The loop

The everyday cycle is: implement the change, write or update the prompt, generate, run, read the report, fix, run again. Pass the prompt files you created or changed as positional arguments. Run the whole suite only when the user asks for a regression check or in CI.

```bash
npx ambercast generate tests/ambercast/sign-in.test.md
npx ambercast run --json tests/ambercast/sign-in.test.md
```

- `generate` calls the AI provider once per prompt that has no fresh plan and writes the plan and grounding files next to the prompt. It skips prompts whose plan is already fresh. Use `--force` only when the user explicitly asks for a regeneration.
- `run` replays the plan in Chromium with no AI calls as long as the cached grounding still matches the page. On a grounding miss it falls back to AI for that step only. To prove a zero-AI replay, or in CI, add `--cache-only` so a miss fails instead of falling back:

```bash
npx ambercast run --cache-only --json tests/ambercast/sign-in.test.md
```

- Grounding changes found during a local run are persisted when `grounding.localWriteBack` is `auto` (the default). When it is `explicit`, pass `--update-cache`. In CI they are persisted only with `--update-cache` or with `ci.updateGroundingCache` set to true.
- `check` is a read-only freshness inspection. It calls no AI provider and no browser, and writes nothing. Use it as the first CI gate:

```bash
npx ambercast check --json
```

- `heal` repairs a plan whose grounding no longer matches the live UI. It rewrites plan and grounding files, so treat it as a destructive operation. Preview first:

```bash
npx ambercast heal --dry-run --json tests/ambercast/sign-in.test.md
```

A dry run changes nothing and needs no approval. Before running `heal` without `--dry-run`, show the user the dry-run result and get explicit approval for exactly that repair. If the prompt, the config, or the plan changes after the dry run, run the dry run again and ask again. `--yes` only skips the CLI confirmation prompt; it is never a substitute for the user's approval.

## Reading results

Take the exit code from the process exit status. It is not inside the JSON envelope. Then read the envelope: `summary` for counts, `results[]` for per-case status and steps, `errors[].code` for machine-readable failure reasons.

| Exit | Meaning | What to do next |
| --- | --- | --- |
| 0 | Success | Continue. |
| 1 | The command's own outcome is negative: a replayed expectation did not hold (run), an ambiguity under `--strict` (generate), or a repair that stayed unresolved, was only partially healed, or was declined (heal) | Apply the triage rules below. |
| 2 | Usage or configuration error: bad flags, invalid config, an unresolved secret or target | If stdout has no JSON, the flags were rejected before parsing; read the usage text on stderr and fix the command. If there is JSON, follow `errors[].code` and fix the config or the environment variables. |
| 3 | Environment error: browser launch failed, AI provider unavailable, file I/O failure, interrupted | Start the app, install Chromium, or authenticate the provider CLI, then retry. |
| 4 | The plan or grounding cannot be trusted: missing, stale, or no longer matching the prompt | Run `npx ambercast generate` for that prompt. Running the test again does not help. |
| 5 | The selection matched zero prompts | Check the path, `testDir`, `testMatch`, and `testIgnore`. Exclusions win over inclusions. |

When a batch mixes outcomes, the process exit code is the highest-priority one in this fixed order: `2 > 3 > 4 > 1 > 5 > 0`. Individual outcomes are always preserved in `results[]` and `errors[]`.

Triage for exit 1 from `run`, based on the failing step in `results[]`:

- The step could not find the element it expected, or found it changed while the intent is the same: the UI changed. Propose `heal --dry-run` and show the user the preview.
- The element was found and operated, but the expected result did not appear: if the user's recent change caused it, fix the app; if the expectation is vague or wrong, fix the prompt.
- If you cannot tell which case applies, stop and ask the user instead of guessing.

Never confuse exit 1 with 2, 3, or 4. For `run`, exit 1 means the app was exercised and at least one expectation was not met; in a mixed batch read `results[]`, because the aggregate exit follows the priority order above.

## What to commit

| File | Commit? |
| --- | --- |
| `<name>.test.md` | Yes. It is the source of truth. |
| `<name>.ambercast.plan.json` | Yes. Review its diff like a lockfile. |
| `<name>.ambercast.grounding.json` | Yes when `grounding.repositoryPolicy` is `committed` (the default). When it is `uncommitted`, ignore the file in git instead. |
| Everything under `runsDir` (default `tests/ambercast/.runs`) | No. Add the resolved `runsDir` to the repository root `.gitignore` as a project-root-relative POSIX path. If `runsDir` points outside the repository, do nothing. |

Never edit plan or grounding files by hand. Change the prompt and regenerate, or heal.

## Never do this

- Never put a literal secret value in a prompt, a plan, a command line, a report, or a chat message. Use a `{{secrets.name}}` reference with a grant line and provide the value through the environment.
- Never run `heal` in CI. The CLI refuses with exit code 2 unless `ci.heal` is true, and even then an agent must not start it there.
- Never edit `.ambercast.plan.json` or `.ambercast.grounding.json` by hand.
- Never hide a failure: do not drop `--cache-only` to make a CI run pass, and do not use `--force` to regenerate a plan just to get past a red result.
- Never use `--yes` as a substitute for the user's approval of a repair.

## Learn more

- Getting started: https://kotarotsubaki.github.io/ambercast/guides/getting-started/
- Writing prompts: https://kotarotsubaki.github.io/ambercast/guides/writing-prompts/
- Commands: https://kotarotsubaki.github.io/ambercast/guides/commands/
- Exit codes: https://kotarotsubaki.github.io/ambercast/guides/exit-codes/
- Artifacts: https://kotarotsubaki.github.io/ambercast/guides/artifacts/
- Secrets: https://kotarotsubaki.github.io/ambercast/guides/secrets/
- CI usage: https://kotarotsubaki.github.io/ambercast/guides/ci/
- Configuration reference: https://kotarotsubaki.github.io/ambercast/reference/configuration/
