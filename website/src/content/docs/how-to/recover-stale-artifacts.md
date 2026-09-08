---
title: Recover stale artifacts
description: Resolve stale, missing, or orphaned artifacts based on their check status.
---

When test artifacts fall out of date or go missing, use their reported check status to determine the recovery action.

## Prerequisites {#prerequisites}

`check` is read-only: its dependencies omit provider, browser, event sink, and mutable storage.

## Steps {#stale}

| check status | exact next action | expected observable result |
| --- | --- | --- |
| `fresh` | Run `npx ambercast check`; make no artifact change. | Exit `0`. |
| `fresh-without-grounding` | Run `npx ambercast generate tests/ambercast/<name>.test.md`. | `generate` repairs the adjacent Grounding file on disk, then reports `skipped-fresh` with `planFile` only; it does not report a grounding path. |
| `stale` | Run `npx ambercast generate tests/ambercast/<name>.test.md`, then review the diff. | Fresh generation can exit `0`; a still-untrusted check exits `4`. |
| `missing-plan` | Restore the plan from version control or run `npx ambercast generate tests/ambercast/<name>.test.md`. | A generated result has a `planFile`. |
| `missing-grounding` | Run `npx ambercast generate tests/ambercast/<name>.test.md`. | When the Plan is fresh, `generate` creates its adjacent Grounding file on disk and returns `skipped-fresh` with `planFile` only; `groundingFile` is not a Generate result field. |
| `stale-grounding` | Run `npx ambercast generate tests/ambercast/<name>.test.md`, then review the new grounding. | Check no longer emits a failed integrity finding when valid. |
| `invalid-grounding` | Regenerate from the prompt and review the new grounding. | Check no longer emits a failed integrity finding when valid. |
| `orphaned-plan` | Restore its prompt or remove the orphan through the project’s normal review process. | The next check no longer has that orphan finding. |
| `orphaned-grounding` | Restore its prompt or remove the orphan through the project’s normal review process. | The next check no longer has that orphan finding. |
| `invalid-artifact-name` | Rename/remove the invalid companion through normal review. | The next check no longer reports that inverse-incapable artifact. |
| `listed` | Re-run without `--list` to inspect freshness. | `--list` performed no plan or grounding read. |
| `skipped` | Re-run after resolving interruption. | A run-scoped `INTERRUPTED` error contributes exit `3`. |

## Verification {#verification}

Run `npx ambercast check --json`; expect exit `0` only when no candidate with higher priority remains.

## Related {#related}

Links: [ambercast check](/ambercast/reference/cli/check/), [ambercast generate](/ambercast/reference/cli/generate/), [Error codes](/ambercast/reference/error-codes/), [Exit codes](/ambercast/reference/exit-codes/), [ambercast heal](/ambercast/reference/cli/heal/), [Review generated diffs](/ambercast/how-to/review-generated-diffs/).
