---
title: Review generated diffs
description: Follow a practical review order to inspect generated diffs across prompts and their companion files.
---

Review generated diffs by inspecting your test prompt and its derived companion files in a practical order.

## Prerequisites {#prerequisites}

The resolver maps a prompt to plan and grounding companions with fixed suffixes.

## Steps {#steps}

1. Run `git status --short` first. For every untracked prompt, plan, or grounding path shown there, inspect its full contents or run `git diff --no-index /dev/null <path>`; use `git diff -- <path>` for changed tracked files. This establishes the complete candidate file set before semantic review.
2. Review `tests/ambercast/<name>.test.md`; state the intended user outcome in the review. Prompt normalization preserves content other than one BOM and newline representation.
3. Review `tests/ambercast/<name>.ambercast.plan.json`; compare generated steps to that outcome. The plan is a separate derived companion.
4. Review `tests/ambercast/<name>.ambercast.grounding.json`; distinguish resolution change from intent change. Grounding is a separate derived companion.
5. Run `npx ambercast check tests/ambercast/<name>.test.md`. Check has no write, browser, or provider capability.

## Verification {#verification}

Expect check exit `0` only after the accepted pair is fresh.

## Related {#related}

Links: [Plan document](/ambercast/spec/plan-document/), [Grounding document](/ambercast/spec/grounding-document/), [ambercast check](/ambercast/reference/cli/check/), [File layout](/ambercast/reference/file-layout/), [Upgrade between versions](/ambercast/how-to/upgrade/).
