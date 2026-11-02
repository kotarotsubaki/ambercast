---
title: Prompt file format
description: Which files ambercast treats as test prompts, how it normalizes them, and how prompts and plans handle secret references.
---

A test prompt is a Markdown file that describes one end-to-end test case in natural language.

## File identity {#file-identity}

| condition | result |
| --- | --- |
| The path is inside `testDir`, ends in `.test.md`, and has a nonempty name before the suffix. | The layout derives the plan, grounding, and case paths. |
| The path is outside `testDir`, has another suffix, or is the bare filename `.test.md`. | The command stops with `PROMPT_PATH_INVALID` (exit 2). |

The `details.reason` field of that error is `outside-test-dir`, `not-test-md`, or `no-name`. `--list` does no eligibility validation, so it never raises this error. See [Reports](/ambercast/reference/reports/#errors) for the error contract.

`testMatch` and `testIgnore` control which files discovery finds. The `.test.md` suffix is an exact requirement of the layout, not a general Markdown rule. For pattern details, see [Discovery patterns](/ambercast/reference/discovery-patterns/#selection).

## Normalization {#normalization}

ambercast normalizes a prompt before it extracts anything from it.

| operation | rule |
| --- | --- |
| leading BOM | Remove at most one leading U+FEFF. A second leading U+FEFF and any U+FEFF elsewhere stay. |
| line endings | Convert each CRLF and each lone CR to one LF. |
| everything else | Keep it as is. ambercast does not trim, collapse whitespace, reorder, or reword. |

## Secret references {#secret-references}

After you consent to a proposed secret name, `generate` writes a secret reference such as `{{secrets.name}}` into the `secretRef` fields of the plan. A prompt never contains one. ambercast rejects a prompt that has `{{secrets.` outside code spans and code blocks with `SECRET_SYNTAX_REJECTED`, as [Legacy secret syntax](#legacy-secret-syntax) explains.

| symbol | definition | meaning |
| --- | --- | --- |
| `SECRET_REF_SOURCE` | `\{\{secrets\.[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*\}\}` | `secrets.` followed by one or more dot-separated segments of ASCII letters, digits, and underscores. |
| `SECRET_REF_PATTERN` | `SECRET_REF_SOURCE` anchored at both ends | A secret-bearing field accepts a reference only as its entire value. |

Surrounding text is not accepted. A valid reference must fill the whole field value.

## Legacy secret syntax {#legacy-secret-syntax}

Older prompts could contain a grant line such as this one:

```markdown
@ambercast-secret {{secrets.password}}
```

ambercast no longer accepts this syntax. Remove every such line, then follow [Migrate secret grants](/ambercast/how-to/upgrade/#migrate-secret-grants). The current consent and allowlist model is in [Secrets in plans](/ambercast/spec/secrets/).

## Terminal assertions and instruction coverage {#terminal-assertions-and-instruction-coverage}

Each terminal success assertion must be covered by its instruction. Arriving at a URL is not proof by itself. State a heading, message, or element that is visible at the destination.

> …I reach the dashboard and see the heading "Welcome back".

## Literal-secret rejection {#literal-secret-rejection}

Before persistence or report serialization, ambercast checks generated or provider-derived JSON against the literal-secret policy. A detected value is rejected with `SECRET_LITERAL_REJECTED`, and the literal is not kept in diagnostics.

The one exception is an item in the provider's `assumptions` list. When it matches secret detection, ambercast replaces it with a generic message and continues instead of failing with `SECRET_LITERAL_REJECTED`. The policy does not reject prompt prose for containing text that looks like a credential. The detector contract is in [Secrets in plans](/ambercast/spec/secrets/#literal-secret-rejection).

## See also {#see-also}

- [Discovery patterns](/ambercast/reference/discovery-patterns/#selection)
- [Environment variables](/ambercast/reference/environment-variables/#secrets)
- [Write effective prompts](/ambercast/how-to/write-effective-prompts/)
- [Manage secrets](/ambercast/how-to/manage-secrets/)
- [Secrets in plans](/ambercast/spec/secrets/)
