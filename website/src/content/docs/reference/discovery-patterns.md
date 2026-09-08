---
title: Discovery patterns
description: Configured test file discovery matching rules, pattern grammar, and ordering.
---

Ambercast discovers test files using configured matching patterns and lexical ordering. Pattern matching evaluates relative paths against anchored expressions using two wildcard tokens: `*` and `**`.

## Pattern language {#pattern-language}

The implemented grammar has only two wildcard tokens, `*` and `**`; everything else is literal.

| Syntax | Exact meaning |
| --- | --- |
| `*` | Zero or more characters other than `/`, within one path segment (`[^/]*`). |
| `**/` | Zero or more complete path segments, including none (`(?:.*/)?`). |
| `**` not followed by `/` | Zero or more arbitrary characters, including `/` (`.*`). |
| Every other character | Literal text; regular-expression metacharacters are escaped. Character classes, braces, extglobs, and other general glob syntax have no special meaning. |
| Entire pattern | Matching is anchored with `^` and `$`; substrings do not count. |

## Selection {#selection}

| Stage | Contract |
| --- | --- |
| Include | A path must match at least one `testMatch` pattern. An empty `testMatch` selects nothing. |
| Exclude | A path matching any `testIgnore` is excluded even when it also matches `testMatch`. |
| Path form | The matcher receives `/`-separated POSIX paths relative to `testDir`, never absolute paths. |
| Ordering | Discovery skips non-files, deduplicates selected paths, and returns lexical sort order. |
| Missing root | A missing `testDir` yields an empty selection; other directory-read failures become `FsIoError`. |

The selected path order is the stable execution order supplied to consuming use cases.

## Defaults {#defaults}

Defaults first include `.test.md` prompts, then exclude run directories and both companion artifact suffixes.

| Key | Default patterns |
| --- | --- |
| `testMatch` | `["**/*.test.md"]` |
| `testIgnore` | `["**/.runs/**", "**/*.ambercast.plan.json", "**/*.ambercast.grounding.json"]` |

## Worked examples {#worked-examples}

| Pattern / configuration | Candidate | Result | Why |
| --- | --- | --- | --- |
| `**/*.test.md` | `login.test.md` | match | `**/` may span zero segments. |
| `**/*.test.md` | `nested/checkout.test.md` | match | `**/` spans the parent segment. |
| `ui/*.test.md` | `ui/auth/login.test.md` | no match | `*` cannot cross `/`. |
| `login.test.md` | `login.test.md.bak` | no match | The whole path must match. |
| include `**/*.test.md`; ignore `**/.runs/**` | `nested/.runs/cached.test.md` | no match | `testIgnore` wins after inclusion. |
| `{login,nested}/*.test.md` | `login/login.test.md` | no match | Braces are literal, not alternation. |

Links: [Configuration](/ambercast/reference/configuration/#key-table), [File layout](/ambercast/reference/file-layout/#companions), [Select which tests run](/ambercast/how-to/select-tests/).
