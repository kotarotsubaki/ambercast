---
title: Status and roadmap
description: Track the implemented command boundary of ambercast 0.3.1, planned capabilities, and the pre-1.0 version policy.
---

ambercast 0.3.1 establishes a definite boundary between what is currently implemented in the CLI and what is planned for future milestones. Today, the CLI parser exposes six subcommands—`init`, `generate`, `run`, `check`, `heal`, and `view`—without exposing additional subcommands, while establishing the plan regeneration requirements you need to follow across versions.

## Implemented in current release {#implemented}

The 0.3.1 CLI parser exposes `init`, `generate`, `run`, `check`, `heal`, and `view`. The implemented parser exposes no MCP subcommand, keeping the operational interface focused on scaffolding, compiling, executing, validating, repairing, and browsing the results of test plans.

When working across versions, 0.3.1 requires regeneration of 0.1.0 plans. This requirement exists because the producer-contract fingerprint changed between releases, making the producer bundle and `inputsDigest` from 0.1.0 stale under 0.3.1.

Links: [CLI overview](/ambercast/reference/cli/overview/), [Compatibility](/ambercast/reference/compatibility/), [Changelog](/ambercast/reference/changelog/)

## Planned after the current boundary {#planned-after-current-boundary}

Several surfaces and tools lie outside the 0.3.1 implementation. Planned documentation covers `review`, `mcp`, baseline/restore, MCP tools, and an official skill. On the execution side, support for Firefox and WebKit is planned by 1.0.

Links: [ambercast review](/ambercast/reference/cli/review/), [Official skill](/ambercast/agents/official-skill/), [MCP server](/ambercast/agents/mcp-server/)

## Version policy {#version-policy}

The published package version is 0.3.1. The product policy is CLI-only through 0.x and ships 1.0.0 together with the cloud version. This pre-1.0 phase concentrates on stabilizing the standalone CLI tools before pairing them with the cloud release.

Links: [Changelog](/ambercast/reference/changelog/), [Philosophy](/ambercast/philosophy/)
