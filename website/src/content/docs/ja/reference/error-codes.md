---
title: エラーコード
description: 安定したエラーコードの種別・スコープ・終了コードと、各コードの details に入る内容を示すリファレンス。
---

ambercast は、実行単位とケース単位の失敗を、固定のエラーコードで報告する。コードの意味と、対応する終了コードはここで確認できる。

## コード一覧 {#code-vocabulary}

利用エラーと環境エラーは、別々の語彙を持つ。`SECRET_GRANT_UNATTRIBUTABLE` は旧版の例外である。旧版のレポートとの互換のためだけにレポートのコードスキーマに残っており、現在のエラー種別やレポートの分岐はこれを出力しない。

| コード | 種別 | スコープ | 終了コード | 条件 |
| --- | --- | --- | --- | --- |
| CONFIG_INVALID | usage | run/case | 2 | 設定が不正である |
| PROMPT_PATH_INVALID | usage | run only | 2 | 選んだプロンプトのパスが条件を満たさない |
| SECRET_UNRESOLVED | usage | run/case | 2 | シークレットが未解決である |
| TARGET_UNRESOLVED | usage | run/case | 2 | ターゲットを解決できない |
| EXECUTOR_UNSUPPORTED | usage | case | 2 | 計画（plan）が必要とする機能またはサーフェスを実行器が持たない |
| PROMPT_AMBIGUOUS | usage | case | 2 | 生成した応答にターゲットの曖昧さが残っている |
| MISSING_PLAN | usage | run/case | 4 | 計画がない |
| STALE_PLAN | usage | run/case | 4 | 計画が古い |
| INTEGRITY_VIOLATION | usage | run/case | 4 | 成果物の整合性の検証に失敗した |
| GROUNDING_UNRESOLVED | usage | case | 4 | `--resolve` なしで、ai ステップまたは要素ステップのグラウンディングがミスした。ほかの 4 つの理由は `--resolve` を付けても起こりうる |
| SECRET_LITERAL_REJECTED | usage | run/case | 2 | リテラルのシークレットを拒否した |
| SECRET_GRANT_UNATTRIBUTABLE | legacy | not producible | — | 旧版ツールのレポートとの後方互換のためにレポートのスキーマに残している。現在の `generate`、`run`、`heal`、`check` は出力しない |
| SECRET_ENV_VAR_COLLISION | usage | case | 2 | 複数のシークレットが同じ環境変数名になった |
| SECRET_CONSENT_REQUIRED | usage | case | 2 | シークレットの同意が必要である |
| SECRET_SYNTAX_REJECTED | usage | case | 2 | 旧形式のシークレット構文を拒否した |
| BROWSER_LAUNCH_FAILED | environment | run/case | 3 | ブラウザーの起動に失敗した |
| AI_EXECUTOR_UNAVAILABLE | environment | run/case | 3 | AI プロバイダーを利用できない |
| AI_RESPONSE_INVALID | environment | run/case | 3 | AI プロバイダーの応答が不正である |
| AGENTIC_STEP_FAILED | environment | case | 3 | AI 主導の操作が失敗を宣言した |
| CASE_ABORTED | environment | case | 3 | 呼び出し側で直せる原因または環境の原因で、ケースがステップの途中で中断した |
| FS_IO_ERROR | environment | run/case | 3 | ファイルシステムの操作に失敗した |
| UNEXPECTED_CRASH | environment | run/case | 3 | 分類できないクラッシュが起きた |
| INTERRUPTED | environment | run only | 3 | バッチが取り消された |

### AI 応答の問題コード {#ai-response-issue-codes}

生成した `confirms` の参照が検証に失敗すると、次の `AiResponseIssueCode` の値が `AI_RESPONSE_INVALID` の再試行とレポートの問題に現れる。`confirms-unsorted` は内部用であり、再試行のフィードバックには現れない。

| コード | 条件 |
| --- | --- |
| `confirms-unknown-step` | 参照したステップ ID が存在しない |
| `confirms-not-earlier` | 参照先が同じステップか、それより後のステップである |
| `confirms-not-action` | 参照先が、対象になる操作またはキャプチャーではない |
| `confirms-duplicate` | 参照したステップ ID が重複している |

## コードごとの details {#details}

`details` を持つのは、次のコードだけである。各コードの完全な契約は[レポート](/ambercast/ja/reference/reports/#errors)を参照する。

| コード | `details` の内容 |
| --- | --- |
| `FS_IO_ERROR` | ケースのスコープでは、`plan` と `grounding` の一方または両方を持つ `details.partiallyWritten` を含むことがある。 |
| `AI_RESPONSE_INVALID` | 正規化した問題と、任意の再試行の記録。 |
| `SECRET_LITERAL_REJECTED` | 検出器、パス、任意の試行の記録。 |
| `SECRET_ENV_VAR_COLLISION` | 衝突した `envVar` と、衝突したシークレット参照の一覧。 |
| `SECRET_CONSENT_REQUIRED` | 理由（`consent-required`、`declined`、`not-interactive`）と、未解決のシークレットの一覧。各項目に名前、ステップ ID、環境変数、理由を持つ。 |
| `SECRET_SYNTAX_REJECTED` | 拒否した旧形式の構文の各出現箇所。行、列、および許可行か参照かの別。 |
| `AI_EXECUTOR_UNAVAILABLE` | 任意の試行の記録。 |
| `BROWSER_LAUNCH_FAILED` | 閉じた集合の対処理由（`executable-missing` または `launch-failed`）と、解決したエンジン名。固定の対処ヒントはレポート直下の `hint` フィールドにあり、`details` には含まれない。 |
| `AGENTIC_STEP_FAILED` | ステップ ID、完了したツール呼び出しの回数、任意の最後に失敗したアサーション。 |
| `CASE_ABORTED` | 閉じた集合の中断理由とステップ ID。 |
| `PROMPT_AMBIGUOUS` | 未解決の曖昧さの数。 |
| `UNEXPECTED_CRASH` | 許可リストに含まれる原因名。 |
| `EXECUTOR_UNSUPPORTED` | ターゲット、実行器、理由（`surface-mismatch` または `capability-missing`）、不足している機能、任意でサーフェス。 |
| `PROMPT_PATH_INVALID` | パスと理由（`outside-test-dir`、`not-test-md`、`no-name` のいずれか）。 |
| `GROUNDING_UNRESOLVED` | ステップ ID と理由（`missing`、`recoverable-miss`、`no-candidate`、`ambiguous`、`proposal-rejected`、`candidate-changed` のいずれか）。 |

## 関連項目 {#see-also}

- [レポート](/ambercast/ja/reference/reports/#errors)
- [終了コード](/ambercast/ja/reference/exit-codes/#exit-code-table)
- [よくある失敗のトラブルシューティング](/ambercast/ja/how-to/troubleshoot/)
