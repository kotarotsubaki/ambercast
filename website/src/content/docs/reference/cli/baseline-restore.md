---
title: ambercast baseline and restore
description: The planned interface, storage, freshness rules, and open items of ambercast baseline and ambercast restore, which are not implemented yet.
status: planned
sidebar:
  badge:
    text: Planned
    variant: caution
---

:::caution
`ambercast baseline` and `ambercast restore` are planned features that the current release does not implement. The interfaces and behaviors described here are intended designs, not current functionality.
:::

This page records the planned database boundary for ambercast. Capturing a baseline and restoring it are two separate operations.

## Status {#status}

`ambercast baseline` and `ambercast restore` are not implemented in the current release and are not available CLI commands. They are separate flat verbs because their effects are opposite. A unified `reset` command and a mode flag were rejected as easier to misuse. The [CLI overview](/ambercast/reference/cli/overview/#command-surface) lists the available commands, and [Configuration](/ambercast/reference/configuration/#key-table) lists the configuration keys that exist today.

## Planned boundary {#planned-boundary}

| command / option | planned contract |
| --- | --- |
| `baseline [--target <name>] [--list] [--clear] [--force] [--json]` | Capture the current database as the selected target's baseline. |
| `baseline --force` | Permit overwriting an existing baseline. It is required regardless of TTY and does not bypass the no-primary-key linter. |
| `baseline --list` | Display baseline metadata only. |
| `baseline --clear` | Delete the selected baseline, and succeed when it is already absent. |
| `restore [--target <name>] [--json]` | Restore the selected target to its baseline for manual debugging or QA. |
| `run --no-reset` | Skip reset and hooks for that invocation. It is meant for debugging and discouraged in CI. |
| `check` integration | Validate the database config shape, resolvable secrets, baseline existence, and `configDigest` without opening a database connection. |

## Planned storage and freshness {#planned-storage-and-freshness}

| concept | planned contract |
| --- | --- |
| Location | `.baseline/<target>/`, relative to the resolved configuration directory. It is not configurable, is separate from `runsDir`, and is meant to be gitignored. |
| Metadata | `meta.json` records target, driver, capturedAt, capabilities, configDigest, sourceFingerprint, and artifactRef. |
| `configDigest` | A hash of the unresolved driver, connection, and driverOptions placeholders. A mismatch is config drift, exit `2`, with no automatic recapture. |
| `sourceFingerprint` | A hash of the non-secret remote identity. A mismatch after secret resolution is exit `3`. |
| Plan freshness | Neither database freshness value enters the plan `inputsDigest`. |

With `resetPerCase: true`, reset runs before the first case and after every case. Ordered boundary hooks then run, and a barrier probe must succeed before the next case.

By default, a reset or barrier probe failure errors the affected case and the run continues. With `onResetFailure: "abort"`, the run stops. Both paths exit `3`. A hook failure errors only that case and the run continues.

Planned configuration failures exit `2`: `baseline-missing`, an unresolved target or driver, config drift, a baseline conflict, and invalid flag combinations. Database connection, reset, and hook failures, along with source-fingerprint mismatches, exit `3`. The aggregate precedence stays `2 > 3 > 4 > 1 > 5 > 0`.

Human and JSON output must state `mode` as `captured` or `restored`.

## Undecided items {#undecided-items}

| state | item |
| --- | --- |
| Explicitly undecided | The release that introduces `baseline` and `restore`; both are tied to the fixture feature. |
| Reserved, not undecided | `--all-targets`, `--list --live`, additional hook phases, and parallel-worker `db.<target>` subkeys are v2 reservations, not part of this planned interface. |

For the shared report envelope, see [Reports](/ambercast/reference/reports/#envelope). For tool-side behavior, see [MCP tools](/ambercast/reference/mcp-tools/#tool-table). For how freshness is derived, see [Freshness and digests](/ambercast/spec/freshness/).
