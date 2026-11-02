---
title: Discovery patterns
description: Pattern grammar, selection stages, defaults, and ordering that decide which test prompts ambercast discovers.
---

ambercast matches `testMatch` and `testIgnore` patterns against paths relative to `testDir`. The pattern language has two wildcards, `*` and `**`.

## Pattern language {#pattern-language}

The grammar has only the wildcards below. Every other character is literal.

| syntax | meaning |
| --- | --- |
| `*` | Zero or more characters other than `/`, within one path segment (`[^/]*`). |
| `**/` | Zero or more whole path segments, including none (`(?:.*/)?`). |
| `**` not followed by `/` | Zero or more characters of any kind, including `/` (`.*`). |
| every other character | Literal text. Character classes, braces, extglobs, and other glob syntax have no special meaning. |
| the whole pattern | Anchored at both ends. A match on a substring does not count. |

## Selection {#selection}

| stage | rule |
| --- | --- |
| include | A path must match at least one `testMatch` pattern. An empty `testMatch` selects nothing. |
| exclude | A path that matches any `testIgnore` pattern is excluded, even when it also matches `testMatch`. |
| path form | The matcher receives `/`-separated POSIX paths relative to `testDir`, never absolute paths. |
| order | Discovery skips anything that is not a file, removes duplicates, and sorts the paths lexically. |
| missing root | A missing `testDir` gives an empty selection. Any other read failure becomes `FsIoError`, reported as `FS_IO_ERROR`. |

The sorted order is the stable execution order that commands use.

To keep a prompt out of normal discovery and still run it, exclude it with `testIgnore` and pass its literal path. `--list` does no eligibility validation on any selection.

## Defaults {#defaults}

By default, ambercast includes `.test.md` prompts and excludes run directories and both companion file suffixes.

| key | default patterns |
| --- | --- |
| `testMatch` | `["**/*.test.md"]` |
| `testIgnore` | `["**/.runs/**", "**/*.ambercast.plan.json", "**/*.ambercast.grounding.json"]` |

## Worked examples {#worked-examples}

| pattern or configuration | candidate | result | reason |
| --- | --- | --- | --- |
| `**/*.test.md` | `login.test.md` | match | `**/` can span zero segments. |
| `**/*.test.md` | `nested/checkout.test.md` | match | `**/` spans the parent segment. |
| `ui/*.test.md` | `ui/auth/login.test.md` | no match | `*` cannot cross `/`. |
| `login.test.md` | `login.test.md.bak` | no match | The whole path must match. |
| include `**/*.test.md`, ignore `**/.runs/**` | `nested/.runs/cached.test.md` | no match | `testIgnore` wins after inclusion. |
| `{login,nested}/*.test.md` | `login/login.test.md` | no match | Braces are literal, not alternation. |

## See also {#see-also}

- [Configuration](/ambercast/reference/configuration/#key-table)
- [File layout](/ambercast/reference/file-layout/#companions)
- [Select which tests run](/ambercast/how-to/select-tests/)
