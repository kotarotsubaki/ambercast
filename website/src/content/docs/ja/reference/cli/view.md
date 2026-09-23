---
title: ambercast view
description: ambercast view コマンドのリファレンス。フラグ、対話ゲート、ポート選択、ホストバインド、配信ルートを解説します。
---

`ambercast view` は、設定済みの runs ディレクトリに永続化された run の結果を閲覧する、読み取り専用のローカル HTTP サーバーを起動します。テストを再実行したり AI 呼び出しを行ったりすることなく、開発者が run のケース・ステップ・スクリーンショットを確認できます。

## フラグ {#flags}

| フラグ | 値 | 効果 | デフォルト |
| --- | --- | --- | --- |
| `--port` | n | 希望するポート。未指定時は 20 候補まで自動増分 | 4600 |
| `--host` | addr | バインドアドレス。具体的な IP または localhost、ワイルドカード不可 | 127.0.0.1 |
| `--allow-headless` | boolean | 非対話端末での実行を許可 | false |
| `--config` | path | 明示的な設定パス | 省略 |
| `--no-color` | boolean | ANSI 出力を無効化 | false |

## 対話ゲート {#interactive-gate}

`view` は、他の確認ゲート付きコマンドと同じ対話判定に従い、stdin と stderr の両方が端末に接続され、かつ `CI` が設定されていない場合を除いて起動を拒否します。`--allow-headless` を指定しない非対話実行は、次のメッセージとともに終了コード 2 で終了します。

```
view requires --allow-headless when no interactive terminal is attached.
```

`--allow-headless` はこの拒否を解除します。既に対話端末である場合は no-op です。

## ポート選択 {#port-selection}

開始ポートは `--port`、次に設定済みの `viewer.port`、最後に 4600 の順で決まります。`--port` を指定しない場合、`view` は開始ポートから連続する最大 20 個のポートを試行し、`EADDRINUSE` のときだけ次の候補へ進み、実際にバインドしたポートを表示します。`--port` を指定した場合、そのポートは厳格に扱われます。使用中であれば別のポートを試さずに終了コード 3 で終了します。すべての候補を使い切った場合、または `EADDRINUSE` 以外のバインド失敗も同様に終了コード 3 です。

## ホストバインド {#host-binding}

`--host` は具体的な IP アドレスまたは `localhost`（`127.0.0.1` に正規化）を受け付けます。このサーバーは認証を持たないため、ワイルドカードアドレス（`0.0.0.0`、`::`、`[::]`）は終了コード 2 で拒否されます。すべてのリクエストはバインドされたホストとポートに対して `Host` ヘッダーで検査され、異なるホストを指定したリクエストは 403 で拒否されます。ループバック以外のアドレスへのバインドは、認証なしで到達可能である旨の警告を表示します。

## ルート {#routes}

| ルート | 内容 |
| --- | --- |
| `GET /` | run の一覧（新しい順）。状態・所要時間・ケース数を含む |
| `GET /runs/<runId>` | 1 つの run のケース・ステップ・期待値/実際値・説明文・スクリーンショット |
| `GET /runs/<runId>/report.json` | run が永続化した report の生バイト列 |
| `GET /runs/<runId>/screenshots/<ref>` | run の report が実際に参照するスクリーンショット |

すべての応答に `X-Content-Type-Options: nosniff` と `Cache-Control: no-store` が付与されます。HTML 応答と生データ応答には固定の `Content-Security-Policy` と `Referrer-Policy: no-referrer` も付与されます。画面はサーバーサイドでレンダリングされ、クライアント側 JavaScript や外部リクエストは一切含まれません。

`report.json` を欠く run ディレクトリ（書き込み途中や永続化失敗など）は、壊れたリンクとしてではなく evidence only として一覧に表示されます。`report.json` の解析または検証に失敗した run も、一覧から消えることなく、生バイト列へのリンク付きで表示され続けます。

関連情報: [CLI の概要](/ambercast/ja/reference/cli/overview/#command-surface)、[レポート](/ambercast/ja/reference/reports/#envelope)、[設定](/ambercast/ja/reference/configuration/#key-table)。
