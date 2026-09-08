---
title: ambercast generate
description: Reference for ambercast generate flags, provider executor resolution, companion file artifacts, and exit statuses.
---

The `ambercast generate` command compiles test prompts into plans and companion artifacts, managing provider executor resolution and artifact generation across literal file paths or discovered tests.

## Flags {#flags}

| flag | value | effect | default |
| --- | --- | --- | --- |
| files | path[] | literal prompts; absent selects discovery | discovery |
| --strict | boolean | strict generation policy | false |
| --force | boolean | force generation | false |
| --dry-run | boolean | preview: `would-generate` only when generation is needed; fresh Plan returns `skipped-fresh`; neither outcome writes | false |
| --target | name | select target | omitted |
| --ai | claude\|codex | provider override | omitted |
| --allow-empty | boolean | allow empty selection | false |
| --list | boolean | list without generation | false |
| --json | boolean | JSON envelope | false |
| --config | path | explicit config | omitted |
| --no-color | boolean | disable ANSI | false |

## AI calls {#ai-calls}

`ambercast generate` resolves a provider executor only through its generation dependency; the configured provider and `--ai` override are supplied to that resolver.

`--list` returns discovery rows without running generation. With `--dry-run`, a target needing generation returns `would-generate`, while a fresh Plan returns `skipped-fresh`. Neither dry-run outcome writes artifacts: the fresh branch skips Grounding repair, and the generation branch returns before writes.

## Side effects and exits {#side-effects}

A prompt named `<name>.test.md` maps to plan and grounding companions beside it (see [File layout](/ambercast/reference/file-layout/#companions)).

Result statuses are `generated`, `would-generate`, `skipped-fresh`, `listed`, `failed`, and `skipped` (see [Reports](/ambercast/reference/reports/#generate-results)). `would-generate` is the dry-run status only for a target that needs generation; `skipped-fresh` is also valid in dry-run mode.

Process-code values and their priority are owned by [Exit codes](/ambercast/reference/exit-codes/#aggregation-priority), with individual codes listed in [Exit codes](/ambercast/reference/exit-codes/#exit-code-table). The `--allow-empty` flag controls whether an empty selection contributes exit 5 (see [Configuration](/ambercast/reference/configuration/#file-selection)).
