---
title: Prompt file format
description: Exact file identity, normalization rules, secret grant extraction, and secret reference syntax for ambercast test prompts.
---

Ambercast test prompts define end-to-end test cases in natural language. This reference specifies the exact file identity rules, source normalization transformations, secret grant extraction behavior, and secret reference patterns enforced by the layout resolver and parser.

## File identity {#file-identity}

| Condition | Enforced result |
| --- | --- |
| Path is inside `testDir`, ends in `.test.md`, and has a nonempty name before the suffix. | The layout resolver can derive plan, grounding, and case paths. |
| Path is outside `testDir`, has another suffix, or is the bare filename `.test.md`. | Forward layout resolution rejects it with `RangeError`. |

File discovery is controlled by `testMatch` and `testIgnore`. The `.test.md` suffix is an exact source suffix required by the layout resolver, not a general Markdown parser rule. For pattern configuration details, see [Discovery patterns](/ambercast/reference/discovery-patterns/#selection).

## Normalization and grants {#normalization-and-grants}

Before extraction, test prompt sources undergo strict normalization:

| Operation | Exact rule |
| --- | --- |
| Leading BOM | Remove at most one leading U+FEFF; preserve a second leading U+FEFF and any U+FEFF elsewhere. |
| Line endings | Convert each CRLF and lone CR to one LF. |
| Everything else | Preserve it: no trimming, whitespace collapsing, reordering, rewording, or other transformation. |

Grant extraction receives normalized Markdown and returns grants in source order. A candidate line is excluded when its physical source range overlaps a CommonMark fenced-code, indented-code, or inline-code node. Each returned grant preserves raw line text, zero-based UTF-16 start/exclusive-end offsets, and one-based physical line numbers.

When an identical citation occurs two or more times, attribution resolves its occurrences in document order only when every occurrence uniquely brackets a distinct matching grant; otherwise it fails with `citation-not-unique`.

Grant lines matching the `@ambercast-secret` pragma are evaluated using the following regular expression construction:

```ts
new RegExp(`^[ \\t]*@ambercast-secret[ \\t]+(${SECRET_REF_SOURCE})[ \\t]*$`)
```

## Secret references {#secret-references}

Secret references identify credential slots within secret grants and schema fields:

| Symbol | Verbatim implementation | Meaning |
| --- | --- | --- |
| `SECRET_REF_SOURCE` | `\\{\\{secrets\\.[A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)*\\}\\}` | One or more dot-separated ASCII alphanumeric/underscore segments after `secrets.`. |
| `SECRET_REF_PATTERN` | `new RegExp(\`^${SECRET_REF_SOURCE}$\`)` | A secret-bearing schema field accepts the reference only as its entire value. |

Surrounding prose is not accepted by `SecretRef`; whole-value anchoring enforced by `SECRET_REF_PATTERN` keeps secret-bearing fields unambiguous. A valid reference such as `{{secrets.name}}` must occupy the entire field value rather than being embedded alongside prose.

## Terminal assertions and instruction coverage {#terminal-assertions-and-instruction-coverage}

Each terminal success assertion must be covered by its instruction. URL arrival alone is not terminal proof; state a heading, message, or element that is visible at the destination.

> …I reach the dashboard and see the heading "Welcome back".

## Literal-secret rejection {#literal-secret-rejection}

The canonical detector contract is defined in [Secrets in plans](/ambercast/spec/secrets/#literal-secret-rejection).

Before persistence or report serialization, generated or provider-derived JSON is checked by the literal-secret policy. A detected value produces `SecretLiteralRejectedError` without retaining the literal in diagnostics.

This generated-plan policy does not reject arbitrary prompt prose merely because it contains credential-like text.

### Related documentation

- Selection and discovery patterns: [Discovery patterns](/ambercast/reference/discovery-patterns/#selection)
- Secret environment variables: [Environment variables](/ambercast/reference/environment-variables/#secrets)
- Authoring guidelines: [Write effective prompts](/ambercast/how-to/write-effective-prompts/)
- Managing secrets: [Manage secrets](/ambercast/how-to/manage-secrets/)
- Secrets specification: [Secrets in plans](/ambercast/spec/secrets/)
