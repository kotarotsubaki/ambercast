---
title: Status and roadmap
description: Track implemented commands, planned capabilities, and the pre-1.0 version policy.
---

ambercast establishes a definite boundary between what is currently implemented in the CLI and what is planned for future milestones. Today, the CLI parser exposes seven subcommands—`init`, `generate`, `run`, `check`, `heal`, `view`, and `mcp`—without exposing additional subcommands, while establishing the plan regeneration requirements you need to follow across versions.

## Implemented in current release {#implemented}

The CLI parser exposes `init`, `generate`, `run`, `check`, `heal`, `view`, and `mcp`. The MCP subcommand serves six tools over stdio, keeping the operational interface focused on scaffolding, compiling, executing, validating, repairing, browsing the results of test plans, and serving an MCP interface.

When working across versions, 0.3.1 requires regeneration of 0.1.0 plans. This requirement exists because the producer-contract fingerprint changed between releases, making the producer bundle and `inputsDigest` from 0.1.0 stale under 0.3.1.

Links: [CLI overview](/ambercast/reference/cli/overview/), [Compatibility](/ambercast/reference/compatibility/), [Changelog](/ambercast/reference/changelog/)

## Planned after the current boundary {#planned-after-current-boundary}

Planned documentation still covers `review` and baseline/restore. The official skill remains planned; MCP tools are available. On the execution side, support for Firefox and WebKit is planned by 1.0.

Links: [ambercast review](/ambercast/reference/cli/review/), [MCP server](/ambercast/agents/mcp-server/)

## Version policy {#version-policy}

The published package version is 0.3.1. The product policy is CLI-only through 0.x and ships 1.0.0 together with the cloud version. This pre-1.0 phase concentrates on stabilizing the standalone CLI tools before pairing them with the cloud release.

Links: [Changelog](/ambercast/reference/changelog/), [Philosophy](/ambercast/philosophy/)
