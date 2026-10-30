# Documentation writing workflow

## Brief

Before writing, record a short brief:

- Intended reader and prerequisite knowledge.
- What the reader should understand or be able to do afterwards.
- The page's main purpose.
- This change's scope and important facts to preserve.
- Related implementation, tests, specifications, and existing explanations.

If implementation and specification contradict each other, state the contradiction instead of choosing the convenient answer. Record evidence only for this change's important claims in the issue's existing plan file (`.claude/impl/issue-<N>-plan.md`, gitignored). Never create a permanent ledger duplicating every sentence of every page.

## Drafting

Write toward the reader's goal. Preserve useful existing text, the author's intent, deliberate metaphors, and voice. Keep Introduction's personal motivation instead of mechanically replacing it with a generic product introduction. Never invent numbers, examples, features, or guarantees to make prose sound natural. Keep negation and contrast needed to explain the specification. Shortening must preserve necessary detail; when moving it, verify the destination and the link the reader will follow. Use SKILL.md as the canonical source for style, terminology, structure, and limits.

## Review and revision

Give `docs-fact-reviewer` the before and after text and diff, related implementation, tests and specifications, and the intended reader and change purpose. It checks claims and preserved conditions against evidence.

Give `docs-reader` only the proposed public text, the contents of related public pages available to the actual reader, the reader profile, and a task. Never give it internal author notes, fact inventories, implementation, expected answers, or the fact reviewer's response. For example, ask it to explain what to prepare, what to run, and which result to check, marking missing information instead of guessing.

In Claude Code, invoke the Agent tool with `subagent_type: docs-fact-reviewer` or `subagent_type: docs-reader`. For the reader, write the public page text and related public pages into one bundle file in the session scratchpad; pass its path, the reader profile, and the task. Start a fresh, non-fork context without past responses or persistent memory, and check whether project instructions reveal answers. A Codex or other driver uses an equivalent fresh read-only reviewer with the same inputs and reader information boundary. If isolation cannot be confirmed, report a reader simulation and its limits, never a verified first-time reader check.

Both agents return findings only; the writer decides what to accept and edits the text. They never replace the implementation flow's independent reviews. Fix specifically identified passages instead of regenerating the whole page after each review. Re-check the claims and steps each fix touched. Allow at most one review round per reviewer plus one re-check; list unresolved items in the PR or plan.

## Three locales

Draft and obtain approval in Japanese first, using the existing だ・である register and the fixed terminology in [SKILL.md](../SKILL.md#terminology). Write English and Simplified Chinese natively from the same factual skeleton, adjusting explanation order and expression for each language. Keep features, conditions, exceptions, commands, and link-target meanings aligned across all three. Keep internal evidence notes and review records out of public text.

## Light path

Typo, punctuation, broken-link, and formatting fixes with unchanged meaning and structure need no reviews. Run `npm run check:changed` for the touched pages before finishing.

## Generated pages

English spec pages under `website/src/content/docs/spec/` are generated at build time from `docs/spec/*.md` and are gitignored: edit `docs/spec`. Japanese and Simplified Chinese spec pages are committed and edited directly. Never hand-edit generated output. Generate diagram SVGs with `npm run diagrams` from `website/`.

## Check commands and exit codes

Run these commands from `website/`. Prose checker warnings never fail. For direct `node scripts/check-prose.mjs` invocations, exit 2 means a usage, configuration, I/O, tool, or preview-residue failure, including invalid or unknown page slugs, an unresolved base, or spec-generation failure where applicable; it leaves stdout empty and prints one diagnostic to stderr. npm wrappers print their own script banners, so the empty-stdout guarantee does not apply to them. For `npm run check`, a non-zero exit comes from whichever chained check failed; each check has its own exit codes.

| Command | Selection and output | Exit 0 | Exit 1 | Exit 2 |
| --- | --- | --- | --- | --- |
| `npm run check` | Chains parity, reference, claims, prose for `prose-lint.json` pages only, and diagram presence/orphan/alt checks; no SVG content comparison | All chained checks pass | Determined by the failed check's own exit codes | Determined by the failed check's own exit codes |
| `npm run check:changed [-- --base <ref>]` | Defaults to `origin/main`; compares against the merge base, including committed, staged, unstaged, and untracked changes; emits only new findings | No new errors, including no changed docs | New errors relative to base | Cannot complete as described above |
| `node scripts/check-prose.mjs --page <slug>` | Repeatable; locale-independent slug without extension; checks named pages in all locales and emits JSONL | No errors | Any error on named pages | Cannot complete as described above |
| `node scripts/check-prose.mjs --report` | Aggregate Markdown table for every page | Always for completed reports, regardless of findings | Never | Cannot complete as described above |

CI wiring of `check:changed` is pending a separate workflow change. Run it locally before finishing. Mechanical checks cannot judge meaning, facts, or reader usefulness; use the reviews above.
