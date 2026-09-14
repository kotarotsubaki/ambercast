---
title: エラーコード
description: ambercastのエラーコード体系、種別、スコープ、および終了コードのリファレンスです。
---

ambercastが定義する安定したエラーコードの語彙リファレンスです。各エラーコードの種別（kind）、スコープ、プロセス終了コード（exit）、および発生条件を規定します。

## コード語彙 {#code-vocabulary}

| code | kind | scope | exit | condition |
| --- | --- | --- | --- | --- |
| CONFIG_INVALID | usage | run/case | 2 | invalid configuration |
| PROMPT_PATH_INVALID | usage | run only | 2 | selected prompt path ineligible |
| SECRET_UNRESOLVED | usage | run/case | 2 | unresolved secret |
| TARGET_UNRESOLVED | usage | run/case | 2 | target cannot resolve |
| MISSING_PLAN | usage | run/case | 4 | plan absent |
| STALE_PLAN | usage | run/case | 4 | stale plan |
| INTEGRITY_VIOLATION | usage | run/case | 4 | artifact integrity fails |
| GROUNDING_UNRESOLVED | usage | case | 4 | `--resolve` なしのグラウンディングミス |
| SECRET_LITERAL_REJECTED | usage | run/case | 2 | literal secret rejected |
| SECRET_GRANT_UNATTRIBUTABLE | usage | run/case | 2 | grant cannot be attributed |
| SECRET_ENV_VAR_COLLISION | usage | case | 2 | 2つの secret が同じ環境変数名に投影される |
| SECRET_CONSENT_REQUIRED | usage | case | 2 | secret 名が許可リストにない |
| SECRET_SYNTAX_REJECTED | usage | case | 2 | レガシー grant 行または `{{secrets.*}}` 参照が見つかった |
| BROWSER_LAUNCH_FAILED | environment | run/case | 3 | browser launch fails |
| AI_EXECUTOR_UNAVAILABLE | environment | run/case | 3 | provider unavailable |
| AI_RESPONSE_INVALID | environment | run/case | 3 | provider response invalid |
| FS_IO_ERROR | environment | run/case | 3 | filesystem operation fails |
| UNEXPECTED_CRASH | environment | run/case | 3 | uncategorized crash |
| INTERRUPTED | environment | run only | 3 | batch cancellation |

利用エラー（usage）と環境エラー（environment）は独立したレポート語彙を持ち、各コードと種別（kind）のマッピングは `REPORT_ERROR_DETAILS` に集約されています。

caseスコープの `FS_IO_ERROR` には、`plan` や `grounding`（またはその両方）を含む `details.partiallyWritten` が含まれる場合があります。存在する場合、`AI_RESPONSE_INVALID` の details には正規化済み issue と任意の再試行履歴、`SECRET_LITERAL_REJECTED` の details には検出器・パス・任意の再試行履歴、`SECRET_ENV_VAR_COLLISION` の details には衝突した `envVar` と衝突した secret 参照の一覧、`SECRET_CONSENT_REQUIRED` の details には理由（`consent-required`・`declined`・`not-interactive` のいずれか）と、未解決の secret ごとの名前・step id・env var・理由、`SECRET_SYNTAX_REJECTED` の details にはレガシー構文の出現箇所の一覧（行・列、grant 行か参照かの種別）、`SECRET_GRANT_UNATTRIBUTABLE` の details には理由と安全な付与位置、`AI_EXECUTOR_UNAVAILABLE` の details には任意の再試行履歴、`BROWSER_LAUNCH_FAILED` の details には閉じた remediation 理由（`executable-missing`・`engine-unregistered`・`launch-failed` のいずれか）と解決済みエンジン名が入ります（固定の remediation hint はレポート直下の `hint` フィールドであり、details には含まれません）。`UNEXPECTED_CRASH` の details には許可リスト内の cause 名が入ります。コード別の完全な契約は [レポート](/ambercast/ja/reference/reports/#errors) を参照してください。

レポートの構造については [レポート](/ambercast/ja/reference/reports/#errors)、終了コードの一覧については [終了コード](/ambercast/ja/reference/exit-codes/#exit-code-table)、トラブルシューティングの手順については [一般的な障害のトラブルシューティング](/ambercast/ja/how-to/troubleshoot/) を参照してください。
