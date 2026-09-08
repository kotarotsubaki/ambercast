---
title: エラーコード
description: ambercastのエラーコード体系、種別、スコープ、および終了コードのリファレンスです。
---

ambercastが定義する安定したエラーコードの語彙リファレンスです。各エラーコードの種別（kind）、スコープ、プロセス終了コード（exit）、および発生条件を規定します。

## コード語彙 {#code-vocabulary}

| code | kind | scope | exit | condition |
| --- | --- | --- | --- | --- |
| CONFIG_INVALID | usage | run/case | 2 | invalid configuration |
| SECRET_UNRESOLVED | usage | run/case | 2 | unresolved secret |
| TARGET_UNRESOLVED | usage | run/case | 2 | target cannot resolve |
| MISSING_PLAN | usage | run/case | 4 | plan absent |
| STALE_PLAN | usage | run/case | 4 | stale plan |
| INTEGRITY_VIOLATION | usage | run/case | 4 | artifact integrity fails |
| SECRET_LITERAL_REJECTED | usage | run/case | 2 | literal secret rejected |
| SECRET_GRANT_UNATTRIBUTABLE | usage | run/case | 2 | grant cannot be attributed |
| BROWSER_LAUNCH_FAILED | environment | run/case | 3 | browser launch fails |
| AI_EXECUTOR_UNAVAILABLE | environment | run/case | 3 | provider unavailable |
| AI_RESPONSE_INVALID | environment | run/case | 3 | provider response invalid |
| FS_IO_ERROR | environment | run/case | 3 | filesystem operation fails |
| UNEXPECTED_CRASH | environment | run/case | 3 | uncategorized crash |
| INTERRUPTED | environment | run only | 3 | batch cancellation |

利用エラー（usage）と環境エラー（environment）は独立したレポート語彙を持ち、各コードと種別（kind）のマッピングは `REPORT_ERROR_DETAILS` に集約されています。

caseスコープの `FS_IO_ERROR` には、`plan` や `grounding`（またはその両方）を含む `details.partiallyWritten` が含まれる場合があります。

レポートの構造については [レポート](/ambercast/ja/reference/reports/#errors)、終了コードの一覧については [終了コード](/ambercast/ja/reference/exit-codes/#exit-code-table)、トラブルシューティングの手順については [一般的な障害のトラブルシューティング](/ambercast/ja/how-to/troubleshoot/) を参照してください。
