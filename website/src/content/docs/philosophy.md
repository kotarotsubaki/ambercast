---
title: Philosophy
description: The design decisions that follow from treating tests as assets, laid out in the order they build on each other.
---

As the previous page explained, ambercast started from a single point: turning AI-driven click-through testing into an asset. This page walks through the design decisions that follow from that point, in order.

## Tests must be assets {#tests-as-assets}

An asset is something that keeps its value after it is written. For a test to be an asset, it needs three properties: it resists breaking, it can be read, and it is not locked to a particular tool.

Traditional E2E tests fail all three. They break when a selector changes, the code is readable only to whoever wrote it, and switching frameworks means rewriting everything. Every decision in ambercast exists to satisfy these three properties.

## The prompt is primary, implementation detail is secondary {#intent-primary}

What holds lasting value in a test is the intent, what you want to verify, not the implementation detail of which element gets clicked. So in ambercast, the prompt written in natural language is the single source of truth, and the plan AI generates is derived from it.

This relationship resembles `package.json` and a lockfile: the prompt declares intent, the plan pins down repeatability. A human edits only the former; the latter is generated.

The prompt is left almost untouched. There is no whitespace normalization and no rewording, so that any change to intent shows up as a clear diff.

## Plans are meant to be thrown away and rebuilt {#plans-are-disposable}

If the plan is derived, an outdated plan can simply be discarded. ambercast does not protect plans as permanent artifacts: when the UI changes, the plan is rebuilt. Breaking changes to the plan format, and releases that require regeneration, are both acceptable.

Separating what must be protected from what can be discarded keeps the thing that matters, the stability of the prompt, as stable as possible.

## Simple on the surface, rigorous underneath {#simple-surface-rigorous-core}

An asset has to be readable. So the surface you see day to day is limited to three things: the natural-language prompt, screenshots, and run results. The goal is for a non-engineer to read those and understand what is being verified.

Underneath, the harder problems, repeatability, run-to-run variance, and the cost of AI calls, belong to the structured layer below. The plan generated in between is human-readable JSON, but you do not need to read it to use it. It guarantees transparency you can reach for when you want it, not transparency you must consume.

## The greatest risk is a wrong pass {#wrong-pass}

When you hand testing to AI, the greatest danger is a test that passes even though something is broken. AI is widely observed to be good at making tests pass but bad at keeping them meaningful. When you let AI fix a failing test, it can quietly weaken the assertion just to make it pass.

That is why ambercast prioritizes assertion quality above everything else, and why CI does not heal automatically by default. A break should fail loudly, and a human decides whether to fix it. Healing is run explicitly, and any rewrite is applied only after approval.

## Both humans and AI are readers {#humans-and-agents}

An asset's readers are not only human. Coding agents such as Claude Code and Codex read and write tests inside their own loop of implementing, testing, and fixing. ambercast treats agents as first-class users, and ships an official skill alongside the CLI, with an MCP server planned.

There is no separate specification written for agents. The same documentation is kept readable by both humans and agents.

## Assets stay on your own machine {#assets-stay-local}

If something is called an asset, it has to belong to the user. In ambercast, the prompt and the plan live inside the user's own repository, managed by git. Screenshots and run records also stay on the user's own machine. There is nothing ambercast holds on to.

Running AI uses the Claude or Codex agreement the user already has. ambercast never holds credentials, and it never covers the cost of AI usage on the user's behalf. The CLI is open source and runs entirely on the local machine.

There is a plan to offer a cloud version in the future, for team sharing and for offloading heavy work. Even then, the source of truth for these assets stays in the local repository. The cloud would be a feature built on top of it, not where the assets live.

## The standard for hard calls {#five-pains}

These principles were chosen to solve five problems: fragile E2E tests, unreadable test code, the effort of manual click-through testing, the difficulty of turning that effort into an asset, and how hard testing is for vibe coders. Whenever it is unclear whether to add a feature, ambercast returns to these five.

[The next page walks through how these principles actually play out, across the generate, run, and heal cycle.](/ambercast/how-it-works/)
