---
title: Manage secrets
description: Approve generated secret names safely and resolve their values from environment variables.
---

Ambercast discovers candidate secret names while generating a Plan. You approve those names through an interactive consent prompt or pre-populate the configuration allowlist for non-interactive use; secret values remain outside prompts and artifacts.

## Prerequisites {#prerequisites}

- No existing `ambercast.config.json` file is required. When accepted consent needs to persist an allowlist and the configured file is absent, Ambercast creates it automatically.

## Steps {#steps}

1. Write the user outcome in the prompt without any grant line or secret value.

   ```markdown
   # Sign in

   Sign in as the configured test user and verify that the dashboard heading is visible.
   ```
2. Run `npx ambercast generate tests/ambercast/<name>.test.md`. Generation first produces a candidate Plan and lists any newly proposed secret names. In an interactive terminal, review each name and accept only the names that are appropriate for this test.
3. For CI or another non-interactive environment, add the reviewed names before generating:

   ```json
   {
     "$schema": "https://kotarotsubaki.github.io/ambercast/schemas/config.schema.json",
     "secrets": { "allow": ["password"] }
   }
   ```

   An empty `secrets.allow` requires consent for every name. The value `"*"` accepts any AI-proposed name without per-name review; use it only when you understand that this removes the approval boundary. When it is already `"*"`, accepting consent writes no allowlist update.

   When recording accepted names, Ambercast takes an exclusive update, then re-reads and validates the current on-disk configuration before merging; it does not overwrite an earlier configuration snapshot. Existing `secrets.allow` names are deduplicated while keeping their existing order. Newly accepted names are deduplicated, names already present are excluded, and the remaining names are sorted alphabetically and appended.
4. Set the corresponding value only in the command environment. At runtime, `{{secrets.a.b}}` resolves from `AMBERCAST_SECRET_A_B`: dots become underscores and segments are uppercased. Configure an additional origin as in [Configure targets](/ambercast/how-to/configure-targets/) if the fill is not at `baseUrl`.

## Verification {#verification}

- After accepting consent or adding the allowlist entry, generation persists the Plan and records the name in `secrets.allow` when it was newly accepted.
- For one generation batch, Ambercast commits every newly accepted name to the allowlist once before writing any candidate's Plan or Grounding file. These are separate operations, not one transaction: if interruption or failure occurs after the allowlist commit, the allowlist remains on disk even when some or all candidate Plan and Grounding files were not written. This known, accepted state means `secrets.allow` can be ahead of generated artifacts; rerun `generate` to recover, which proceeds with the already-allowlisted names.
- If consent is declined or cannot be requested in a non-interactive terminal, generation fails with `SECRET_CONSENT_REQUIRED` and writes no candidate artifacts. Add the reviewed names to `secrets.allow`, then rerun generation.
- Run `npx ambercast run --resolve tests/ambercast/<name>.test.md` against a safe target with the required `AMBERCAST_SECRET_<NAME>` variables still in the command environment. A `fill-secret` resolves the named variable only after its live origin passes the sink-policy check.

## Related {#related}

Links: [Secrets in plans](/ambercast/spec/secrets/), [Environment variables](/ambercast/reference/environment-variables/), [Configuration](/ambercast/reference/configuration/), [Error codes](/ambercast/reference/error-codes/).
