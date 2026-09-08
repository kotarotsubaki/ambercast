---
title: How ambercast compares
description: A comparison of ambercast's design model with code generation, record-and-replay frameworks, and direct-driving agents.
---

When you evaluate automated testing approaches, examining their underlying design models provides far more insight than comparing feature matrices or claiming feature parity. Where traditional code generation workflows record browser actions and generate code for an editor, ambercast normalizes prompt text, derives plan provenance, and constructs a validated PlanDocument. This approach stems from a design rationale that prioritizes test assets that are not locked to a particular tool.

## Code generation begins with recorded interaction {#code-generation-model}

In code generation workflows, the test asset originates from captured user interaction. Playwright documents codegen as recording browser actions and generating code for the user to copy into an editor. Under that model, your test asset is an executable script tied directly to the idioms and syntax of that specific runner.

ambercast structures generation around an intermediate artifact instead. Generation normalizes prompt text, derives plan provenance, and constructs a validated PlanDocument. The design rationale prioritizes test assets that are not locked to a particular tool, giving you a structured specification derived from your prompt rather than script code generated from a live recording session.

Links: [Philosophy](/ambercast/philosophy/), [Plan lifecycle and freshness](/ambercast/explanation/plan-lifecycle/)

## Recorded tests preserve observed interaction {#record-and-replay-model}

Record-and-replay tools preserve the exact actions performed during a browser session. Cypress documents Studio as recording real interactions and translating them into test commands. In this paradigm, the recorded script captures user interactions and converts them directly into test commands within a test suite.

In ambercast, intent and execution bindings operate under separate contracts. A PlanDocument records `inputsDigest` while grounding binds separately to `planDigest`, so their provenance contracts are distinct. This separation distinguishes the derived plan from the grounding that targets elements during execution.

Links: [Replay and grounding](/ambercast/explanation/replay-and-grounding/), [Philosophy](/ambercast/philosophy/)

## Direct-driving agents act from the current session {#direct-driving-agent-model}

Autonomous browser agents operate dynamically within an active browser session. In a general direct-driving-agent model, an agent may use screenshots and live tool calls without producing ambercast-equivalent committed plan and grounding artifacts, though whether this applies to a given agent product is not confirmed.

ambercast relies instead on reviewed, committed artifacts. Generated plans carry a producer-bundle fingerprint and normalized steps after schema validation. By producing and validating these normalized steps prior to execution, you work with inspectable artifacts governed by explicit schema validation and producer fingerprints.

Links: [Using ambercast from an AI agent](/ambercast/agents/overview/), [Trust and security](/ambercast/explanation/trust-and-security/)
