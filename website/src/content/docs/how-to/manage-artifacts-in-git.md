---
title: Manage artifacts in git
description: Configure git tracking and ignore rules for ambercast plan, grounding, and run artifacts.
---

This recipe explains how to manage ambercast artifacts in git. By default, the grounding policy is `repositoryPolicy: "committed"` and the runs directory is `tests/ambercast/.runs`.

## Prerequisites {#prerequisites}

- The default grounding policy is `repositoryPolicy: "committed"`.
- The default runs directory is `tests/ambercast/.runs`.

## Steps {#steps}

1. Stage `<name>.test.md`, `<name>.ambercast.plan.json`, and `<name>.ambercast.grounding.json` when your policy is `committed`. The resolver defines the two adjacent companion suffixes.
2. Set `{"$schema":"https://kotarotsubaki.github.io/ambercast/schemas/config.schema.json","grounding":{"repositoryPolicy":"uncommitted"}}` when grounding is a local cache. This is the published configuration Schema URL and `uncommitted` is an accepted policy.
3. Add the configured `runsDir` to `.gitignore`. For the default, add `tests/ambercast/.runs/`. The `runsDir` path is configurable. A run writes one `report.json` within an invocation-specific directory below it.
4. When `repositoryPolicy` is `uncommitted`, also add `tests/ambercast/**/*.ambercast.grounding.json` to `.gitignore`. Replace `tests/ambercast` with the configured `testDir` when it differs. The resolver derives Grounding companions only inside `testDir` with the fixed `.ambercast.grounding.json` suffix. Plans remain tracked while local Grounding companions are ignored.

## Verification {#verification}

Run `git status --short`:

- With `committed`, expect plan and Grounding companions.
- With `uncommitted`, expect the plan but not a `testDir`-local `*.ambercast.grounding.json`.
- When the configured `runsDir` is ignored, do not expect its run evidence.

## Related {#related}

Links: [File layout](/ambercast/reference/file-layout/), [Configuration](/ambercast/reference/configuration/), [Plan document](/ambercast/spec/plan-document/), [Grounding document](/ambercast/spec/grounding-document/), [Control grounding write-back](/ambercast/how-to/control-grounding-writeback/).
