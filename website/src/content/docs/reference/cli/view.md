---
title: ambercast view
description: Flags, the interactive gate, port selection, host binding, and served routes of ambercast view.
---

`ambercast view` starts a read-only local HTTP server over the runs directory in your configuration. You inspect a run's cases, steps, and screenshots without re-running tests, and it makes no AI calls.

## Flags {#flags}

`view` takes no positional argument.

| flag | value | effect | default |
| --- | --- | --- | --- |
| --port | n | preferred port; auto-increments through 20 candidates unless set | 4600 |
| --host | addr | bind address; a concrete IP or localhost, no wildcards | 127.0.0.1 |
| --allow-headless | boolean | permit a non-interactive terminal | false |
| --config | path | explicit config | omitted |
| --no-color | boolean | disable ANSI | false |

## Interactive gate {#interactive-gate}

`view` refuses to start unless stdin and stderr are both terminals and `CI` is not active, meaning unset, empty, or `false`. `init` applies the same terminal-plus-`CI` check before its confirmation prompt. Without `--allow-headless`, a non-interactive invocation exits `2` with this message:

```text
view requires --allow-headless when no interactive terminal is attached.
```

`--allow-headless` lifts the refusal. It changes nothing in a terminal.

## Port selection {#port-selection}

The starting port is `--port`, then the configured `viewer.port`, then `4600`. Without `--port`, `view` tries up to 20 consecutive ports from there. It advances only on `EADDRINUSE` and prints the port it bound.

With `--port`, that one port is strict: if it is occupied, `view` exits `3`. Exhausting every candidate, or any bind failure other than `EADDRINUSE`, also exits `3`.

## Host binding {#host-binding}

`--host` takes a concrete IP address or `localhost`, which becomes `127.0.0.1`. A wildcard address (`0.0.0.0`, `::`, or `[::]`) exits `2`, because the server has no authentication. The `Host` header of every request must name the bound host and port, or the server answers `403`. For any bound address other than `127.0.0.1` and `::1`, `view` prints a warning that the server is reachable without authentication.

## Routes {#routes}

| route | serves |
| --- | --- |
| `GET /` | The run list, newest first, with status, duration, and case counts. |
| `GET /runs/<runId>` | One run's cases, steps, expected and actual values, explanations, and screenshots. |
| `GET /runs/<runId>/report.json` | The run's raw persisted report bytes. |
| `GET /runs/<runId>/screenshots/<ref>` | A screenshot that the run's report references. |

Every response carries `X-Content-Type-Options: nosniff` and `Cache-Control: no-store`. HTML and raw responses also carry a fixed `Content-Security-Policy` and `Referrer-Policy: no-referrer`. The page renders on the server with no client JavaScript and no external requests.

A run directory without `report.json`, for example mid-write or after a failed persist, appears in the list as evidence-only. A run whose `report.json` fails to parse or validate still appears, and its raw bytes stay reachable.

`view` reads every report whose `schemaVersion` is 3.x. A report from another minor version shows "Schema `<version>`" in the run detail header. A report from another major version is listed as "Unsupported version `<version>`" and cannot be opened.

`view` is the only ambercast command that uses a network port. The MCP server uses stdio.

Related pages: [CLI overview](/ambercast/reference/cli/overview/#command-surface), [Reports](/ambercast/reference/reports/#envelope), [Configuration](/ambercast/reference/configuration/#key-table), and [ambercast mcp](/ambercast/reference/cli/mcp/#usage).
