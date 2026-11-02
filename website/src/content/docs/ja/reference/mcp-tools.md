---
title: MCP ツール
description: ambercast の MCP ワークフローにおけるツール、入力、結果、エラーの規約。
---

MCP サーバーは `ambercast_generate`、`ambercast_run`、`ambercast_check`、`ambercast_heal`、`ambercast_job_status`、`ambercast_job_cancel` の順で6つのツールを公開する。ツール名は ambercast プレフィックスと snake_case を使う。サーバーはすべての CLI コマンドを複製しない。

## ツール一覧 {#tool-table}

アノテーションは readOnly / destructive / idempotent / openWorld の順で並ぶ。4値をすべて明示するが、認可ではなくヒントである。generate の冪等ヒントは弱い意味を持つ。最新の計画（plan）はスキップされ、効果は収束する。ただし AI 出力は変動し得る。

| ツール | 対応 CLI | アノテーション | `isError: true` | `isError: false` の負の結果 |
| --- | --- | --- | --- | --- |
| `ambercast_generate` | generate | false / false / true（弱）/ false | exit 2（`PROMPT_AMBIGUOUS` 含む）・3 | exit 5 |
| `ambercast_run` | run | false / false / false / true | exit 2・3・4（MISSING_PLAN / STALE_PLAN / INTEGRITY_VIOLATION / GROUNDING_UNRESOLVED） | exit 1（assertion red）、exit 5 |
| `ambercast_check` | check | true / false / true / false | exit 2・3 | exit 4（stale は results[].status の正常な結果）、exit 5 |
| `ambercast_heal` | heal | false / true / false / true | exit 2（CI 拒否と `PROMPT_AMBIGUOUS` を含む）・3・4、`HEAL_APPLY_TOKEN_INVALID`、`HEAL_APPLY_FAILED` | exit 1（未解決・拒否）、exit 5 |
| `ambercast_job_status` | — | true / false / true / false | `JOB_NOT_FOUND`、failed 時の `JOB_FAILED`、結果のある completed または cancelled は元ツールの写像 | 非終端の record、一覧、queued cancel の record |
| `ambercast_job_cancel` | — | false / false / true / false | `JOB_NOT_FOUND` | — |

`isError` はレポートの集約済み exit code で決まる。サーバーは個別の report error を再分類しない。heal は Claude Code 用の対話ヒントも設定するが、このヒントは承認の証拠ではない。

## 入力 {#inputs}

入力は strict object である。不明なキー、型の不一致、refine 違反は、SDK の `Input validation error` と `isError: true` になる。引数がない場合は `{}` を渡す。

| 範囲 | プロパティと既定値 |
| --- | --- |
| 共通 | `files?: string[]`（省略と `[]` はともに config discovery を選ぶ。相対パスは session root 基準）、`allowEmpty?: boolean`（false） |
| `ambercast_generate` | `target?: string`（ジェネレーターが利用できる Target 定義を制限する）、`force?: boolean`（false）、`dryRun?: boolean`（false）、`ai?: 'claude' \| 'codex'` |
| `ambercast_run` | `grep?: string`（有効な正規表現）、`resolve?: boolean`（false）、`updateCache?: boolean`（false）、`ai?: 'claude' \| 'codex'` |
| `ambercast_check` | 共通入力のみ |
| `ambercast_heal` | `dryRun?: boolean`（true）、`applyToken?: string`、`ai?: 'claude' \| 'codex'` |
| `ambercast_job_status` | `jobId?: string`（省略時は当該サーバープロセスの一覧）、`waitMs?: number`（0。整数 0〜45000、ID 指定時のみ有効） |
| `ambercast_job_cancel` | `jobId: string` |

MCP 入力は意図的に CLI フラグを除外する。除外するのは `headed`（headless 固定）、`list`、`stale`（fail 固定）、`json`、`yes`（`applyToken` に置換）、`configPath` である。

## heal のプレビューと適用 {#heal-preview-and-apply}

`ambercast_heal` は CLI heal の false 既定と異なり、プレビュー（`dryRun: true`）が既定である。コミットがあるプレビューは `applyToken` を返し、コミットがないプレビューは返さない。適用には `dryRun: false` と `applyToken` だけを指定する。このとき `files`、`ai`、`allowEmpty` は省略する。プレビューでは `applyToken` を省略する。無効な組み合わせは SDK の入力検証エラーになる。適用は同期実行で、ジョブを作らない。

token は 128-bit の乱数で、hex 32 文字で表す。新しいプレビューは pending token を supersede する。pending token は、`ambercast_heal` または `ambercast_job_status` が token を含む応答を初めてクライアントへ返してから 600000 ms で期限切れになる。応答をジョブのキャッシュへ組み立てた時点では、この時計は始まらない。consumed token は確定から 600000 ms の間、保存済みの結果を再送する。

