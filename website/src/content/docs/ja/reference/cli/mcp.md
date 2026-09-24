---
title: ambercast mcp
description: MCP サーバーの起動、転送、終了処理、クライアント登録のリファレンス。
---

`ambercast mcp` はポートを使用しない MCP サーバーを `stdio` で起動します。各プロセスが1つの session root を提供します。

## 使用法 {#usage}

```sh
ambercast mcp [--dir <path>] [--sync-wait-ms <n>] [--help]
```

## フラグ {#flags}

| フラグ | 値 | 効果 | 既定値 |
| --- | --- | --- | --- |
| `--dir` | path | 提供する session root | cwd |
| `--sync-wait-ms` | n | 同期応答の待機上限（ミリ秒） | 45000 |

`--dir` は session root を選び、省略時はプロセスの現在の作業ディレクトリを使用します。相対パスもそこを基準に解決します。`--sync-wait-ms` は正の整数で既定値は 45000 です。長いワークフローがジョブハンドルを返すまでの同期待機を制限します。`--help` は他の引数より優先され、usage を stdout に出して exit 0 になります。

解決したパスが存在しないかディレクトリでない場合、stderr に `ambercast mcp: --dir <path> is not a directory.` を出してサーバーを起動せず exit 2 になります。起動失敗は `ambercast mcp: failed to start (<error name>)` を出して exit 3 になります。不正なオプション、位置引数、待機上限は CLI の usage error を stderr に出して exit 2 になります。

## 転送と終了 {#transport-and-shutdown}

stdout には JSON-RPC 行だけを出します。stderr には進捗と起動時の1行 `ambercast mcp: serving <session root>` を出します。stdin end、SIGTERM、SIGINT のいずれかで draining に入ります。実行中の呼び出しを abort し、最大 10000 ms 待ちます。すべて確定すればサーバーを閉じて exit 0、期限内に確定しない場合は exit 3 になります。draining 中は新しいツール呼び出しを受け付けません。

## クライアント登録 {#client-registration}

ambercast がインストールされたプロジェクトで `npx --no-install ambercast mcp` を使用します。Claude Code はプロジェクトの `.mcp.json` を読みます。

```json
{"mcpServers":{"ambercast":{"command":"npx","args":["--no-install","ambercast","mcp"]}}}
```

Codex CLI は `config.toml` を読みます。

```toml
[mcp_servers.ambercast]
command = "npx"
args = ["--no-install", "ambercast", "mcp"]
```

Claude Desktop の設定にも同じサーバー項目を指定できます。

```json
{"mcpServers":{"ambercast":{"command":"npx","args":["--no-install","ambercast","mcp"]}}}
```

クライアントの作業ディレクトリを目的の session root にするか、`--dir` 引数を追加します。サーバーは `ambercast_generate`、`ambercast_run`、`ambercast_check`、`ambercast_heal`、`ambercast_job_status`、`ambercast_job_cancel` を提供します。

## 計画時の設計からの変更 {#changes-from-the-planned-design}

| 旧 planned ページ | 実装済みの契約 |
| --- | --- |
| server flags 未指定 | `ambercast mcp` は `--dir` と `--sync-wait-ms` に対応 |
| 計画された5ツール | ジョブ状態と取消を含む6ツール |
| report `outputSchema` を公開 | `outputSchema` を省略 |
| heal preview のみ | `applyToken` による二段階 heal |
| 同期呼び出しのみ | 長い呼び出しはジョブとなり、ID なしの status は一覧を返す |
| MCP error 未指定 | `HEAL_APPLY_TOKEN_INVALID`、`HEAL_APPLY_FAILED`、`JOB_NOT_FOUND`、`JOB_FAILED` は独立したエラー応答 |
| CLI 入力フラグ未指定 | ツール入力から `headed`、`list`、`stale`、`json`、`yes`、`configPath` を除外 |
| report から exit code を推測 | `_meta.exitCode` に明示 |

関連リンク: [MCP ツール](/ambercast/ja/reference/mcp-tools/#tool-table)、[MCP サーバー](/ambercast/ja/agents/mcp-server/#connection-boundary)、[CLI の概要](/ambercast/ja/reference/cli/overview/#command-surface)。
