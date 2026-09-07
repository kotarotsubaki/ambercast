---
title: Select which tests run
description: Selection recipes to choose which test prompts run.
---

Use these selection recipes to choose which test prompts run.

## Prerequisites {#prerequisites}

- Default discovery matches `**/*.test.md` and ignores runs, plans, and grounding companions.

## Steps {#steps}

1. Run `npx ambercast run tests/ambercast/sign-in.test.md --list`.
   A positional is a literal prompt path and `--list` returns without replay.

2. Run `npx ambercast run --grep 'sign-in' --list`.
   The parser builds a regular expression for discovery filtering.

3. Put `"testMatch":["**/*.test.md"],"testIgnore":["**/.runs/**"]` in a valid config.
   A matching ignore excludes a path even when it matches `testMatch`.

4. Run `npx ambercast run --list -- --literal.test.md` for a literal path beginning with `--`.
   Flags such as `--list` must precede the separator; everything after `--` is a literal positional path, so a trailing `--list` would be treated as a file name.

## Verification {#verification}

- Expect exit `0` for `--list` when selected paths are reported; resolve zero matches with `--allow-empty` only when intentional.

## Related {#related}

Links: [Discovery patterns](/ambercast/reference/discovery-patterns/), [ambercast run](/ambercast/reference/cli/run/), [ambercast generate](/ambercast/reference/cli/generate/), [Configuration](/ambercast/reference/configuration/).
