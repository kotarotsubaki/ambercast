---
title: Troubleshoot common failures
description: Look up troubleshooting actions by observed symptoms to resolve ambercast failures.
---

When an ambercast command fails, use this symptom-to-action reference to diagnose the underlying cause and determine your next step.

## Prerequisites {#prerequisites}

Before inspecting execution reports, ensure your command invocation is structurally valid. Invalid flags, malformed command arguments, and missing option values write usage to stderr and exit `2` without a report envelope.

## Steps {#steps}

Match your observed symptom to the corresponding cause and action:

| symptom | cause | next action |
| --- | --- | --- |
| Invalid config, unresolved secret, or target | A configuration or invocation boundary needs correction. | Read [Error codes](/ambercast/reference/error-codes/), then correct the named setting without guessing values. |
| Missing, stale, or untrustworthy companion | The committed artifact cannot be used as current evidence. | Use the matching row in [Recover stale artifacts](/ambercast/how-to/recover-stale-artifacts/). |
| `SECRET_CONSENT_REQUIRED` | Generation found an unallowlisted secret name and consent was declined or unavailable. | Review the name, add it to `secrets.allow`, or rerun generate interactively; do not add a secret value to the prompt. |
| Heal reports `secret-set-changed` | A Stage 3 candidate changed the complete secret-name set, which heal cannot reattribute or consent to silently. | Run `ambercast generate --force <file>` and complete consent: `秘匿値の構成が変わった。ambercast generate --force <file> で再生成し同意を取り直す` |
| Literal secret or legacy secret syntax | Protected IR rejected a secret-handling boundary. | Use [Manage secrets](/ambercast/how-to/manage-secrets/); do not place a literal or legacy grant line in the prompt. |
| Browser, provider, storage, or crash | The execution environment failed. | Preserve JSON output, repair the environment, then rerun the smallest command. |
| Interrupted work | Batch work was incomplete. | Re-run after the interruption is resolved. |
| Failed assertion | A replayed case has failing evidence. | Inspect the report, fix the app or prompt, then rerun. |
| Empty selection | No prompts matched the requested selection. | Correct selection, or use `--allow-empty` only for intentional emptiness. |

Use [Error codes](/ambercast/reference/error-codes/) for the exact error vocabulary and [Exit codes](/ambercast/reference/exit-codes/#priority) for process-status values and priority.

## Verification {#verification}

Re-run the smallest affected command and expect exit `0` only after no higher-priority condition remains.

## Related {#related}

Links: [Error codes](/ambercast/reference/error-codes/), [Exit codes](/ambercast/reference/exit-codes/), [ambercast check](/ambercast/reference/cli/check/), [ambercast generate](/ambercast/reference/cli/generate/), [ambercast run](/ambercast/reference/cli/run/), [ambercast heal](/ambercast/reference/cli/heal/), [Recover stale artifacts](/ambercast/how-to/recover-stale-artifacts/), [Manage secrets](/ambercast/how-to/manage-secrets/), [Configure targets](/ambercast/how-to/configure-targets/).
