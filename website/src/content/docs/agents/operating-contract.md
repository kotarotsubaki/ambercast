---
title: Operating contract
description: Action boundaries, command preconditions, prohibitions, and next safe actions for invoking ambercast commands.
---

This operating contract defines the action boundaries, preconditions, side effects, and safe follow-up actions for invoking ambercast commands. The CLI parser exposes exactly four implemented commands: `generate`, `run`, `check`, and `heal`.

## Command contract {#command-contract}

Before invoking a command, verify its preconditions and expected side effects to decide whether you can execute it safely. The parser exposes exactly `generate`, `run`, `check`, and `heal` as implemented commands.

Among these commands, `check` has no mutable-storage, AI-provider, or browser dependency. Healing buffers only plan and grounding companion changes until confirmation, but its replay attempts may write contained evidence in the case run directory before approval and during dry runs.

| Command | Precondition | Side effects | Needs approval? | Safe in CI? |
| --- | --- | --- | --- | --- |
| `generate` | A selected prompt and target must be valid. | May write plan and grounding artifacts. | Yes for writes; present diff before commit. | Yes, subject to project policy. |
| `run` | A selected prompt has a trusted plan. | Writes invocation report; may write grounding under its write-back contract. | Yes when requested scope does not already authorize writes. | Yes, subject to write-back policy. |
| `check` | A selection can be discovered. | Reads prompts and artifacts only. | No ambercast-artifact write approval required. | Yes. |
| `heal` | Target is idempotent and a real attempt is CI-enabled when in CI. | May write attempt evidence in the runs directory; commits measured plan/grounding candidates only after confirmation. | Explicit user approval; `--yes` is not agent authorization. | No by default; only with `ci.heal: true`. |

Links: [CLI overview](/ambercast/reference/cli/overview/), [ambercast heal](/ambercast/reference/cli/heal/#preconditions), [ambercast run](/ambercast/reference/cli/run/#grounding-write-back)

## Prohibitions {#prohibitions}

Operating within safety boundaries requires adhering to these non-negotiable restrictions:

- An agent MUST NOT place a literal secret value in a prompt, artifact, command, report, or message; use a `SecretRef`, its environment-variable value, and the target's sink policy instead.
- The public error vocabulary includes `SECRET_LITERAL_REJECTED`; the detector is a narrow heuristic and does not replace the agent prohibition on literal secrets.
- In CI, real healing is refused unless `ci.heal` is enabled.
- `--yes` pre-authorizes the CLI confirmation prompt only; dry runs never commit.

Links: [Manage secrets](/ambercast/how-to/manage-secrets/), [Healing model](/ambercast/explanation/healing-model/#confirmation-and-writes)

## Next action after a process status {#next-action-by-exit-code}

A process status is selected from batch exit candidates independently of result order. Use the mappings below to determine the next safe action:

| Process outcome | Next safe action |
| --- | --- |
| success | Inspect permitted diffs and continue within scope. |
| failed evidence | Inspect failed evidence; do not heal or regenerate automatically. |
| usage or configuration problem | Read `errors[].code` and correct that boundary. |
| environment problem | Preserve the envelope and fix the environment, not test semantics. |
| untrustworthy artifacts | Use stale-artifact recovery. |
| empty selection | Reconfirm selection intent before allowing an empty set. |

Links: [Exit codes](/ambercast/reference/exit-codes/#priority)

## Next action by report error {#next-action-by-report-error}

The report schema defines eight usage codes and six environment codes, structurally separated by kind in the report schema. When an execution is interrupted, `INTERRUPTED` is run-scoped, while skipped result rows represent affected cases. Map each error family to its non-destructive first action:

| Error family | Next safe action |
| --- | --- |
| configuration, secret, or target | Read the named Reference and correct the boundary without guessing values. |
| plan freshness or integrity | Treat artifacts as untrusted and use stale-artifact recovery. |
| browser, provider, storage, or crash | Preserve the envelope and repair the environment. |
| interruption | Treat remaining work as incomplete; do not infer a case result. |

Links: [Error codes](/ambercast/reference/error-codes/), [Reading structured output](/ambercast/agents/reading-structured-output/#decision-tree), [Troubleshoot common failures](/ambercast/how-to/troubleshoot/)
