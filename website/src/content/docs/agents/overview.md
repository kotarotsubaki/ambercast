---
title: Using ambercast from an AI agent
description: Before an agent changes a test asset it reads four pages in order, then works in a loop of implement, write the prompt, run, and fix from the report.
---

This page tells an agent what to read before it starts and in what order to work. Agent pages own reading order, side effects, and action branching, Reference owns exact specifications, and How-to owns procedures.

## Read before acting {#read-before-acting}

The CLI has seven commands: `init`, `generate`, `run`, `check`, `heal`, `view`, and `mcp`. Before you change a test asset, read these four pages in order.

| Read | What you get |
| --- | --- |
| [Your first test in 5 minutes](/ambercast/tutorials/quick-start/) | The artifact loop and prerequisites |
| [Operating contract](/ambercast/agents/operating-contract/) | Side effects and approval boundaries |
| [CLI overview](/ambercast/reference/cli/overview/) | The exact contract of each command |
| [Reports](/ambercast/reference/reports/) | How to read the JSON report after a command |

Related: [Setup prompt](/ambercast/agents/setup-prompt/), [Reading structured output](/ambercast/agents/reading-structured-output/), [Machine-readable resources](/ambercast/agents/machine-readable-resources/)

## Work in a bounded loop {#bounded-loop}

The basic loop is implement, write or adjust the requested `.test.md`, run it, and fix from the report. Take approval boundaries from the operating contract, not from a single result.

1. Implement the requested product change within the approved scope.
2. Write or adjust the requested `.test.md` so the prompt states the behavior to verify.
3. Run that `.test.md` and read its JSON report.
4. Fix from the report, then run again if needed.

`run` needs a trusted plan, so `generate` comes first. `generate` writes the plan and grounding files beside the prompt. Replay with complete grounding makes no AI call. A grounding miss fails with exit 4 unless you pass `--resolve`.

Related: [Operating contract](/ambercast/agents/operating-contract/), [Reports](/ambercast/reference/reports/)
