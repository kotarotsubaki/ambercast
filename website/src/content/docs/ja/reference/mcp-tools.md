---
title: MCP ツール
description: ambercast の MCP ワークフローにおけるツール、入力、結果、エラーの規約。
---

MCP サーバーは `ambercast_generate`、`ambercast_run`、`ambercast_check`、`ambercast_heal`、`ambercast_job_status`、`ambercast_job_cancel` の順で6つのツールを公開します。ツール名は ambercast プレフィックスと snake_case を使用し、すべての CLI コマンドを複製するものではありません。

## ツール一覧 {#tool-table}

アノテーションは readOnly / destructive / idempotent / openWorld の順です。4値をすべて明示しますが、認可ではなくヒントです。generate の冪等ヒントは弱い意味であり、最新の Plan はスキップされて効果が収束しても、AI 出力は変動し得ます。

| ツール | 対応 CLI | アノテーション | `isError: true` | `isError: false` の負の結果 |
| --- | --- | --- | --- | --- |
| `ambercast_generate` | generate | false / false / true（弱）/ false | exit 2・3 | exit 1（strict 曖昧）、exit 5 |
| `ambercast_run` | run | false / false / false / true | exit 2・3・4（MISSING_PLAN / STALE_PLAN / INTEGRITY_VIOLATION / GROUNDING_UNRESOLVED） | exit 1（assertion red）、exit 5 |
| `ambercast_check` | check | true / false / true / false | exit 2・3 | exit 4（stale は results[].status の正常成果）、exit 5 |
| `ambercast_heal` | heal | false / true / false / true | exit 2（CI 拒否含む）・3・4、`HEAL_APPLY_TOKEN_INVALID`、`HEAL_APPLY_FAILED` | exit 1（未解決・拒否）、exit 5 |
| `ambercast_job_status` | — | true / false / true / false | `JOB_NOT_FOUND`、failed 時の `JOB_FAILED`、結果のある completed/cancelled は元ツールの写像 | 非終端 record・一覧・queued cancel record |
| `ambercast_job_cancel` | — | false / false / true / false | `JOB_NOT_FOUND` | — |

`isError` はレポートの集約済み exit code から決め、個別の report error は再分類しません。heal は Claude Code 用の対話ヒントも設定しますが、それ自体は承認の証拠ではありません。

## 入力 {#inputs}

入力は strict object です。不明キー、型不一致、refine 違反は SDK の `Input validation error` と `isError: true` になります。引数がない場合は `{}` を渡します。

| 範囲 | プロパティと既定値 |
| --- | --- |
| 共通 | `files?: string[]`（省略と `[]` はともに config discovery、相対パスは session root 基準）、`allowEmpty?: boolean`（false） |
| `ambercast_generate` | `target?: string`（ジェネレーターが利用できる Target 定義を制限する）、`strict?: boolean`（false）、`force?: boolean`（false）、`dryRun?: boolean`（false）、`ai?: 'claude' \| 'codex'` |
| `ambercast_run` | `grep?: string`（有効な正規表現）、`resolve?: boolean`（false）、`updateCache?: boolean`（false）、`ai?: 'claude' \| 'codex'` |
| `ambercast_check` | 共通入力のみ |
| `ambercast_heal` | `dryRun?: boolean`（true）、`applyToken?: string`、`ai?: 'claude' \| 'codex'` |
| `ambercast_job_status` | `jobId?: string`（省略時は当該サーバープロセスの一覧）、`waitMs?: number`（0、整数 0〜45000、ID 指定時のみ有効） |
| `ambercast_job_cancel` | `jobId: string` |

MCP 入力から CLI フラグ `headed`（headless 固定）、`list`、`stale`（fail 固定）、`json`、`yes`（`applyToken` に置換）、`configPath` を除外します。

## heal のプレビューと適用 {#heal-preview-and-apply}

`ambercast_heal` は CLI heal の false 既定と異なり、プレビュー（`dryRun: true`）が既定です。コミットがあるプレビューのみ `applyToken` を返します。適用には `dryRun: false` と `applyToken` だけを指定し、`files`、`ai`、`allowEmpty` は省略します。プレビューでは `applyToken` を省略します。違反は SDK 入力エラーです。適用は同期実行で、ジョブを作りません。token は 128-bit 暗号乱数の hex 32 文字です。新しいプレビューは pending token を supersede します。pending token は token を含む応答を初めて組み立ててから 600000 ms で期限切れになり、consumed token は確定から 600000 ms の間、保存済み結果を再送します。

