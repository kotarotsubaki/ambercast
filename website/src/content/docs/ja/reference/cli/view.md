---
title: ambercast view
description: ambercast view のフラグ、対話ゲート、ポートの選択、ホストの結び付け、配信するルートのリファレンス。
---

`ambercast view` は、設定された実行ディレクトリを対象に、読み取り専用のローカル HTTP サーバーを起動する。テストを再実行せずに、実行のケース、ステップ、スクリーンショットを確認できる。AI は呼ばない。

## フラグ {#flags}

`view` は位置引数を取らない。

| フラグ | 値 | 効果 | 既定値 |
| --- | --- | --- | --- |
| --port | n | 希望するポート。指定しなければ 20 個の候補を順に試す | 4600 |
| --host | addr | 結び付けるアドレス。具体的な IP か localhost で、ワイルドカードは不可 | 127.0.0.1 |
| --allow-headless | boolean | 非対話の端末での起動を許可する | false |
| --config | path | 設定ファイルを明示する | omitted |
| --no-color | boolean | ANSI の色を無効にする | false |

## 対話ゲート {#interactive-gate}

`view` は、標準入力と標準エラーがどちらも端末で、かつ `CI` が有効でないときにだけ起動する。未設定・空・`false` の `CI` は有効とみなさない。`init` も、確認のプロンプトの前に、端末と `CI` について同じ検査をする。`--allow-headless` を付けずに非対話で呼ぶと、次のメッセージを出して終了コード `2` で終わる。

```text
view requires --allow-headless when no interactive terminal is attached.
```

`--allow-headless` はこの拒否を解く。端末で起動する場合は何も変わらない。

## ポートの選択 {#port-selection}

開始ポートは、`--port`、設定の `viewer.port`、`4600` の順で決まる。`--port` がなければ、`view` はそこから最大 20 個の連続したポートを試す。進むのは `EADDRINUSE` のときだけで、実際に結び付けたポートを出力する。

`--port` を指定した場合は、そのポートだけを厳密に使う。使用中なら `view` は終了コード `3` で終わる。候補をすべて使い切った場合や、`EADDRINUSE` 以外の結び付けの失敗も、終了コード `3` になる。

## ホストの結び付け {#host-binding}

`--host` には具体的な IP アドレスか `localhost` を渡す。`localhost` は `127.0.0.1` になる。ワイルドカードのアドレス（`0.0.0.0`・`::`・`[::]`）は、サーバーに認証が無いため、終了コード `2` で拒否される。すべてのリクエストの `Host` ヘッダーは、結び付けたホストとポートを指していなければならず、違えば `403` を返す。結び付けたアドレスが `127.0.0.1` と `::1` 以外のときは、認証なしで到達できるという警告を出力する。

## ルート {#routes}

| ルート | 配信する内容 |
| --- | --- |
| `GET /` | 新しい順の実行一覧。ステータス、所要時間、ケース数を表示する。 |
| `GET /runs/<runId>` | 1 回の実行のケース、ステップ、期待値と実際の値、説明、スクリーンショット。 |
| `GET /runs/<runId>/report.json` | 実行が永続化したレポートの生のバイト列。 |
| `GET /runs/<runId>/screenshots/<ref>` | 実行のレポートが参照しているスクリーンショット。 |

すべてのレスポンスに `X-Content-Type-Options: nosniff` と `Cache-Control: no-store` が付く。HTML と生のレスポンスには、固定の `Content-Security-Policy` と `Referrer-Policy: no-referrer` も付く。ページはサーバー側で描画され、クライアントの JavaScript も外部へのリクエストも使わない。

`report.json` が無い実行ディレクトリは、書き込みの途中や永続化の失敗後などに、証跡のみの行として一覧に載る。`report.json` の解析か検証に失敗した実行も一覧に残り、生のバイト列に到達できる。

`view` は `schemaVersion` が 3.x のレポートをすべて読む。別のマイナーバージョンのレポートは、実行の詳細ヘッダーに「Schema `<version>`」と表示される。別のメジャーバージョンのレポートは「Unsupported version `<version>`」として一覧に載り、開けない。

`view` は、ネットワークポートを使う ambercast 唯一のコマンドである。MCP サーバーは stdio を使う。

関連ページ: [CLIの概要](/ambercast/ja/reference/cli/overview/#command-surface)、[レポート](/ambercast/ja/reference/reports/#envelope)、[設定](/ambercast/ja/reference/configuration/#key-table)、[ambercast mcp](/ambercast/ja/reference/cli/mcp/#usage)
