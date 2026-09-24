---
title: MCP server
description: Connection boundary for agents using the ambercast MCP server.
---

The `ambercast mcp` subcommand provides a portless `stdio` connection for agents to run and repair keystroke E2E tests. One server process serves one session root: `--dir` selects it, or the process current working directory is used. Files supplied to tools resolve relative to that root. Use `--sync-wait-ms` to set the synchronous response wait bound; the default is 45000 ms.

## Connection boundary {#connection-boundary}

The connection exposes `ambercast_generate`, `ambercast_run`, `ambercast_check`, `ambercast_heal`, `ambercast_job_status`, and `ambercast_job_cancel`. The first four are the workflow operations; the last two observe and cancel server-local jobs. See [MCP Tools](/ambercast/reference/mcp-tools/#tool-table) for inputs, annotations, job records, `isError`, and the MCP error surface. Register the process in your client as shown in [ambercast mcp](/ambercast/reference/cli/mcp/#client-registration).

## Changes from the planned design {#changes-from-the-planned-design}

| Earlier planned page | Implemented connection |
| --- | --- |
| Five planned tools | Six tools, including job status and cancellation |
| Report `outputSchema` published | `outputSchema` omitted |
| Heal preview only | Two-stage heal uses `applyToken` |
| Synchronous workflows only | Long calls become jobs; status without ID lists jobs |
| Server flags unspecified | `ambercast mcp` supports `--dir` and `--sync-wait-ms` |
| MCP errors unspecified | `HEAL_APPLY_TOKEN_INVALID`, `HEAL_APPLY_FAILED`, `JOB_NOT_FOUND`, and `JOB_FAILED` use a separate error surface |
| CLI inputs unspecified | Inputs exclude `headed`, `list`, `stale`, `json`, `yes`, and `configPath` |
| Exit code inferred from report | `_meta.exitCode` carries it explicitly |

Links: [MCP Tools](/ambercast/reference/mcp-tools/#tool-table), [ambercast mcp](/ambercast/reference/cli/mcp/#usage), [Reading structured output](/ambercast/agents/reading-structured-output/).