クライアントが form elicitation に対応する場合、600000 ms の制限で確認を求めます。受諾と確認で修復を適用し、拒否なら未適用、取消なら中断となります。form elicitation がないクライアントではサーバーが適用を認可します。token はプレビューを識別するもので、適用の要求は別の操作です。クライアントのヒントだけでは認可になりません。

## 結果とジョブ {#results-and-jobs}

全ツールで `outputSchema` を省略します。report JSON Schema は 136 KB で `tools/list` を圧迫し、ツールは report envelope、単一の Job record、または Job record の一覧のいずれかを返すためです。完了した report の `structuredContent` は CLI JSON 出力と同じ envelope で、exit code を追加しません。スクリーンショットは projectRoot 相対のパスであり、inline base64 にしません。

text 1行目は `exitCode: <n>` です。コミットのある heal preview のみ2行目が `applyToken: <token>` になり、その後に envelope JSON が続きます。応答には `_meta.exitCode` と、該当する場合 `_meta.applyToken` も含まれます。`ambercast_job_status` で取得した完了ジョブは同じ content・error 分類・metadata に、result を含まない `_meta.job` を加えます。

generate、run、heal preview は呼び出しごとに Job を作ります。同期待機上限内に終われば report 応答を返し、終わらなければジョブハンドルを返します。ハンドルと非終端 status は Job record を `structuredContent` に入れ、text は `jobId: <id>`、`status: <status>`、status message の3行です。metadata は `_meta.jobId` を含みます。`ambercast_check` と heal apply は同期実行です。`ambercast_job_status` の ID 省略時は当該サーバープロセスのジョブを新しい順で一覧表示し、`structuredContent` に `jobs` 配列を入れます。空の一覧の text は `no jobs` です。これはサーバー固有の経路であり、MCP Tasks extension ではありません。`ambercast_job_cancel` は running または queued ジョブを取り消して record を返します。record は終端から 1800000 ms 後、またはサーバー終了時に消えます。

| Job record フィールド | 意味 |
| --- | --- |
| `jobId` | UUID v4 の識別子 |
| `tool` | 元ツール |
| `status` | working / completed / failed / cancelled |
| `statusMessage` | 空でない進捗または終端状態の文 |
| `progress` | 通知の有無に関係ない runtime event の累計 |
| `createdAt` | ISO 8601 UTC の作成日時 |
| `lastUpdatedAt` | status または progress が最後に変化した ISO 8601 UTC 日時 |
| `pollIntervalMs` | 2000 |
| `ttlMs` | 1800000 |

## MCP エラー {#mcp-errors}

MCP 層の意味エラーは `isError: true`、text 1個 `<CODE>: <message>`、`structuredContent` なしです。コードは `HEAL_APPLY_TOKEN_INVALID`（reason `missing`、`unknown-token`、`superseded`、`expired`）、`HEAL_APPLY_FAILED`、`JOB_NOT_FOUND`、`JOB_FAILED` です。入力不正は SDK の検証エラーを使用し、ドメイン・環境失敗は report envelope に残します。

## 計画時の設計からの変更 {#changes-from-the-planned-design}

| 旧 planned ページ | 実装済みの契約 |
| --- | --- |
| review を含む5ツール | 4ワークフローと status/cancel の6ツール。review は公開しない |
| report `outputSchema` を公開 | 全ツールで `outputSchema` を省略 |
| heal は preview のみ | `applyToken` による二段階と同期 apply |
| 同期ワークフローのみ | 長い generate/run/heal preview はジョブになり、ID なしの status は一覧を返す |
| server flags 未指定 | `ambercast mcp` は `--dir` と `--sync-wait-ms` を受け付ける |
| report exit 分類のみ | MCP error code と SDK 検証エラーを report envelope と区別 |
| CLI flag 対応未指定 | 入力から `headed`、`list`、`stale`、`json`、`yes`、`configPath` を除外 |
| exit code は report から推測 | `_meta.exitCode` と text 1行目に exit code を載せる |
| `target` は4ツール共通と規定 | `target` は `ambercast_generate` のみが受け付ける。`ambercast_run`・`ambercast_check`・`ambercast_heal` は Plan 自体に記録された Target を使用する（CLI 側の Plan IR v4 移行と一致） |

関連リンク: [ambercast mcp](/ambercast/ja/reference/cli/mcp/#usage)、[MCP サーバー](/ambercast/ja/agents/mcp-server/#connection-boundary)、[レポート](/ambercast/ja/reference/reports/#envelope)、[終了コード](/ambercast/ja/reference/exit-codes/#exit-code-table)。
