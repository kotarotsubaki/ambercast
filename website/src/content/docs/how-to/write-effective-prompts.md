---
title: Write effective prompts
description: Author focused test prompts with clear outcomes and verify plan generation with a dry run.
---

Focused test prompts keep test cases clear and make plan review straightforward. This guide walks you through structuring prompt files, isolating user outcomes into dedicated files, declaring secrets when needed, and verifying plan generation using a dry run.

## Prerequisites {#prerequisites}

- A prompt must end in exact `.test.md` to have valid companion mappings.

## Steps {#steps}

1. Create `tests/ambercast/checkout.test.md` with one H1, setup needed for the case, and one observable outcome per sentence. Treat these as recommendations for focused review, not parser syntax.

   A success criterion should name something visible at the destination—a heading, message, or element—not only that a URL was reached.

   > …I reach the dashboard and see the heading "Welcome back".
2. Split unrelated user outcomes into separate `<name>.test.md` files to keep cases focused.
3. Use a standalone `@ambercast-secret {{secrets.name}}` line only when needed. The parser identifies only complete grant lines outside code. One grant line authorizes exactly one use, so repeat the line once per use when the same secret is used more than once.
4. Run `npx ambercast generate tests/ambercast/checkout.test.md --dry-run`. A valid preview result has status `would-generate` and `dryRun: true`; it does not claim a committed write.

## Verification {#verification}

Review the dry-run result, then run generation without `--dry-run`; expect exit `0` and a `generated` result on success.

## Related {#related}

- [Prompt file format](/ambercast/reference/prompt-format/)
- [Secrets in plans](/ambercast/spec/secrets/)
- [ambercast generate](/ambercast/reference/cli/generate/)
- [Plan document](/ambercast/spec/plan-document/)
- [Review generated diffs](/ambercast/how-to/review-generated-diffs/)
