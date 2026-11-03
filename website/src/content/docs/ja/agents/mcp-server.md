---
title: MCP サーバー
description: "`ambercast mcp`は1つのセッションルートをstdioでMCPクライアントへ提供し、このページは呼べるツールと詳細の所在を示す。"
---

エージェントはこのページで、MCPクライアントからambercastの何を呼べるか、各呼び出しの詳細をどこで調べるかを決める。サーバーはambercastのブラウザE2Eワークフロー（generate、run、check、heal）を動かす。

## 接続の境界 {#connection-boundary}

`ambercast mcp`は、ポートを開かないstdioの接続を提供する。1つのサーバープロセスは1つのセッションルートを担当する。ルートは`--dir`で指定し、省略するとプロセスのカレントディレクトリになる。

ツールへ渡すファイルは、このルートからの相対で解決する。`--sync-wait-ms`は同期応答を待つ上限で、既定は45000 msである。

公開するツールは`ambercast_generate`、`ambercast_run`、`ambercast_check`、`ambercast_heal`、`ambercast_job_status`、`ambercast_job_cancel`の6つである。前の4つはワークフローで、後ろの2つはサーバー内のジョブの確認と取り消しに使う。

[MCPツール](/ambercast/ja/reference/mcp-tools/#tool-table)のとおり、`target`を受け取るのは`ambercast_generate`だけである。ほかのワークフローのツールは、計画からターゲットを選ぶ。

入力、アノテーション、ジョブの記録、`isError`、MCPのエラーも同じページにある。クライアントへの登録は[ambercast mcp](/ambercast/ja/reference/cli/mcp/#client-registration)に従う。

## 計画時の設計からの変更 {#changes-from-the-planned-design}

| 以前の計画ページ | 実装した接続 |
| --- | --- |
| 5つのツール | ジョブの状態確認と取り消しを含む6つのツール |
| レポートの`outputSchema`を公開 | `outputSchema`は省略 |
| healはプレビューのみ | `applyToken`を使う2段階のheal |
| 同期のワークフローのみ | 長い`generate`、`run`、healのプレビューはジョブになる。IDなしの状態確認は一覧を返す |
| サーバーのフラグは未定 | `ambercast mcp`は`--dir`と`--sync-wait-ms`に対応 |
| MCPのエラーは未定 | `HEAL_APPLY_TOKEN_INVALID`、`HEAL_APPLY_FAILED`、`JOB_NOT_FOUND`、`JOB_FAILED`は別のエラー面を使う |
| CLIの入力は未定 | 入力は`headed`、`list`、`stale`、`json`、`yes`、`configPath`を含まない |
| 終了コードはレポートから推測 | `_meta.exitCode`が明示的に持つ |

関連リンク: [MCPツール](/ambercast/ja/reference/mcp-tools/#tool-table)、[ambercast mcp](/ambercast/ja/reference/cli/mcp/#usage)、[構造化出力の読み取り](/ambercast/ja/agents/reading-structured-output/)
