---
title: Healing a test after a UI change
description: Repair an existing ambercast test on a disposable practice application after a locator-affecting UI change by configuring idempotent replay isolation.
---

This tutorial walks you through repairing an existing generated test on a disposable practice application after a locator-affecting UI change. Unmodified built-in targets default to stateful, which cannot heal; you will explicitly configure your target for idempotent replay isolation, verify the failure, preview the repair, and apply the healed artifacts.

## Steps {#steps}

Preserve your existing configuration and change only the selected target's `healReplayIsolation` key. Keep its target name, `baseUrl`, `browser`, and any `secretSinkOrigins` unchanged; do not add, remove, rename, or otherwise edit a target. A supplied `targets` record replaces the defaults, target names and definitions participate in `inputsDigest`, and `healReplayIsolation` is deliberately outside that digest contract.

1. In `ambercast.config.json`, edit the existing selected target entry so that only `healReplayIsolation` becomes `"idempotent"`. For the unconfigured default target, the equivalent preservation is:

```json
{"$schema":"https://kotarotsubaki.github.io/ambercast/schemas/config.schema.json","targets":{"web-user":{"baseUrl":"http://localhost:3000","browser":"chromium","healReplayIsolation":"idempotent"}},"defaultTarget":"web-user"}
```

The existing Plan remains fresh because its target name and digest-participating definition are unchanged; only its live healing policy changes. The file meets `RawConfig`'s required `$schema`, and the Schema URL is the published configuration Schema URL.

2. Before the failing run, confirm the retention policy and the authorized readers of the runs directory, because a completed `run` attempts to persist `report.json` there and may persist a failure screenshot (best effort: omitted on secret detection, capture or storage failure). Then make a locator-affecting UI change and run `npx ambercast run --cache-only tests/ambercast/<name>.test.md`; observe the failed result before attempting repair.

Running with `--cache-only` turns a grounding miss into a failure instead of an AI re-grounding, so the versioned grounding is not rewritten before the explicit heal approval (the default `grounding.localWriteBack: "auto"` would otherwise persist a re-resolved fingerprint and the run could pass).

3. Run `npx ambercast heal --dry-run tests/ambercast/<name>.test.md` and inspect the dry-run report (the runs-directory retention and readers were confirmed in step 2).

In the output, the report records a completed repair as `preview-only` when buffered plan and grounding writes remain unapplied. It does not expose candidate patch bytes, making this step an approval decision rather than a pre-write diff review. Each replay uses an attempt-specific child directory, however, and failure screenshots can still be persisted as contained evidence there, so dry-run is not a no-write preview.

4. Obtain explicit human approval, then choose the execution path: a human at an interactive terminal runs `npx ambercast heal tests/ambercast/<name>.test.md` and answers ambercast's CLI confirmation; an agent or other non-interactive caller runs `npx ambercast heal --yes tests/ambercast/<name>.test.md` only after that explicit approval appears in the conversation.

Passing `--yes` pre-authorizes only the CLI confirmation and never substitutes for human approval of an agent's write.

5. Run `npx ambercast check tests/ambercast/<name>.test.md`.

An exit code of `0` is the observable fresh completion of the repaired case; otherwise use [Recover stale artifacts](/ambercast/how-to/recover-stale-artifacts/).

6. After the real heal, run `git status --short`. For every changed tracked in-scope file—the configuration, the locator-affecting UI file, Plan, and Grounding—show `git diff -- <path>`; for every untracked in-scope file, show its full contents or `git diff --no-index /dev/null <path>`. Present that complete change set and stop. Commit only when the conversation explicitly asks for it. Revert only after confirming the target files and receiving explicit approval.

The agent default is diff presentation, permitting commits only on request; the required confirmation and approval boundaries prevent an agent from discarding existing changes by inference.

The no-argument form `npx ambercast heal` discovers every test matching the configured test directory, match, and ignore rules. Use it only in a separately approved all-discovered-tests repair operation; this tutorial heals one named `.test.md`.

## Completion state {#completion-state}

- The selected target (`web-user` in the no-config example shown in step 1) is explicitly `idempotent`; the unmodified built-in template for `web-user` is `stateful`, and a configured `targets` map replaces that template.
- `check` exits `0` after the accepted repair is fresh.

Links: [Configuration](/ambercast/reference/configuration/), [ambercast heal](/ambercast/reference/cli/heal/), [ambercast check](/ambercast/reference/cli/check/), [Review generated diffs](/ambercast/how-to/review-generated-diffs/), [Recover stale artifacts](/ambercast/how-to/recover-stale-artifacts/).
