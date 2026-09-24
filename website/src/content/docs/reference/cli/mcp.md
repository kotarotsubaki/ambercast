---
title: ambercast mcp
description: Launch, transport, lifecycle, and client registration for the MCP server.
---

`ambercast mcp` starts the portless MCP server over `stdio`. Each process serves one session root.

## Usage {#usage}

```sh
ambercast mcp [--dir <path>] [--sync-wait-ms <n>] [--help]
```

## Flags {#flags}

| Flag | Value | Effect | Default |
| --- | --- | --- | --- |
| `--dir` | path | session root to serve | cwd |
| `--sync-wait-ms` | n | synchronous response wait bound in milliseconds | 45000 |

`--dir` selects the session root; omission uses the process current working directory. Relative paths resolve against that directory. `--sync-wait-ms` is a positive integer with default 45000, bounding the synchronous wait before a long workflow returns a job handle. `--help` takes precedence over other arguments and prints usage to stdout with exit 0.

If the resolved directory is absent or not a directory, stderr prints `ambercast mcp: --dir <path> is not a directory.` and the process exits 2 without starting. Startup failure prints `ambercast mcp: failed to start (<error name>)` and exits 3. Invalid options, positional arguments, and invalid wait bounds use the CLI usage error on stderr with exit 2.

## Transport and shutdown {#transport-and-shutdown}

Stdout contains JSON-RPC lines only. Stderr receives progress and one startup line, `ambercast mcp: serving <session root>`. The server begins draining on stdin end, SIGTERM, or SIGINT. It aborts in-flight calls, waits at most 10000 ms, closes the server, and exits 0 after settlement; an unsettled call at the deadline causes exit 3. New tool calls are rejected during draining.

## Client registration {#client-registration}

Use `npx --no-install ambercast mcp` in the project where ambercast is installed. Claude Code reads a project `.mcp.json`:

```json
{"mcpServers":{"ambercast":{"command":"npx","args":["--no-install","ambercast","mcp"]}}}
```

Codex CLI reads `config.toml`:

```toml
[mcp_servers.ambercast]
command = "npx"
args = ["--no-install", "ambercast", "mcp"]
```

Claude Desktop accepts the same server entry in its configuration:

```json
{"mcpServers":{"ambercast":{"command":"npx","args":["--no-install","ambercast","mcp"]}}}
```

Always start the client from a project where ambercast is installed, so `npx --no-install` can resolve the package; `--dir <path>` only selects a different session root once the server is running and has no effect on that package resolution. The server provides `ambercast_generate`, `ambercast_run`, `ambercast_check`, `ambercast_heal`, `ambercast_job_status`, and `ambercast_job_cancel`.

## Changes from the planned design {#changes-from-the-planned-design}

| Earlier planned page | Implemented contract |
| --- | --- |
| Server flags unspecified | `ambercast mcp` supports `--dir` and `--sync-wait-ms` |
| Five planned tools | Six tools, including job status and cancellation |
| Report `outputSchema` published | `outputSchema` omitted |
| Heal preview only | Two-stage heal uses `applyToken` |
| Synchronous calls only | Long calls return jobs; status without ID lists jobs |
| MCP errors unspecified | `HEAL_APPLY_TOKEN_INVALID`, `HEAL_APPLY_FAILED`, `JOB_NOT_FOUND`, and `JOB_FAILED` have a separate error response |
| CLI input flags unspecified | Tool inputs exclude `headed`, `list`, `stale`, `json`, `yes`, and `configPath` |
| Exit code inferred from report | `_meta.exitCode` carries it explicitly |

Links: [MCP Tools](/ambercast/reference/mcp-tools/#tool-table), [MCP server](/ambercast/agents/mcp-server/#connection-boundary), [CLI overview](/ambercast/reference/cli/overview/#command-surface).
