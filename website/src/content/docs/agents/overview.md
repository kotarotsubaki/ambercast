---
title: Using ambercast from an AI agent
description: Operational reading order and bounded execution loop for AI agents using ambercast.
---

This guide defines the operational reading order, side effects, and action branching for AI agents using ambercast. The available CLI commands are `generate`, `run`, `check`, and `heal`.

## Read before acting {#read-before-acting}

AI-agent documentation defines reading order, side effects, and action branching; Reference owns exact specifications and How-to owns procedures. The available CLI commands are `generate`, `run`, `check`, and `heal`. Before changing a test asset, establish the minimum required context:

| Read | Reason |
| --- | --- |
| [Your first test in 5 minutes](/ambercast/tutorials/quick-start/) | Establishes the artifact loop and prerequisites. |
| [Operating contract](/ambercast/agents/operating-contract/) | Establishes side effects and approval boundaries. |
| [CLI overview](/ambercast/reference/cli/overview/) | Selects the exact command contract. |
| [Reports](/ambercast/reference/reports/) | Interprets structured output after a command. |

## Operate in a bounded loop {#bounded-loop}

The required basic agent loop is implement → write or adjust the requested `.test.md` → run → fix from the report. Generation derives provenance from normalized prompt text and selected targets, then constructs a plan and its adjacent grounding path. A fully grounded run can proceed without resolving an AI provider.

1. Implement the requested product change within the approved scope. → The implementation is ready for its requested test intent.
2. Write or adjust the requested `.test.md`. → The prompt expresses the behavior to verify.
3. Run the selected `.test.md` and read its structured result. → Use [Reports](/ambercast/reference/reports/) to interpret the envelope before choosing a next action.
4. Fix from the report, then repeat the selected loop as needed. → [Operating contract](/ambercast/agents/operating-contract/) owns approval boundaries and safe action branching; do not infer them from a result alone.

Links: [Setup prompt](/ambercast/agents/setup-prompt/), [Operating contract](/ambercast/agents/operating-contract/), [Reading structured output](/ambercast/agents/reading-structured-output/), [Machine-readable resources](/ambercast/agents/machine-readable-resources/), [Reports](/ambercast/reference/reports/)
