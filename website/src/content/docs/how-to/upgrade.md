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

## Verification {#verification}

- `npx ambercast check` exits `0` after accepted regeneration.

## Related {#related}

Links: [Changelog](/ambercast/reference/changelog/), [Freshness and digests](/ambercast/spec/freshness/), [ambercast check](/ambercast/reference/cli/check/), [ambercast generate](/ambercast/reference/cli/generate/), [Review generated diffs](/ambercast/how-to/review-generated-diffs/).
