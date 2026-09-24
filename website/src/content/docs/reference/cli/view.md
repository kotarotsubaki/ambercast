---
title: ambercast view
description: Command-line reference for ambercast view, defining flags, the interactive gate, port selection, host binding, and the served routes.
---

The `ambercast view` command starts a read-only local HTTP server that browses run results persisted under the configured runs directory, so a developer can inspect a run's cases, steps, and screenshots without re-running tests or making any AI calls.

## Flags {#flags}

| Flag | Value | Effect | Default |
| --- | --- | --- | --- |
| `--port` | n | preferred port; auto-increments through 20 candidates unless set | 4600 |
| `--host` | addr | bind address; a concrete IP or localhost, no wildcards | 127.0.0.1 |
| `--allow-headless` | boolean | permit a non-interactive terminal | false |
| `--config` | path | explicit config | omitted |
| `--no-color` | boolean | disable ANSI | false |

## Interactive gate {#interactive-gate}

`view` refuses to start unless stdin and stderr are both attached to a terminal and `CI` is not set, matching every other confirmation-gated command's interactivity check. Without `--allow-headless`, a non-interactive invocation exits 2 with:

```
view requires --allow-headless when no interactive terminal is attached.
```

`--allow-headless` lifts this refusal; it is a no-op in an already-interactive terminal.

## Port selection {#port-selection}

The starting port is `--port`, then the configured `viewer.port`, then 4600. Without `--port`, `view` tries up to 20 consecutive ports starting there, advancing only on `EADDRINUSE`, and prints the port it actually bound. With `--port`, that single port is strict: if it is occupied, `view` exits 3 rather than trying another port. Exhausting every candidate, or any bind failure other than `EADDRINUSE`, also exits 3.

## Host binding {#host-binding}

`--host` accepts a concrete IP address or `localhost` (normalized to `127.0.0.1`); a wildcard address (`0.0.0.0`, `::`, `[::]`) exits 2, since this server has no authentication. Every request is checked against the bound host and port through its `Host` header; a request naming a different host is refused with 403. Binding to a non-loopback address prints a warning that the server is reachable without authentication.

## Routes {#routes}

| Route | Serves |
| --- | --- |
| `GET /` | The run list, newest first, with status, duration, and case counts. |
| `GET /runs/<runId>` | One run's cases, steps, expected/actual values, explanations, and screenshots. |
| `GET /runs/<runId>/report.json` | The run's raw persisted report bytes. |
| `GET /runs/<runId>/screenshots/<ref>` | A screenshot the run's report actually references. |

Every response carries `X-Content-Type-Options: nosniff` and `Cache-Control: no-store`; HTML and raw responses also carry a fixed `Content-Security-Policy` and `Referrer-Policy: no-referrer`. The page renders server-side with no client JavaScript and no external requests.

A run directory missing its `report.json` (for example, mid-write, or after a failed persist) shows as evidence-only in the list rather than a broken link. A run whose `report.json` fails to parse or validate still appears, with its raw bytes reachable, rather than disappearing from the list.

`ambercast view` reads every report whose `schemaVersion` is 3.x. A report written by a different minor version than the current CLI shows "Schema `<version>`" in the run detail header; a report from another major version is listed as "Unsupported version `<version>`" and cannot be opened.

`view` is the only Ambercast command that consumes a network port; the MCP server uses portless stdio.

Links: [CLI overview](/ambercast/reference/cli/overview/#command-surface), [Reports](/ambercast/reference/reports/#envelope), [Configuration](/ambercast/reference/configuration/#key-table), [ambercast mcp](/ambercast/reference/cli/mcp/#usage).
