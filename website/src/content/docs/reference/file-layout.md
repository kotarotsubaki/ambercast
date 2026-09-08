---
title: File layout
description: Reference for Ambercast path arithmetic, artifact producers, timing, and implementation-backed repository policies.
---

Ambercast defines path arithmetic, artifact producers, timing, and implementation-backed repository policies for test prompts, companion files, and execution outputs.

## Companions {#companions}

| Input path | Derived path | Rule |
| --- | --- | --- |
| `<testDir>/<dirs>/<name>.test.md` | `<testDir>/<dirs>/<name>.ambercast.plan.json` | Replace only the terminal `.test.md`; preserve other dots in `<name>`. |
| `<testDir>/<dirs>/<name>.test.md` | `<testDir>/<dirs>/<name>.ambercast.grounding.json` | Use the same adjacent terminal-suffix transform. |

Forward mappings accept only an in-`testDir` path ending exactly in `.test.md` with a nonempty name; invalid caller input raises `RangeError`. Inverse mappings recognize only exact in-tree plan or grounding suffixes and otherwise return `undefined`.

## Run artifacts {#run-artifacts}

| Artifact | Exact path | Writer / timing | Implementation-backed commit policy |
| --- | --- | --- | --- |
| Prompt | `<testDir>/<dirs>/<name>.test.md` | User-authored input; Ambercast reads it. | No Git decision is encoded; Git procedure is owned by how-to/manage-artifacts-in-git. |
| Plan companion | `<testDir>/<dirs>/<name>.ambercast.plan.json` | Generate writes a newly generated plan; heal may replace it only after an authorized settlement. | Runtime treats it as a committed input, but performs no Git operation. |
| Grounding companion | `<testDir>/<dirs>/<name>.ambercast.grounding.json` | Generate creates/repairs it; run may write changed grounding under write-back policy; heal may replace it after settlement. | `grounding.repositoryPolicy` is `committed` by default and may be set to `uncommitted`; Ambercast itself performs no Git operation. |
| Invocation directory | `<runsDir>/<runId>/` | Run and heal use one invocation identity for case evidence; run IDs are timestamp-plus-UUID safe segments. | No repository policy exists for this directory; Git procedure is owned by how-to/manage-artifacts-in-git. |
| Case directory | `<runsDir>/<runId>/<test-relative-dir>/<name>/` | Run provides this directory to evidence capture for the case. | Same as the invocation directory. |
| Run screenshot | `<runsDir>/<runId>/<test-relative-dir>/<name>/<stepId>.png` | Run writes it for an eligible failed live-browser step; secret detection may omit it. | Same as the invocation directory. |
| Heal attempt directory | `<runsDir>/<runId>/<test-relative-dir>/<name>/attempt-<n>/` | Heal allocates a positive ordinal per attempt and confines that attempt's evidence/overlay under it. | Same as the invocation directory. |
| Heal screenshot | `<runsDir>/<runId>/<test-relative-dir>/<name>/attempt-<n>/<stepId>.png` | The shared capture path writes eligible failed-step evidence into the attempt-scoped case directory. | Same as the invocation directory. |
| Run report | `<runsDir>/<runId>/report.json` | Only `run` writes the finalized batch envelope after execution; a failed atomic write changes `reportPersistence`. | Same as the invocation directory. |

`runsDir` is independently configured and defaults to `tests/ambercast/.runs`; it is not derived by the layout resolver from `testDir`.

A `runId` must match `^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$`, preventing separators, dot segments, and empty IDs.

Only `run` persists `report.json`; generate, check, and heal return envelopes without this layout write.

### Related

Links:
- [Configuration](/ambercast/reference/configuration/#key-table)
- [Reports](/ambercast/reference/reports/#persistence)
- [Prompt file format](/ambercast/reference/prompt-format/#file-identity)
- [Manage artifacts in git](/ambercast/how-to/manage-artifacts-in-git/)
- [Plan lifecycle and freshness](/ambercast/explanation/plan-lifecycle/)
