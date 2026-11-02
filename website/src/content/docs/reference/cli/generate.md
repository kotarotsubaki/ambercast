---
title: ambercast generate
description: Flags, provider resolution, secret consent, companion files, and exit statuses of ambercast generate.
---

`ambercast generate` turns test prompts into plans and companion artifacts. It works on literal file paths or on tests that discovery selects.

## Flags {#flags}

| flag | value | effect | default |
| --- | --- | --- | --- |
| files | path[] | literal prompts; absent selects discovery | discovery |
| --force | boolean | force generation | false |
| --dry-run | boolean | write nothing and report only: `would-generate` when generation is needed, `skipped-fresh` for a fresh plan | false |
| --target | name | limit the generation targets to this target only | omitted |
| --ai | claude\|codex | provider override | omitted |
| --allow-empty | boolean | allow empty selection | false |
| --list | boolean | list without generation | false |
| --json | boolean | JSON envelope | false |
| --config | path | explicit config | omitted |
| --no-color | boolean | disable ANSI | false |

## AI calls {#ai-calls}

`generate` resolves a provider executor only on the generation path. The configured provider and the `--ai` override feed that resolver.

`--list` returns discovery rows without running generation. With `--dry-run`, a target that needs generation returns `would-generate`, and a fresh plan returns `skipped-fresh`. Neither outcome writes artifacts: the fresh branch skips grounding repair, and the generation branch returns before any write.

## Secret consent {#secret-consent}

Generation builds a candidate first and asks for consent second. It constructs the candidate plan, finds secret names outside `secrets.allow`, and asks for interactive approval before it writes the plan or the grounding. `--force` follows the same consent boundary when it regenerates a fresh plan. `--dry-run` writes no artifact and stores no consent.

In a non-interactive context, or when you decline, an unallowed candidate fails with `SECRET_CONSENT_REQUIRED` and exit `2`. Add reviewed names to `secrets.allow` before you run in CI. The value `"*"` skips the per-name review and accepts any name the AI proposes, so it carries a strong risk warning. See [Manage secrets](/ambercast/how-to/manage-secrets/) for the safe workflow.

## Side effects and exits {#side-effects}

A prompt named `<name>.test.md` maps to plan and grounding companions beside it (see [File layout](/ambercast/reference/file-layout/#companions)).

The result statuses are `generated`, `would-generate`, `skipped-fresh`, `listed`, `failed`, and `skipped` (see [Reports](/ambercast/reference/reports/#generate-results)). `would-generate` is the dry-run status for a target that needs generation, and `skipped-fresh` also appears in dry-run mode.

[Exit codes](/ambercast/reference/exit-codes/#aggregation-priority) owns the process-code values and their priority, and the [exit code table](/ambercast/reference/exit-codes/#exit-code-table) lists each code. The `--allow-empty` flag decides whether an empty selection contributes exit `5` (see [Configuration](/ambercast/reference/configuration/#file-selection)).
