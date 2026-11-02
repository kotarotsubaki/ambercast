---
title: ambercast mcp
description: MCP サーバーの起動、転送、終了処理、クライアント登録のリファレンス。
---

`ambercast mcp` は、ポートを使わない MCP サーバーを `stdio` で起動する。1 つのプロセスが扱うセッションルートは 1 つである。

## 使い方 {#usage}

```text
ambercast mcp [--dir <path>] [--sync-wait-ms <n>] [--help]
```

## フラグ {#flags}

| フラグ | 値 | 効果 | 既定値 |
| --- | --- | --- | --- |
| --dir | path | 扱うセッションルート | cwd |
| --sync-wait-ms | n | 同期応答を待つ上限（ミリ秒） | 45000 |

`--dir` はセッションルートを選ぶ。省略するとプロセスのカレントディレクトリを使い、相対パスはそのディレクトリを基準に解決する。`--sync-wait-ms` は正の整数で、長いワークフローがジョブハンドルを返すまでの同期待ちの上限になる。`--help` は他の引数より優先され、使い方を標準出力に書いて終了コード 0 で終わる。

解決したディレクトリが無い、またはディレクトリでない場合は、標準エラーに `ambercast mcp: --dir <path> is not a directory.` を出力し、起動せずに終了コード 2 で終わる。起動に失敗すると `ambercast mcp: failed to start (<error name>)` を出力して終了コード 3 で終わる。不正なオプション、位置引数、不正な待ち時間の指定では、CLI の使い方エラーを標準エラーに出力して終了コード 2 で終わる。

## 転送と終了処理 {#transport-and-shutdown}

標準出力に流れるのは JSON-RPC の行だけである。標準エラーには進捗と、起動時の 1 行 `ambercast mcp: serving <session root>` を出力する。

サーバーは、標準入力の終了、SIGTERM、SIGINT のいずれかでドレインを始める。実行中の呼び出しを中止し、最長 10000 ms 待ってからサーバーを閉じ、すべて決着していれば終了コード 0 で終わる。期限になっても決着しない呼び出しがあれば、終了コード 3 で終わる。ドレイン中の新しいツール呼び出しは拒否される。

## クライアント登録 {#client-registration}

ambercast をインストールしたプロジェクトで `npx --no-install ambercast mcp` を実行する。Claude Code はプロジェクトの `.mcp.json` を読む。

```json
{"mcpServers":{"ambercast":{"command":"npx","args":["--no-install","ambercast","mcp"]}}}
```

Codex CLI は `config.toml` を読む。

```toml
[mcp_servers.ambercast]
command = "npx"
args = ["--no-install", "ambercast", "mcp"]
```

Claude Desktop は、設定に同じサーバーのエントリを書けば使える。

```json
{"mcpServers":{"ambercast":{"command":"npx","args":["--no-install","ambercast","mcp"]}}}
```

`npx --no-install` がパッケージを解決できるように、クライアントは ambercast をインストールしたプロジェクトから起動する。`--dir <path>` が選ぶのはサーバーの起動後のセッションルートだけで、パッケージの解決には影響しない。サーバーが提供するツールは `ambercast_generate`・`ambercast_run`・`ambercast_check`・`ambercast_heal`・`ambercast_job_status`・`ambercast_job_cancel` の 6 つである。

## 計画時の設計からの変更点 {#changes-from-the-planned-design}

| 以前に計画したページ | 実装された契約 |
| --- | --- |
| サーバーのフラグは未規定 | `ambercast mcp` は `--dir` と `--sync-wait-ms` に対応する |
| 計画していたツールは 5 つ | ジョブの状態確認と取り消しを含む 6 つのツール |
| レポートの `outputSchema` を公開する | `outputSchema` は省く |
| heal はプレビューのみ | 2 段階の heal は `applyToken` を使う |
| 同期呼び出しのみ | 長い呼び出しはジョブを返す。ID なしの状態確認はジョブの一覧を返す |
| MCP のエラーは未規定 | `HEAL_APPLY_TOKEN_INVALID`・`HEAL_APPLY_FAILED`・`JOB_NOT_FOUND`・`JOB_FAILED` は別のエラー応答を持つ |
| CLI の入力フラグは未規定 | ツールの入力に `headed`・`list`・`stale`・`json`・`yes`・`configPath` は含まない |
| 終了コードはレポートから推測する | `_meta.exitCode` が明示的に運ぶ |

関連ページ: [MCP ツール](/ambercast/ja/reference/mcp-tools/#tool-table)、[MCP サーバー](/ambercast/ja/agents/mcp-server/#connection-boundary)、[CLI の概要](/ambercast/ja/reference/cli/overview/#command-surface)
