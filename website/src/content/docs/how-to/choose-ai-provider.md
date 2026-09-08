---
title: Choose an AI provider
description: Configure ambercast to use Claude, Codex, or automatic provider resolution for test generation.
---

ambercast allows you to select an AI provider for test generation, whether you need to pin a specific provider for reproducible runs or rely on automatic resolution when availability is your primary concern.

## Prerequisites {#prerequisites}

The `ai.provider` setting accepts `claude`, `codex`, or `auto`. When left unspecified, it defaults to `auto`.

## Steps {#steps}

### Pin a reproducible provider in configuration

When neither the `AMBERCAST_AI_PROVIDER` environment variable nor the `--ai` flag overrides it, put `{"$schema":"https://kotarotsubaki.github.io/ambercast/schemas/config.schema.json","ai":{"provider":"claude"}}` in `ambercast.config.json` to pin a reproducible provider. If Codex is your available choice, replace `claude` with `codex`.

This entry uses the published configuration Schema URL. Keep in mind that environment configuration overrides values in the file, and `--ai` overrides the resolved configuration.

### Use automatic resolution for availability

When neither override is set, omit `ai.provider` to use `auto` when availability matters more than selecting one fixed provider. Under `auto`, resolution probes Claude and then Codex, returning the first available provider.

### Override the provider via the CLI

To override the provider for a single command run, execute:

```bash
npx ambercast generate --ai codex
```

Accepted command overrides are `claude` and `codex`. Providing invalid provider text causes the command to exit `2`.

## Verification {#verification}

Run `npx ambercast generate --list` only to confirm prompt selection; this command returns before provider resolution occurs. To verify the selected provider, use a new, stale, or `--force` generation that reaches AI execution.

## Related {#related}

- [Configuration](/ambercast/reference/configuration/)
- [Environment variables](/ambercast/reference/environment-variables/)
- [ambercast generate](/ambercast/reference/cli/generate/)
