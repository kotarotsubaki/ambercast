---
title: Manage secrets
description: Follow the safe authoring path to declare secrets in prompts and resolve them from environment variables.
---

Follow this safe authoring path to declare secret references in your test prompts and resolve them from environment variables like `AMBERCAST_SECRET_A_B`.

## Prerequisites {#prerequisites}

- A secret reference `{{secrets.a.b}}` resolves from `AMBERCAST_SECRET_A_B`.

## Steps {#steps}

1. Put exactly `@ambercast-secret {{secrets.password}}` on its own non-code prompt line. The grant parser accepts a complete matching line and excludes fenced, indented, and inline code.
2. Before the first `npx ambercast generate tests/ambercast/<name>.test.md`, have a human or an approved scanner confirm that the entire prompt contains no literal secret outside a SecretRef grant. `generate` sends the normalized prompt in its AI-provider context before it performs the literal-secret check; that check cannot protect a secret already sent in the prompt.
3. Set `AMBERCAST_SECRET_PASSWORD` in the command environment, then run `npx ambercast generate tests/ambercast/<name>.test.md`. Generation authorizes the prompt grant but does not construct a secrets provider or resolve its value.
4. Configure an additional origin as in [Configure targets](/ambercast/how-to/configure-targets/) if the fill is not at `baseUrl`. Missing mapping defaults to the base-URL origin.

## Verification {#verification}

- After generation, run `npx ambercast run tests/ambercast/<name>.test.md` against a safe target with the variable still in the command environment. Run constructs the environment secrets provider; a `fill-secret` resolves the named variable only after the live origin passes its sink-policy check.
- `npx ambercast generate --json tests/ambercast/<name>.test.md` must not return `SECRET_LITERAL_REJECTED`. This rejection inspects provider-derived generated JSON before persistence or report serialization; it protects the generated response, not the prompt that was already sent to the provider.

## Related {#related}

Links: [Secrets in plans](/ambercast/spec/secrets/), [Environment variables](/ambercast/reference/environment-variables/), [Configuration](/ambercast/reference/configuration/), [Error codes](/ambercast/reference/error-codes/).
