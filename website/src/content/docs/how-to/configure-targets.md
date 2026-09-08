---
title: Configure targets
description: Configure targets, replay isolation, and secret sink origins in ambercast.
---

Configure targets in ambercast. A present config file requires a string `$schema`.

## Prerequisites {#prerequisites}

- A present config file requires a string `$schema`.

## Steps {#steps}

1. Write `{"$schema":"https://kotarotsubaki.github.io/ambercast/schemas/config.schema.json","targets":{"staging":{"baseUrl":"https://staging.example.test","browser":"chromium"},"admin":{"baseUrl":"https://admin.example.test","browser":"chromium"}},"defaultTarget":"staging"}`. This is the published configuration Schema URL; `targets` and `defaultTarget` have an accepted config shape.
2. Add `"healReplayIsolation":"idempotent"` only to a disposable target. The accepted isolation values are `idempotent` and `stateful`; the default value of `healReplayIsolation` is `stateful`.
3. Add `"secretSinkOrigins":{"{{secrets.password}}":["https://login.example.test","https://admin.example.test"]}` when a secret may be filled away from `baseUrl`. `secretSinkOrigins` maps each secret reference to its allowed-origin array; a configured mapping replaces the default origin policy (the base-URL origin), and each origin is normalized.

## Verification {#verification}

- Run `npx ambercast check --target staging --list`; expect exit `0` and `listed` results, with no artifact inspection.

## Related {#related}

Links: [Configuration](/ambercast/reference/configuration/), [ambercast check](/ambercast/reference/cli/check/), [ambercast heal](/ambercast/reference/cli/heal/), [Secrets in plans](/ambercast/spec/secrets/), [Healing a test after a UI change](/ambercast/tutorials/repair-your-first-drift/).
