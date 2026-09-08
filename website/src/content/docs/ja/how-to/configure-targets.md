---
title: ターゲットの設定
description: ambercastの設定ファイルでターゲット環境、自己修復のリプレイ分離、およびシークレット送信先オリジンを構成します。
---

ambercastの設定ファイルにターゲット（targets）を定義し、各環境のベースURLやブラウザ、リプレイ分離設定、およびシークレットの送信先オリジンを構成します。

## 前提条件 {#prerequisites}

- 設定ファイルが存在する場合、文字列型の `$schema` が必須となります。

## 手順 {#steps}

1. `{"$schema":"https://kotarotsubaki.github.io/ambercast/schemas/config.schema.json","targets":{"staging":{"baseUrl":"https://staging.example.test","browser":"chromium"},"admin":{"baseUrl":"https://admin.example.test","browser":"chromium"}},"defaultTarget":"staging"}` を記述します。これは公開されている設定スキーマURLであり、`targets` および `defaultTarget` は受け入れられる設定形式を持ちます。
2. 破棄可能なターゲットにのみ `"healReplayIsolation":"idempotent"` を追加します。受け入れられる分離設定の値は `idempotent` と `stateful` であり、`healReplayIsolation` の既定値は `stateful` です。
3. シークレットが `baseUrl` 以外のオリジンに入力される可能性がある場合は、`"secretSinkOrigins":{"{{secrets.password}}":["https://login.example.test","https://admin.example.test"]}` を追加します。`secretSinkOrigins` は各シークレット参照を許可されたオリジンの配列へとマッピングします。設定されたマッピングは既定のオリジンポリシー（`baseUrl` のオリジン）を置き換え、各オリジンは正規化されます。

## 確認 {#verification}

- `npx ambercast check --target staging --list` を実行します。成果物の検査は行われず、終了コード `0` と `listed` の結果が返されることを確認します。

## 関連情報 {#related}

リンク: [設定](/ambercast/ja/reference/configuration/)、[ambercast check](/ambercast/ja/reference/cli/check/)、[ambercast heal](/ambercast/ja/reference/cli/heal/)、[プランにおけるシークレット](/ambercast/ja/spec/secrets/)、[UI変更後にテストを修復する](/ambercast/ja/tutorials/repair-your-first-drift/)
