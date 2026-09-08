---
title: Running ambercast in GitHub Actions
description: Set up a portable GitHub Actions workflow to run ambercast with check and run commands.
---

This tutorial guides you through setting up ambercast in GitHub Actions using a portable sequence. You will configure your workflow job to run `npx ambercast check` followed by `npx ambercast run`, dispatching test execution only after the shell sees exit `0` from `check`.

## Steps {#steps}

1. Add these job commands after checkout, Node/dependency installation, Chromium installation, and any required provider authentication:

```yaml
- run: npx ambercast check
- run: npx ambercast run
```

`check` is a distinct command with read-only selection options. Once the job runs, you will observe that `run` is dispatched only after the shell sees exit `0` from `check`.

2. Do not add `--update-cache`.

Default CI configuration has `updateGroundingCache: false`. During the run, you will observe that the workflow executes with `updateGroundingCache: false` by default.

3. Have a human commit and push the workflow. An agent presents the workflow diff and commits or pushes only after an explicit request in the conversation (see [Setup prompt](/ambercast/agents/setup-prompt/#copy-paste-prompt)).

This agent commit/push policy is separate from CLI behavior. When an artifact is stale or untrustworthy, you will observe exit `4`, which stops the job before `run`.

## Completion state {#completion-state}

- The job reaches `run` only after `check` exits `0`; it has not opted into grounding write-back.

Links: [Run on other CI platforms](/ambercast/how-to/run-on-other-ci/), [Control grounding write-back](/ambercast/how-to/control-grounding-writeback/), [ambercast check](/ambercast/reference/cli/check/), [ambercast run](/ambercast/reference/cli/run/), [Exit codes](/ambercast/reference/exit-codes/).
