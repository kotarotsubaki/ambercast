---
title: File layout
description: Reference for the paths Ambercast derives for companion files and run artifacts, who writes each one, and when.
---

Ambercast resolves every companion and run path from the test directory and the runs directory. This page lists each derived path, its writer and timing, and the commit policy Ambercast applies.

## Companions {#companions}

| Input path | Derived path | Rule |
| --- | --- | --- |
| `<testDir>/<dirs>/<name>.test.md` | `<testDir>/<dirs>/<name>.ambercast.plan.json` | Replace only the terminal `.test.md`. Preserve other dots in `<name>`. |
| `<testDir>/<dirs>/<name>.test.md` | `<testDir>/<dirs>/<name>.ambercast.grounding.json` | Use the same adjacent terminal-suffix transform. |

Forward mappings accept only an in-`testDir` path ending exactly in `.test.md` with a nonempty name. Invalid caller input raises `RangeError`. Inverse mappings recognize only exact in-tree plan or grounding suffixes and otherwise return `undefined`.

## Run artifacts {#run-artifacts}

| Artifact | Exact path | Writer / timing | Commit policy |
| --- | --- | --- | --- |
| Prompt | `<testDir>/<dirs>/<name>.test.md` | You write it. Ambercast reads it. | Ambercast applies no repository policy. The procedure is in [Manage artifacts in git](/ambercast/how-to/manage-artifacts-in-git/). |
| Plan companion | `<testDir>/<dirs>/<name>.ambercast.plan.json` | `generate` writes a newly generated Plan. `heal` may replace it only after an authorized settlement. | Ambercast treats it as a committed input. It performs no repository operation. |
| Grounding companion | `<testDir>/<dirs>/<name>.ambercast.grounding.json` | `generate` creates or repairs it. `run` may write changed Grounding under the write-back policy. `heal` may replace it after settlement. | `grounding.repositoryPolicy` is `committed` by default and may be `uncommitted`. Ambercast performs no repository operation. |
| Invocation directory | `<runsDir>/<runId>/` | `run` and `heal` use one invocation identity for case evidence. Run IDs are timestamp-plus-UUID safe segments. | Ambercast applies no repository policy to this directory. `ambercast init` appends `tests/ambercast/.runs/` to `.gitignore` for the default `runsDir`. The procedure is in [Manage artifacts in git](/ambercast/how-to/manage-artifacts-in-git/). |
| Case directory | `<runsDir>/<runId>/<test-relative-dir>/<name>/` | `run` provides this directory to evidence capture for the case. | Same as the invocation directory. |
| Run screenshot | `<runsDir>/<runId>/<test-relative-dir>/<name>/<stepId>.png` | `run` writes it for an eligible failed live-browser step. Secret detection may omit it. | Same as the invocation directory. |
| Heal attempt directory | `<runsDir>/<runId>/<test-relative-dir>/<name>/attempt-<n>/` | `heal` allocates a positive ordinal per attempt. It confines that attempt's evidence and overlay under this directory. | Same as the invocation directory. |
| Heal screenshot | `<runsDir>/<runId>/<test-relative-dir>/<name>/attempt-<n>/<stepId>.png` | The shared capture path writes eligible failed-step evidence into the attempt-scoped case directory. | Same as the invocation directory. |
| Run report | `<runsDir>/<runId>/report.json` | `run` writes the finalized batch envelope after execution. [`ambercast view`](/ambercast/reference/cli/view/) reads it. A failed atomic write changes `reportPersistence`. | Same as the invocation directory. |

A screenshot is best effort. A capture or storage failure also omits it.

`runsDir` is configured independently and defaults to `tests/ambercast/.runs`. Ambercast does not derive it from `testDir`.

A `runId` must match `^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$`. The pattern prevents separators, dot segments, and empty IDs.

`report.json` is written by `run`. The other reporting commands return their envelope without writing it.

## See also {#see-also}

- [Configuration](/ambercast/reference/configuration/#key-table)
- [Reports](/ambercast/reference/reports/#persistence)
- [Prompt file format](/ambercast/reference/prompt-format/#file-identity)
- [Manage artifacts in git](/ambercast/how-to/manage-artifacts-in-git/)
- [Plan lifecycle and freshness](/ambercast/explanation/plan-lifecycle/)
