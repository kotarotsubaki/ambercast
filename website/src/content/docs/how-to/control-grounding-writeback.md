---
title: Control grounding write-back
description: Configure how Ambercast writes back changed grounding caches locally and in CI.
---

When test execution produces updated selectors or cache entries, Ambercast allows you to control how those changed grounding caches persist to disk. You can configure write-back to persist changes automatically during local runs, require explicit CLI approval before saving updates, or maintain write-back protection in CI environments.

## Prerequisites {#prerequisites}

Before adjusting your write-back settings, ensure your configuration uses the supported types:

- `grounding.localWriteBack` accepts `auto` or `explicit`.
- `ci.updateGroundingCache` is a boolean.

## Steps {#steps}

### 1. Configure automatic local persistence

For local automatic persistence, configure your settings using the published configuration Schema URL:

```json
{"$schema":"https://kotarotsubaki.github.io/ambercast/schemas/config.schema.json","grounding":{"localWriteBack":"auto"}}
```

Setting `grounding.localWriteBack` to `auto` reflects the default local posture.

### 2. Configure review-first local persistence

For review-first local persistence, set `localWriteBack` to `explicit`:

```json
{
  "grounding": {
    "localWriteBack": "explicit"
  }
}
```

Then run the test with the `--update-cache` flag:

```bash
npx ambercast run --update-cache tests/ambercast/<name>.test.md
```

The parser passes the explicit request to runtime to persist the cache updates.

### 3. Maintain default protection in CI

For CI, leave `ci.updateGroundingCache` false and omit `--update-cache`. CI defaults to no write-back opt-in.

## Verification {#verification}

Run your tests with JSON output:

```bash
npx ambercast run --json tests/ambercast/<name>.test.md
```

Expect exit `0` only for a passed batch and inspect the grounding diff before committing it.

## Related {#related}

- [Configuration](/ambercast/reference/configuration/)
- [ambercast run](/ambercast/reference/cli/run/)
- [Review generated diffs](/ambercast/how-to/review-generated-diffs/)
