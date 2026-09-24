---
title: MCP サーバー
description: ambercast MCP サーバーを使用するエージェント向けの接続境界。
---

`ambercast mcp` サブコマンドは、打鍵 E2E テストの実行と修復に使う、ポートを持たない `stdio` 接続を提供します。1つのサーバープロセスは1つの session root を提供し、`--dir` で選択します。省略時はプロセスの現在の作業ディレクトリを使います。ツールに渡すファイルはこの root を基準に解決します。`--sync-wait-ms` で同期待機上限を設定でき、既定値は 45000 ms です。

## 接続境界 {#connection-boundary}

接続では `ambercast_generate`、`ambercast_run`、`ambercast_check`、`ambercast_heal`、`ambercast_job_status`、`ambercast_job_cancel` を提供します。前の4つはワークフロー、後の2つはサーバー内ジョブの観測と取消です。入力、アノテーション、Job record、`isError`、MCP エラー面は [MCP ツール](/ambercast/ja/reference/mcp-tools/#tool-table) を参照してください。クライアントへのプロセス登録は [ambercast mcp](/ambercast/ja/reference/cli/mcp/#client-registration) に記載しています。

## 計画時の設計からの変更 {#changes-from-the-planned-design}

| 旧 planned ページ | 実装済みの接続 |
| --- | --- |
| 計画された5ツール | ジョブ状態と取消を含む6ツール |
| report `outputSchema` を公開 | `outputSchema` を省略 |
| heal preview のみ | `applyToken` による二段階 heal |
| 同期ワークフローのみ | 長い呼び出しはジョブとなり、ID なしの status は一覧を返す |
| server flags 未指定 | `ambercast mcp` は `--dir` と `--sync-wait-ms` に対応 |
| MCP error 未指定 | `HEAL_APPLY_TOKEN_INVALID`、`HEAL_APPLY_FAILED`、`JOB_NOT_FOUND`、`JOB_FAILED` は独立したエラー面 |
| CLI 入力未指定 | 入力から `headed`、`list`、`stale`、`json`、`yes`、`configPath` を除外 |
| report から exit code を推測 | `_meta.exitCode` に明示 |

関連リンク: [MCP ツール](/ambercast/ja/reference/mcp-tools/#tool-table)、[ambercast mcp](/ambercast/ja/reference/cli/mcp/#usage)、[構造化出力の読み取り](/ambercast/ja/agents/reading-structured-output/)。
