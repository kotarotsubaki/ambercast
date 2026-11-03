---
title: MCP server
description: "`ambercast mcp` serves one session root over stdio to an MCP client, and this page says what the agent can call and where each call's details live."
---

This page lists what you can call from an MCP client and where each call is documented. The server runs ambercast's browser E2E workflows: generate, run, check, and heal.

## Connection boundary {#connection-boundary}

`ambercast mcp` provides a portless stdio connection. One server process serves one session root. `--dir` selects it, and the process working directory is used when you omit it.

Files you pass to tools resolve against that root. `--sync-wait-ms` bounds the synchronous wait, and the default is 45000 ms.

The server exposes six tools: `ambercast_generate`, `ambercast_run`, `ambercast_check`, `ambercast_heal`, `ambercast_job_status`, and `ambercast_job_cancel`. The first four are the workflows, and the last two observe and cancel server-local jobs.

As [MCP Tools](/ambercast/reference/mcp-tools/#tool-table) explains, only `ambercast_generate` accepts `target`. The other workflow tools select targets from the plan.

Inputs, annotations, job records, `isError`, and the MCP error surface are on the same page. Register the process in your client as shown in [ambercast mcp](/ambercast/reference/cli/mcp/#client-registration).

## Changes from the planned design {#changes-from-the-planned-design}

| Earlier planned page | Implemented connection |
| --- | --- |
| Five planned tools, including `review` | Six tools, including job status and cancellation; `review` is not exposed |
| Report `outputSchema` published | `outputSchema` omitted |
| Heal preview only | Two-stage heal uses `applyToken` |
| Synchronous workflows only | Long `generate`, `run`, and heal-preview calls return jobs; status without an ID lists jobs |
| Server flags unspecified | `ambercast mcp` supports `--dir` and `--sync-wait-ms` |
| MCP errors unspecified | `HEAL_APPLY_TOKEN_INVALID`, `HEAL_APPLY_FAILED`, `JOB_NOT_FOUND`, and `JOB_FAILED` use a separate error surface |
| CLI inputs unspecified | Inputs exclude `headed`, `list`, `stale`, `json`, `yes`, and `configPath` |
| Exit code inferred from report | `_meta.exitCode` carries it explicitly |

Related: [MCP Tools](/ambercast/reference/mcp-tools/#tool-table), [ambercast mcp](/ambercast/reference/cli/mcp/#usage), [Reading structured output](/ambercast/agents/reading-structured-output/)
