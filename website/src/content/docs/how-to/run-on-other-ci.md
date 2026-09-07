---
title: Run on other CI platforms
description: Portable CI recipes for GitLab and generic runners.
---

This guide provides portable CI recipes for running ambercast on GitLab CI and generic runners.

## Prerequisites {#prerequisites}

- `run` accepts `--cache-only`, `--update-cache`, `--allow-empty`, and `--list`; it has no `--config` option.

## Steps {#steps}

1. In GitLab CI or a generic runner, install the project’s Node dependencies and Chromium with `npx playwright-core install chromium`; cache the browser install directory using that platform’s cache mechanism. The repository requires Chromium and documents this install command; a fully grounded replay may proceed without provider selection.
2. Run exactly `npx ambercast check` followed by `npx ambercast run`. Before uploading the invocation `report.json`, apply prior review, restricted access, and short retention; upload it only when those controls are available. Shell sequencing reaches `run` only when `check` exits successfully; `run` writes one report in its invocation directory, and report step results can retain `actual` text and an accessibility snapshot.
3. Upload invocation evidence or screenshots only by explicit opt-in after the same prior review, restricted access, and short retention. Failed live browser steps can persist PNG screenshots under the invocation evidence directory, and the safety scan cannot detect canvas, image, or CSS-rendered pixels or a scan-to-screenshot timing gap.
4. Do not invoke `heal` and do not pass `--update-cache`. CI defaults have `heal: false` and `updateGroundingCache: false`; real healing is an explicit opt-in via `ci.heal: true`, not a default CI action.

## Verification {#verification}

- Gate the job on its process exit code to interpret it. Untrustworthy artifacts and environment failures are distinct process categories.

## Related {#related}

Links: [Running ambercast in GitHub Actions](/ambercast/tutorials/github-actions/), [ambercast check](/ambercast/reference/cli/check/), [ambercast run](/ambercast/reference/cli/run/), [Exit codes](/ambercast/reference/exit-codes/), [Configuration](/ambercast/reference/configuration/).
