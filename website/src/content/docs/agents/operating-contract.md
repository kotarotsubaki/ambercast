---
title: Operating contract
description: For each command, what must hold before you run it, what it may write, whether it needs the user's approval, and what to do next after an exit code or report error.
---

The tables below say whether you may run a command and what to do after it. The CLI implements seven commands: `init`, `generate`, `run`, `check`, `heal`, `view`, and `mcp`.

## Command contract {#command-contract}

Check the precondition and the side effects before you run a command. `check` and `view` need no write storage, AI provider, or browser. `heal` holds plan and grounding changes until confirmation, but it can write attempt evidence under `runsDir` before approval and during `--dry-run`.

| Command | Precondition | Side effects | Needs approval? | Use in CI |
| --- | --- | --- | --- | --- |
| `init` | Write permission for the target directory. | May write the config, a sample prompt, a two-line `.gitignore` unit, and an `AGENTS.md` block. | Explicit user approval; `--yes` is not agent authorization. | Rejects non-interactive use without `--yes`. CI use does not change the approval boundary. |
| `generate` | A valid prompt and target. | Writes the plan and grounding; after interactive consent, adds accepted secret names to `secrets.allow`. | Yes for consent and writes; show the diff before any commit. | Works once reviewed names are in `secrets.allow`. |
| `run` | A trusted plan for the selected prompt. | Persists the report; writes grounding only through the write-back gate. | Yes, unless the requested scope already allows writes. | Works, subject to the write-back policy. |
| `check` | A selection that discovery can find. | Reads prompts and artifacts only. | No. | Works. |
| `heal` | Every target the plan references sets `healReplayIsolation: "idempotent"`. | May write attempt evidence; writes plan and grounding changes only after confirmation. | Explicit user approval; `--yes` is not agent authorization. | Refused unless `ci.heal` is `true`, except with `--list`. |
| `view` | stdin and stderr are terminals and `CI` is inactive, or you pass `--allow-headless`. Without `--port`, it tries up to 20 consecutive ports. | None; serves persisted run reports read-only. | No. | Needs `--allow-headless` when no terminal is attached. |
| `mcp` | The session-root directory exists. | Starts a stdio server; each tool follows its own write and approval boundaries. | Depends on the tool. | Depends on the tool. |

If a `heal` target is not idempotent, the command fails with `CONFIG_INVALID` and exit 2.

Related: [CLI overview](/ambercast/reference/cli/overview/), [ambercast init](/ambercast/reference/cli/init/#confirmation), [ambercast heal](/ambercast/reference/cli/heal/#preconditions), [ambercast run](/ambercast/reference/cli/run/#grounding-write-back)

## Prohibitions {#prohibitions}

These restrictions have no exceptions.

- Never place a literal secret value in a prompt, artifact, command, report, or message. Use a `SecretRef`, its environment variable, and the target's sink policy.
- `SECRET_LITERAL_REJECTED` comes from a narrow heuristic. It does not replace the prohibition above.
- Never add `@ambercast-secret` grant lines. For a name outside `secrets.allow`, get the operator's consent or ask them to add the reviewed name. `"*"` needs explicit approval because it accepts any name the AI proposes.
- In CI, do not run a real heal unless `ci.heal` is `true`.
- `--yes` answers the CLI confirmation prompt only. A dry run never commits.

Related: [Manage secrets](/ambercast/how-to/manage-secrets/), [Healing model](/ambercast/explanation/healing-model/#confirmation-and-writes)

## Next action by exit code {#next-action-by-exit-code}

When a command has several outcomes, the exit code follows a fixed priority, not the order of the results. Act on the code as follows.

| Exit | Meaning | Next safe action |
| --- | --- | --- |
| 0 | Success or no candidate | Inspect permitted diffs and continue within scope. |
| 1 | Command-specific negative result | Read the failed evidence. Do not heal or regenerate automatically. |
| 2 | Usage or configuration problem | Read `errors[].code` and fix that boundary. |
| 3 | Environment problem | Keep the JSON report and fix the environment, not the test. |
| 4 | Untrustworthy plan or grounding | For `MISSING_PLAN`, `STALE_PLAN`, and `INTEGRITY_VIOLATION`, use stale-artifact recovery. For `GROUNDING_UNRESOLVED`, rerun with `--resolve` only if the requested scope allows an AI call and a grounding write; otherwise report it. |
| 5 | Empty selection | Confirm the intended selection before you allow an empty set. |

Related: [Exit codes](/ambercast/reference/exit-codes/#aggregation-priority)

## Next action by report error {#next-action-by-report-error}

The report schema defines fifteen usage codes and eight environment codes. `INTERRUPTED` is run-scoped, and `skipped` rows mark the cases it affected. Each producible code belongs to exactly one row. The legacy `SECRET_GRANT_UNATTRIBUTABLE` is never produced and has no row.

| Codes | Next safe action |
| --- | --- |
| `CONFIG_INVALID`, `PROMPT_PATH_INVALID`, `TARGET_UNRESOLVED`, `EXECUTOR_UNSUPPORTED`, `PROMPT_AMBIGUOUS` | Read the named Reference page and fix the boundary without guessing values. |
| `SECRET_UNRESOLVED`, `SECRET_LITERAL_REJECTED`, `SECRET_ENV_VAR_COLLISION`, `SECRET_SYNTAX_REJECTED` | Fix the secret reference or environment variable. Never write the value into the prompt. |
| `SECRET_CONSENT_REQUIRED` | Get approval interactively or add reviewed names to `secrets.allow`. Do not retry as if consent were granted. |
| `MISSING_PLAN`, `STALE_PLAN`, `INTEGRITY_VIOLATION` | Treat the artifacts as untrusted and use stale-artifact recovery. |
| `GROUNDING_UNRESOLVED` | Rerun with `--resolve` only if the requested scope allows it; otherwise report it. If it still fails, read `details.reason` and report it instead of looping. |
| `BROWSER_LAUNCH_FAILED`, `AI_EXECUTOR_UNAVAILABLE`, `AI_RESPONSE_INVALID`, `FS_IO_ERROR`, `UNEXPECTED_CRASH` | Keep the JSON report and repair the environment. |
| `AGENTIC_STEP_FAILED`, `CASE_ABORTED` | Read `details`. Do not infer the case result; fix the environment or the call. |
| `INTERRUPTED` | Treat the remaining work as incomplete and infer no case result. |

Related: [Error codes](/ambercast/reference/error-codes/), [Reading structured output](/ambercast/agents/reading-structured-output/#decision-tree), [Troubleshoot common failures](/ambercast/how-to/troubleshoot/)
