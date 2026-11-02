---
title: ambercast heal
description: Flags, repair stages, limits, authorization, CI rule, and write behavior of ambercast heal.
---

`ambercast heal` repairs plans and their grounding companions. You choose the prompts, measure a repair without committing it, or authorize the write.

## Flags {#flags}

Without `files`, heal selects prompts through discovery.

| flag | value | effect | default |
| --- | --- | --- | --- |
| files | path[] | literal prompts; absent selects discovery | discovery |
| --dry-run | boolean | measures repair without committing buffered plan or grounding changes | false |
| --yes, -y | boolean | authorizes non-interactive commit | false |
| --ai | claude\|codex | provider override | omitted |
| --allow-empty | boolean | allow empty selection | false |
| --list | boolean | list without healing | false |
| --json | boolean | JSON envelope | false |
| --no-color | boolean | disable ANSI | false |

## Repair model {#repair-model}

A completed repair result is `healed`, `partially-healed`, `unresolved`, or `no-changes-needed`. Each has constrained `application` and `stopReason` values.

Heal repairs in up to three stages:

1. It repairs the grounding first.
2. It then repairs a single step or the tail of the plan.
3. It repairs the full plan only when the earlier stages leave the case unrepaired and the case deadline has not been reached.

Stage 3 resolves an AI executor and calls generation, so it can dispatch a real provider.

Heal never makes a new secret-consent decision. It rejects a Stage 2 candidate that has an invalid secret name, an allowlist failure, or an environment-variable collision, with `secret-name-invalid`. It rejects a Stage 3 candidate that changes the complete logical secret-name set with `stage3Rejection.reason: "secret-set-changed"`. That rejection writes no plan or grounding update.

The human output of the CLI then prints `hint: ` followed by the hint below, with the actual prompt path in place of `<file>`. The `--json` output carries `stage3Rejection` and no hint.

`秘匿値の構成が変わった。ambercast generate --force <file> で再生成し同意を取り直す`

## Limits {#limits}

- `heal.maxStepRepairs`, when set, is a positive hard limit on real incremental-repair provider dispatches. It counts element confirmation and excludes the fail-closed baseline and Stage 3.
- `heal.caseTimeoutMs` is a positive case-wide admission deadline. Its default is `300000` ms.

## Confirmation {#confirmation}

Outside `--dry-run`, heal commits repair artifacts only after authorization. `--yes` authorizes non-interactively.

## CI {#ci}

Outside `--list`, heal in CI is rejected unless `ci.heal` is `true`.

## Preconditions and writes {#preconditions}

Outside `--list`, once a prompt's plan has loaded, every target that plan references must set `healReplayIsolation: "idempotent"`. Otherwise heal fails that prompt with `CONFIG_INVALID` (exit `2`). The default `healReplayIsolation` is `stateful`. Other configured targets that the plan does not reference do not block heal.

Heal buffers plan and grounding writes until authorized settlement. Each measurement can still write attempt evidence through `runsDir`-contained storage, before authorization and during `--dry-run`.

[Exit codes](/ambercast/reference/exit-codes/#aggregation-priority) owns the process-code values and their priority, and the [exit code table](/ambercast/reference/exit-codes/#exit-code-table) lists each code.

Related pages: [Configuration](/ambercast/reference/configuration/#grounding), [Reports](/ambercast/reference/reports/#heal-results), and [File layout](/ambercast/reference/file-layout/#run-artifacts).