クライアントが form elicitation に対応する場合、サーバーは 600000 ms の制限で確認を求める。受諾して確認すると修復を適用する。拒否すると未適用のままになり、取消すると中断する。form elicitation に対応しないクライアントでは、サーバーが適用を認可する。token はプレビューを識別するだけで、適用の要求は別の操作である。クライアントのヒントだけでは認可にならない。

## 結果とジョブ {#results-and-jobs}

全ツールで `outputSchema` を省略する。report JSON Schema は `tools/list` に載せるには大きすぎる。また、ツールは report envelope、単一の Job record、Job record の一覧のいずれかを返し得る。完了した report の `structuredContent` は CLI JSON 出力と同じ envelope で、exit code を追加しない。スクリーンショットは projectRoot 相対のパスで、inline base64 にはしない。

text の1行目は `exitCode: <n>` である。コミットのある heal preview だけは2行目が `applyToken: <token>` になり、次の行に envelope JSON が続く。応答には `_meta.exitCode` も含まれ、該当する場合は `_meta.applyToken` も含まれる。`ambercast_job_status` で取得した完了ジョブは、同じ content、error 分類、metadata に加えて、result を含まない `_meta.job` を返す。

generate、run、heal preview は呼び出しごとに Job を作る。同期待機の上限内に終われば、呼び出し元は report 応答を受け取る。終わらなければ、ジョブハンドルを受け取る。ハンドルと非終端の status 応答は、Job record を `structuredContent` に入れる。text は3行で、`jobId: <id>`、`status: <status>`、status message の順に並ぶ。metadata は `_meta.jobId` を含む。

`ambercast_check` と heal の適用は同期実行のままである。`ambercast_job_status` は ID を省略すると、当該サーバープロセスのジョブを新しい順に一覧表示する。結果は `structuredContent` の `jobs` 配列に入る。空の一覧の text は `no jobs` である。これはサーバー固有のジョブ経路であり、MCP Tasks extension ではない。`ambercast_job_cancel` は running または queued のジョブを取り消し、record を返す。Job record は終端から 1800000 ms 後、またはサーバー終了時に消える。

| Job record フィールド | 意味 |
| --- | --- |
| `jobId` | UUID v4 の識別子 |
| `tool` | 元ツール |
| `status` | working、completed、failed、cancelled のいずれか |
| `statusMessage` | 空でない進捗または終端状態のメッセージ |
| `progress` | 通知の有無に関係ない runtime event の累計 |
| `createdAt` | ISO 8601 UTC の作成日時 |
| `lastUpdatedAt` | status または progress が最後に変化した ISO 8601 UTC 日時 |
| `pollIntervalMs` | 2000 |
| `ttlMs` | 1800000 |

## MCP エラー {#mcp-errors}

MCP 層の意味エラーは、`isError: true`、`<CODE>: <message>` 形式の text 1個を持ち、`structuredContent` を持たない。コードは `HEAL_APPLY_TOKEN_INVALID`（reason は `missing`、`unknown-token`、`superseded`、`expired`）、`HEAL_APPLY_FAILED`、`JOB_NOT_FOUND`、`JOB_FAILED` である。入力不正は代わりに SDK の検証エラーを使う。ドメインと環境の失敗は report envelope に残る。

## 当初の設計からの変更 {#changes-from-the-planned-design}

| 以前の予定ページ | 実装済みの契約 |
| --- | --- |
| review を含む5ツール | 4ワークフローと status・cancel の6ツール。review は公開しない |
| report `outputSchema` を公開 | 全ツールで `outputSchema` を省略 |
| heal は preview のみ | `applyToken` による二段階の heal と同期の apply |
| 同期ワークフローのみ | 長い generate、run、heal preview はジョブを返す。ID なしの status は一覧を返す |
| server flags は未指定 | `ambercast mcp` は `--dir` と `--sync-wait-ms` を受け付ける |
| report の exit 分類のみ | MCP error code と SDK 検証エラーを report envelope と区別する |
| CLI flag の対応は未指定 | 入力から `headed`、`list`、`stale`、`json`、`yes`、`configPath` を除外する |
| exit code は report から推測 | `_meta.exitCode` と text の1行目が exit code を載せる |
| `target` は4ツール共通と規定 | `target` は `ambercast_generate` だけが受け付ける。`ambercast_run`、`ambercast_check`、`ambercast_heal` は計画自体に記録された Target を選ぶ。これは CLI 側の 計画 IR v4 移行と一致する |

関連リンク: [ambercast mcp](/ambercast/ja/reference/cli/mcp/#usage)、[MCP サーバー](/ambercast/ja/agents/mcp-server/#connection-boundary)、[レポート](/ambercast/ja/reference/reports/#envelope)、[終了コード](/ambercast/ja/reference/exit-codes/#exit-code-table)。
