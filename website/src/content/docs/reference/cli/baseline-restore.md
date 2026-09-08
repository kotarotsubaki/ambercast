---
title: ambercast baseline and restore
description: Planned external database baseline capture and restore interface for ambercast.
status: planned
sidebar:
  badge:
    text: Planned
    variant: caution
---

:::caution
`ambercast baseline` and `ambercast restore` are planned features not implemented in 0.3.1. The interfaces and behaviors described here represent intended designs rather than current functionality.
:::

`ambercast baseline` and `ambercast restore` define the planned database boundary for ambercast, maintaining baseline capture and restoration as distinct operations.

## Status {#status}

`ambercast baseline` and `ambercast restore` are not implemented in 0.3.1; the parser accepts only `generate`, `run`, `check`, and `heal`, and rejects any other command. Their planned database boundary is defined by the DB reset design.

Links: [CLI overview](/ambercast/reference/cli/overview/#command-surface), [Configuration](/ambercast/reference/configuration/#key-table).

## Planned boundary {#planned-boundary}

| Command / option | Planned contract |
| --- | --- |
| `baseline [--target <name>] [--list] [--clear] [--force] [--json]` | Capture the current database as the selected target's baseline. |
| `baseline --force` | Permit overwrite of an existing baseline; required regardless of TTY and does not bypass the no-primary-key linter. |
| `baseline --list` | Display baseline metadata only. |
| `baseline --clear` | Delete the selected baseline and succeed idempotently when it is absent. |
| `restore [--target <name>] [--json]` | Restore the selected target to its baseline for manual debugging or QA. |
| `run --no-reset` | Skip reset and hooks for that invocation; intended for debugging and discouraged in CI. |
| `check` integration | Validate DB config shape, resolvable secrets, baseline existence, and `configDigest` without opening a DB connection. |

Capture and restore are separate flat verbs because they have opposite effects; a unified `reset` command and a mode flag were rejected as easier to misuse.

## Planned storage and freshness {#planned-storage-and-freshness}

| Concept | Planned contract |
| --- | --- |
| Location | `.baseline/<target>/`, relative to the resolved configuration directory, non-configurable, separate from `runsDir`, and intended for gitignore. |
| Metadata | `meta.json` records target, driver, capturedAt, capabilities, configDigest, sourceFingerprint, and artifactRef. |
| `configDigest` | Hash unresolved driver/connection/driverOptions placeholders; mismatch is config drift, exit 2, without automatic recapture. |
| `sourceFingerprint` | Hash non-secret remote identity; mismatch after secret resolution is exit 3. |
| Plan freshness | Neither DB freshness value enters Plan `inputsDigest`. |

With `resetPerCase: true`, reset runs before the first case and after every case, then ordered boundary hooks run and a barrier probe must succeed before the next case.

Reset and barrier probe failures default to erroring the affected case and continuing; `onResetFailure: "abort"` stops the run, and both paths exit 3. Hook failure errors only that case and continues.

Planned configuration failures (`baseline-missing`, unresolved target/driver, config drift, baseline conflict, and invalid flag combinations) exit 2; DB connection, reset, and hook failures along with source-fingerprint mismatches exit 3; aggregate precedence remains `2 > 3 > 4 > 1 > 5 > 0`.

Human and JSON output must state `mode` as `captured` or `restored`.

## Undecided items {#undecided-items}

| State | Item |
| --- | --- |
| Explicitly undecided | The release that introduces `baseline` and `restore`; both are tied to the fixture feature. |
| Reserved, not undecided | `--all-targets`, `--list --live`, additional hook phases, and parallel-worker `db.<target>` subkeys are v2 reservations, not part of this planned interface. |

Links: [Reports](/ambercast/reference/reports/#envelope), [MCP Tools](/ambercast/reference/mcp-tools/#planned-tool-contract), [Freshness and digests](/ambercast/spec/freshness/).
