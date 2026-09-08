---
title: シークレットの管理
description: プロンプト内でシークレットを安全に作成し、テスト生成および実行時に適切に解決するための手順を説明します。
---

テストプロンプト内でシークレットを安全に作成・管理するための手順です。ambercast では、シークレット参照 `{{secrets.a.b}}` は対応する環境変数 `AMBERCAST_SECRET_A_B` から解決されます。

## 前提条件 {#prerequisites}

- シークレット参照 `{{secrets.a.b}}` は、環境変数 `AMBERCAST_SECRET_A_B` から解決されます。

## 手順 {#steps}

1. コード以外の独立したプロンプト行に、`@ambercast-secret {{secrets.password}}` と正確に記述します。グラントパーサーは完全に一致する行を受け付け、フェンスで囲まれたコード、インデントされたコード、およびインラインコードを除外します。グラント行1つは1回の使用だけを認可するため、同じシークレットを複数回使用する場合は使用ごとに行を1つ繰り返します。たとえば、サインイン、サインアウト、再度のサインインを行う場合です。

   ```
   @ambercast-secret {{secrets.password}}
   ...sign in, then sign out...
   @ambercast-secret {{secrets.password}}
   ```
2. 初回の `npx ambercast generate tests/ambercast/<name>.test.md` を実行する前に、プロンプト全体において SecretRef グラントの外側にリテラルのシークレットが含まれていないことを、人間または承認されたスキャナーで確認します。`generate` はリテラルシークレットのチェックを実行する前に正規化されたプロンプトを AI プロバイダーのコンテキストで送信するため、そのチェックによってプロンプト内ですでに送信されたシークレットを保護することはできません。
3. コマンド実行環境に `AMBERCAST_SECRET_PASSWORD` を設定し、`npx ambercast generate tests/ambercast/<name>.test.md` を実行します。生成処理ではプロンプトのグラントが認可されますが、シークレットプロバイダーの構築やその値の解決は行われません。
4. 入力対象が `baseUrl` でない場合は、[ターゲットの設定](/ambercast/ja/how-to/configure-targets/) に従って追加のオリジンを設定します。マッピングが存在しない場合は、既定で base-URL のオリジンになります。

## 確認 {#verification}

- 生成後、コマンド実行環境に変数を保持したまま、安全なターゲットに対して `npx ambercast run tests/ambercast/<name>.test.md` を実行します。実行処理により環境シークレットプロバイダーが構築され、`fill-secret` は稼働中のオリジンがシンクポリシーチェックに合格した後にのみ、指定された変数を解決します。
- `npx ambercast generate --json tests/ambercast/<name>.test.md` の実行結果に `SECRET_LITERAL_REJECTED` が返されないことを確認します。この拒否処理は、永続化やレポートのシリアライズの前にプロバイダー由来の生成 JSON を検査するものであり、プロバイダーにすでに送信されたプロンプトではなく、生成されたレスポンスを保護します。

## 関連情報 {#related}

リンク: [プランにおけるシークレット](/ambercast/ja/spec/secrets/)、[環境変数](/ambercast/ja/reference/environment-variables/)、[設定](/ambercast/ja/reference/configuration/)、[エラーコード](/ambercast/ja/reference/error-codes/)。
