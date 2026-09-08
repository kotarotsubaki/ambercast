---
title: Philosophy
description: Explains the durable rationale and architectural principles behind ambercast.
---

This page explains the durable rationale behind ambercast. Tests are authored as natural-language Markdown prompts, establishing test assets that are independent of a particular execution tool. Ongoing AI progress is the reason this natural-language asset model is practical.

## Tests are assets without lock-in {#tests-without-lock-in}

Tests in ambercast are authored as natural-language Markdown prompts rather than script code. Under this approach, the intended test asset is independent of a particular execution tool. Rapid AI progress is the stated reason this natural-language asset model is practical, allowing test assets to remain durable and decoupled from underlying execution runners.

## The prompt is primary and the plan is derived {#prompt-primary-plan-derived}

The prompt is the source of truth, and the plan is subordinate. This architecture compares prompt intent to `package.json` and derived reproducibility to a lockfile: the prompt defines what you intend to verify, while the plan provides a concrete, repeatable execution path.

To keep this relationship transparent, normalization avoids trimming and broad cleanup so meaningful prompt changes remain visible during inspection and code review.

## Plans are meant to be scrapped and rebuilt {#scrap-and-build}

The ambercast model assumes frequent UI change in an AI-agent implementation loop. When coding agents update interfaces rapidly, plans should be discarded and regenerated rather than manually preserved.

Destructive plan-format changes and minor releases that require regeneration are explicitly permitted. For example, CHANGELOG 0.2.0 records a BREAKING producer-fingerprint change that made 0.1.0 plans stale and requires `ambercast generate` or `--force`. Rebuilding derived plans is the normal operational response when generator requirements update.

Links: [Upgrade between versions](/ambercast/how-to/upgrade/), [Changelog](/ambercast/reference/changelog/), [Freshness and digests](/ambercast/spec/freshness/).

## Five pains guide decisions {#five-pains}

Five top-level pains guide architectural decisions:

1. Fragile E2E tests.
2. Hard-to-understand test code.
3. Manual interaction effort.
4. Poor asset reuse.
5. Testing difficulty for vibe coders.

Focusing on these five pains keeps ambercast centered on reducing maintenance overhead and supporting developer workflows.

## Preserve intent and demote implementation detail {#preserve-intent}

The name ambercast evokes amber preserving form and casting intent.

Resolved implementation details are separated into grounding caches so prompt meaning can remain stable even as layout and DOM structures shift. At the architecture level, the repository schema boundary separates committed plan and grounding artifacts from an AI generator and replay runtime.

## Simple for non-engineers, rigorous for engineers {#simple-and-rigorous}

The intended visible surface is natural language and screenshots/results, keeping authoring and review approachable for non-engineers.

Behind that surface, concerns such as reproducibility, nondeterminism, and cost belong to the structured layer where engineers can inspect and measure them. The intermediate representation (IR) is intended to be readable without being required reading.

## Wrong passes are the greatest risk {#wrong-pass}

A test passing incorrectly is the greatest risk in this testing model. Assertion quality is prioritized to reduce that risk. For the same reason, CI defaults to failing rather than automatically healing.

## Coding agents are first-class users {#agents-first-class}

Coding agents are first-class users in ambercast. The CLI, MCP, and an official skill are the planned loop interfaces. Rather than duplicating specifications across different tools, the AI-agent group owns reading order and branching rather than duplicated specifications.

## BYOK and local execution {#byok-and-local}

AI execution follows a BYOK approach: it uses your Claude or Codex agreement and does not hold credentials. Automatic provider selection probes Claude before Codex. The local open-source CLI is positioned as free to run.
