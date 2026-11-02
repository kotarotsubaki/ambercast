---
title: Exit codes
description: Process exit codes that ambercast returns, and the priority order that combines several outcomes into one code.
---

CI and scripts read the exit code to tell how a run ended. ambercast uses six codes, 0 to 5, and each has a priority rank.

## Exit-code table {#exit-code-table}

| code | meaning | priority (lower wins) |
| --- | --- | --- |
| 0 | success or no candidate | 5 |
| 1 | command-domain negative result | 3 |
| 2 | usage or configuration error | 0 |
| 3 | environment error | 1 |
| 4 | untrustworthy plan or grounding artifact | 2 |
| 5 | empty selection | 4 |

For example, [`PROMPT_PATH_INVALID`](/ambercast/reference/error-codes/#code-vocabulary) is a usage error and exits with 2.

## Aggregation priority {#aggregation-priority}

When a command has several outcomes, the code with the lowest priority rank wins. The order is 2 > 3 > 4 > 1 > 5 > 0.

The result does not depend on iteration order. With no candidate, the code is 0.

## Priority compatibility anchor {#priority}

This section keeps an older anchor alive. See [Aggregation priority](/ambercast/reference/exit-codes/#aggregation-priority) for the content.

## See also {#see-also}

- [Error codes](/ambercast/reference/error-codes/#code-vocabulary)
- [Reports](/ambercast/reference/reports/#envelope)
- [Troubleshoot common failures](/ambercast/how-to/troubleshoot/)
