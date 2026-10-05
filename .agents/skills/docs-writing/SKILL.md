---
name: docs-writing
description: Write and rewrite ambercast documentation-site body pages (en/ja/zh-cn) with the repository's sentence rules, tone, page skeletons, block primitives, and three-locale workflow. Use when drafting or revising a page under website/src/content/docs/.
---

# Docs Writing

## Sentence rules

Write one claim per sentence. Use active voice and name the actor — you, ambercast, the AI provider, or CI — instead of hiding it behind a passive construction; state a system's own result as a status rather than as something an unnamed agent did to it. Keep a paragraph to a few sentences; when a paragraph needs a further point, use a list or a table instead of extending it. Never use an internal implementation term in body prose — use only the commands, flags, filenames, and error codes a reader actually types or sees. Avoid vague pointers without a stated referent, parenthetical asides, double negatives, exaggerated claims, bold-label-plus-colon lists, and forced three-item groupings. `website/scripts/lib/prose-text.mjs` and `check-prose.mjs` mechanically enforce the countable parts of this (sentence length, paragraph length, passive-voice ratio); this section states the rest, which a machine check cannot.

## Tone (da-dearu)

Japanese body prose uses だ・である throughout a page — never です・ます, and never a mix of the two registers on the same page. `references/style-ja.md` tracks recurring AI-sounding patterns in Japanese writing, each rewritten as a だ・である example, so a draft can be checked against it before it ships. English prose follows `references/style-en.md`; Simplified Chinese prose follows `references/style-zh.md`.

## Page skeletons and required anchors

Two layers of authority apply here, and a writer should know which is which. Guidance, not machine-checked: a tutorial's skeleton is a lead, prerequisites, numbered steps, a verification step, and next steps; a how-to's skeleton is a lead, prerequisites, steps, verification, variations, and related links; the other page groups (reference, explanation, spec, agents, start-here) follow a lead-then-body-sections-then-related-links shape with no fixed section count. Machine-checked, and narrower: `website/prose-lint.json`'s `requiredAnchors` enforces only the tutorials group's prerequisites, steps, verification, and next-steps anchors, and the how-to group's prerequisites, steps, verification, and related anchors — `npm run check` fails a page in either group that is missing one of its own anchors, but it does not fail a page in another group for an informal skeleton deviation.

## Limits

`website/prose-lint.json`'s `limits` object is the only source of the actual numbers behind this repository's prose checks, and this section does not restate any of them, so the two can never drift apart. It constrains, by role: a ceiling on the count of level-three headings per page; a ceiling on the count of callouts per page; a warn/error pair for sentence length, set separately per locale and counted in words for English or in non-whitespace characters for Japanese and Simplified Chinese; a ceiling on the number of sentences per paragraph; a warning threshold for the ratio of passive-voice sentences; and a per-page-group word-count configuration, where crossing the configured value warns and crossing a further multiple of it errors — a page group without a configured value is not checked for length at all. Open that file directly rather than trusting a number copied into prose elsewhere.

## Blocks

`references/blocks.mdx` demonstrates every block family a page may use: a file tree, a `<Steps>` sequence (each step opens with its own heading, and a blank line separates the opening tag, each step, and the closing tag, so the parser reads the heading as its own block rather than text glued to a list item), tabs, annotated code fences (line markers, insertion/deletion markers, and a collapsible range), a badge, a link card, a collapsible details block, and a Mermaid diagram.

The four asides each have a distinct use: `note` adds background a reader can skip without losing the main thread; `tip` suggests an optional shortcut or a better way to do the same thing; `caution` flags a choice that is reversible but easy to get wrong; `danger` flags an action with an irreversible or security-relevant consequence (for example, writing a secret value directly instead of through a `{{secrets.*}}` reference). Reach for the least severe aside that still conveys the risk — `danger` is for the cases a reader could genuinely damage something, not for routine caveats.

Three `.mdx` escapes apply anywhere a page uses `.mdx`, all demonstrated in `blocks.mdx`: a `<Steps>` heading's anchor id is written with a backslash before the opening brace, as in `` \{#id} ``; a bare angle bracket in prose is written `` \< ``; a bare curly brace in prose is written `` \{ ``. Each needs the backslash only where it could otherwise be read as the start of JSX or an expression — inside a fenced code block or inline code span, none of this escaping applies. A horizontal rule is never used to separate sections — a heading and surrounding whitespace do that job instead.

## Diagrams

A diagram is written as a fenced Mermaid block carrying its own `alt` attribute, describing what the diagram shows for a reader who cannot see it. Running `npm run diagrams` from `website/` is the only supported way to produce the committed light and dark SVG pair for that fence; editing or adding an SVG by hand leaves it stale, and `check-diagrams.mjs` (wired into `npm run check`) catches that staleness, an orphaned SVG with no matching fence, and a fence missing its `alt` attribute.

## Terminology

Four terms are fixed across the Japanese and Simplified Chinese documentation trees, so a translator never re-derives their own rendering per page: plan is 計画 in Japanese and 执行计划 in Simplified Chinese; grounding is グラウンディング and 定位缓存; replay is 再生 and 回放; drift is ドリフト and 漂移.

## Three-locale workflow

A page is drafted and approved in Japanese first. English and Simplified Chinese versions are then written natively from that same factual skeleton, not produced as a literal, mechanical rendering of the Japanese draft or of one another. This is a statement about authoring method, not about the relationship between the published trees: the three locale trees remain each other's localized counterparts once a page has converged and shipped in all three, consistent with this repository's existing documentation-locale convention — the point of native authoring is that the result reads as if a fluent writer composed it directly in that language, not as if it were mechanically translated from another draft.

## Moving details

A detail removed from a Tutorial or How-to page during a rewrite must already exist in, or be added to, that topic's Reference or Troubleshooting material. Cutting a detail without relocating it is not an acceptable trim — a reader who needs that detail must still be able to find it somewhere in the site.

## Self-check

Before calling a draft done, run two commands from `website/`: `npm run check`, the full chained check covering parity, reference accuracy, claim accuracy, prose rules, and diagram freshness; and `node scripts/check-prose.mjs --report`, which prints the per-page prose table so a borderline page's exact numbers are visible even when the overall run is green.
