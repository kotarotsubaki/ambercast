---
title: How ambercast compares
description: ambercast keeps the natural-language prompt as the test and derives a reviewed plan from it, while other models keep a script or a live session.
---

Compare testing approaches by what each one keeps as the test asset, not by feature lists. ambercast keeps the prompt as the source and derives the plan from it. Code generation, record-and-replay, and direct-driving agents each keep something else.

## Code generation starts from recorded interaction {#code-generation-model}

In code generation, the test asset comes from captured interaction. Playwright documents codegen as recording browser actions and generating code to copy into an editor. The asset is then a script written for one runner.

ambercast puts an intermediate artifact in between. It normalizes the prompt, derives plan provenance, and builds a validated plan. The design favors assets that are not locked to a particular tool.

Related: [Philosophy](/ambercast/philosophy/), [Plan lifecycle and freshness](/ambercast/explanation/plan-lifecycle/)

## Record-and-replay keeps observed interaction {#record-and-replay-model}

Record-and-replay tools keep the actions performed in a browser session. Cypress documents Studio as recording real interactions and turning them into test commands. The recorded script becomes the asset inside the test suite.

ambercast keeps intent and element binding under separate contracts. The plan records `inputsDigest`, and grounding binds to `planDigest`. The derived plan and the grounding that locates elements can therefore change separately.

Related: [Replay and grounding](/ambercast/explanation/replay-and-grounding/), [Philosophy](/ambercast/philosophy/)

## Direct-driving agents act from the current session {#direct-driving-agent-model}

A direct-driving agent works inside a live browser session. It may act from screenshots and live tool calls, and it may leave no committed plan or grounding behind.

ambercast relies on reviewed, committed artifacts instead. A plan carries a producer-bundle fingerprint and schema-validated steps. Because ambercast builds and validates them before execution, you get artifacts you can read and inspect.

Related: [Using ambercast from an AI agent](/ambercast/agents/overview/), [Trust and security](/ambercast/explanation/trust-and-security/)
