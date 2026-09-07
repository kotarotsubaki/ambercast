---
title: MCP Tools
description: Planned tool contracts, result classifications, and safety defaults for ambercast MCP workflows.
status: planned
sidebar:
  badge:
    text: Planned
    variant: caution
---

:::caution
MCP tools are not implemented in 0.3.1. The CLI parser accepts only `generate`, `run`, `check`, and `heal`, and provides no `mcp` server command. The tool definitions and behaviors documented on this page describe planned v2 behavior rather than current behavior.
:::

This reference defines the planned tool contracts for ambercast Model Context Protocol (MCP) workflows.

## Status {#status}

MCP tools are not implemented in 0.3.1; the CLI parser accepts only `generate`, `run`, `check`, and `heal`, and no `mcp` server command. Their planned v2 tool set is defined for v2.

Links: [ambercast mcp](/ambercast/reference/cli/mcp/#status), [MCP server](/ambercast/agents/mcp-server/).

## Planned tool contract {#planned-tool-contract}

- Tool names use the `ambercast_` prefix plus snake_case, and the surface exposes a small set of workflow operations rather than mechanically copying every CLI command.
- `structuredContent` uses the same structured-report schema as CLI `--json`, exposed unchanged as `outputSchema`.
- Screenshots return as file paths or `resource_link`, never inline base64.
- The observed-subtree isolation note appears in both runtime payload and JSON Schema description.

## Tool table {#tool-table}

| Tool | CLI equivalent | Annotations (`readOnly`, `destructive`, `idempotent`, `openWorld`) | `isError: true` | Legitimate negative result with `isError: false` |
| --- | --- | --- | --- | --- |
| `ambercast_generate` | `generate --json` | `false`, `false`, `true` (weak), `false` | Exit 2 or 3. | Strict ambiguity exit 1. |
| `ambercast_run` | `run --json` | `false`, `false`, `false`, `true` | Exit 2 or 3, plus untrusted-Plan rejection exit 4. | Assertion failure exit 1. |
| `ambercast_check` | `check --json` | `true`, `false`, `true`, `false` | Exit 2 or 3. | Stale discovery exit 4, represented in `results[].status`. |
| `ambercast_heal` | `heal --json` | `false`, `true`, `false`, `true` | Exit 2 or 3, including CI refusal, plus untrusted-Plan rejection before repair. | Started but unresolved repair exit 1. |
| `ambercast_review` | `review --json` | `true`, `false`, `false`, `true` | Exit 2 or 3. | Review concern exit 1. |

- All four MCP annotations must be explicit because the MCP defaults for destructive and open-world hints are unsafe to leave at their defaults.
- General `isError` policy is true for exits 2 and 3; exit 4 differs by workflow, while test-red exit 1 and zero-match exit 5 remain false.
- Generate's idempotent hint is weak: a fresh Plan is skipped and effects converge, but AI output itself may vary.

## Heal safety default {#heal-safety-default}

| Channel | `dryRun` default | Rationale |
| --- | --- | --- |
| MCP `ambercast_heal` | `true` | Agent invocation defaults to preview because heal is the destructive MCP workflow. |
| CLI `ambercast heal` | `false` | The MCP default is intentionally asymmetric with local CLI use. |

A `requiresUserInteraction`-equivalent hint is recommended for capable clients, but is not a required standard annotation.

## Undecided items {#undecided-items}

| State | Item |
| --- | --- |
| Explicitly undecided | None; the five tools above are the stated v2 set. |
| Unspecified | Exact per-tool input property schemas beyond MCP heal's `dryRun` default. |
| Unspecified | Baseline and restore correspond to two future MCP tools, but supply no names, annotations, `isError` rules, or input/output schemas. |

Links: [Reports](/ambercast/reference/reports/#envelope), [ambercast review](/ambercast/reference/cli/review/#planned-interface), [ambercast baseline and restore](/ambercast/reference/cli/baseline-restore/#planned-boundary).
