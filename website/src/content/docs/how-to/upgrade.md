---
title: Upgrade between versions
description: Release-safety procedure for upgrading ambercast and regenerating stale plans.
---

This release-safety procedure guides you through upgrading ambercast when changes to the producer fingerprint mark existing plans stale and require regeneration.

## Prerequisites {#prerequisites}

- CHANGELOG 0.3.1 states that its producer-fingerprint change makes 0.1.0 plans stale and requires regeneration.

## Steps {#steps}

1. Read the target release’s BREAKING section before changing the dependency. The 0.3.1 entry explicitly names `inputsDigest` impact.
2. Upgrade ambercast using the project’s package manager, then run `npx ambercast check --json`. Check returns a report and selects exit `4` for untrustworthy findings.
3. If check exits `4`, run `npx ambercast generate` and review the plan/grounding diff. Generation composes the generator and report result.
4. Commit the dependency and accepted companion changes together. Then re-run check to make the final condition observable.

## Migrate secret grants {#migrate-secret-grants}

Prompts created for Plan v2 can contain legacy secret grant lines. Remove every grant line from the prompt; the old syntax is rejected and must not be migrated in place.

```markdown
@ambercast-secret {{secrets.password}}
```

Then run `npx ambercast generate --force <file>` and respond to the new consent prompt. For CI or another non-interactive environment, add the reviewed names to `secrets.allow` first. The regenerated Plan uses the v3 consent/allowlist model.

## Re-ground after a producer change {#reground-after-producer-change}

A new generator instruction for `confirms` changes the producer fingerprint, so plans from earlier releases are stale. Regenerating a plan replaces its grounding with an empty one, and the steps below bind every element step again. Plan 5, Grounding 4, and report 3.10 are unchanged.

1. Run `npx ambercast check --json` and confirm that the affected plans report `stale`.
2. Run `npx ambercast generate <file>` for each stale plan. In the diff, check that each assert lists in its `confirms` the inputs whose effects it shows.
   - If generate warns `action-unconfirmed` for an input, do not go on to step 3.
   - A plain run fails on that input with `GROUNDING_UNRESOLVED`.
   - Add an assert that shows the effect of that input, such as the signed-in user name, and repeat step 2.
3. Run `npx ambercast run --resolve --update-cache <file>` on your machine. The grounding is empty after regeneration, so ambercast calls AI once for each element step that has no verbatim quote. CI does not save the grounding by default.
4. Run `npx ambercast check` and confirm that the plan is `fresh`. Then run `npx ambercast run <file>` and confirm that it passes and that `aiCalls` is 0 in the report. Commit the plan and the grounding together.

## Verification {#verification}

- `npx ambercast check` exits `0` after accepted regeneration.

## Related {#related}

Links: [Changelog](/ambercast/reference/changelog/), [Freshness and digests](/ambercast/spec/freshness/), [ambercast check](/ambercast/reference/cli/check/), [ambercast generate](/ambercast/reference/cli/generate/), [Review generated diffs](/ambercast/how-to/review-generated-diffs/).
