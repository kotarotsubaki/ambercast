---
title: Exit codes
description: Process exit codes and aggregation priority for machine-facing status in ambercast.
---

ambercast conveys machine-facing process status through numeric exit codes. If you need troubleshooting steps, consult [Troubleshoot common failures](/ambercast/how-to/troubleshoot/). To inspect specific error codes and their programmatic definitions, see [Error codes](/ambercast/reference/error-codes/#code-vocabulary), and to inspect structured execution output, see [Reports](/ambercast/reference/reports/#envelope).

## Exit-code table {#exit-code-table}

| code | meaning | priority |
| --- | --- | --- |
| 0 | success or no candidate | 5 |
| 1 | command-domain negative result | 3 |
| 2 | usage or configuration error | 0 |
| 3 | environment error | 1 |
| 4 | untrustworthy plan or grounding artifact | 2 |
| 5 | empty selection | 4 |

## Aggregation priority {#aggregation-priority}

When aggregating exit codes across multiple outcomes, lower rank wins, establishing 2 > 3 > 4 > 1 > 5 > 0.

Selection is independent of iteration order and returns 0 for no candidate.

## Priority compatibility link {#priority}

This section preserves a compatibility anchor; see [Exit codes](/ambercast/reference/exit-codes/#aggregation-priority).
