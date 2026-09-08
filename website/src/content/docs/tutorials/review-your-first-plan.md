---
title: Reading your first plan and grounding
description: Learn how to locate generated plan and grounding files and check their freshness.
---

Building on [Your first test in 5 minutes](/ambercast/tutorials/quick-start/), this tutorial walks you through locating the companion files ambercast creates for a test prompt and checking their freshness.

## Steps {#steps}

1. Open `tests/ambercast/sign-in.ambercast.plan.json` and read `schemaVersion`, `source.inputsDigest`, and `steps`. Notice the path structure: the resolver derives it from the prompt by replacing the exact `.test.md` suffix.

2. Open `tests/ambercast/sign-in.ambercast.grounding.json` and examine its `schemaVersion`, `planDigest`, and `entries`. As with the plan, the resolver derives the paired grounding path from that same prompt.

3. Run `npx ambercast check tests/ambercast/sign-in.test.md --json`. Check produces a report envelope where a fresh result has status `fresh` or `fresh-without-grounding`.

## Completion state {#completion-state}

The command exits `0` only when the whole report has no failure, case error, or interruption; a selected fresh case does not by itself guarantee it because check also scans companion artifacts for orphan findings. The JSON report exposes the freshness result.

Links: [Plan document](/ambercast/spec/plan-document/), [Grounding document](/ambercast/spec/grounding-document/), [File layout](/ambercast/reference/file-layout/), [ambercast check](/ambercast/reference/cli/check/), [Review generated diffs](/ambercast/how-to/review-generated-diffs/).
