---
title: GitHub Actions で ambercast を実行する
description: GitHub Actions の CI ワークフローで ambercast を実行するための、移植性の高い標準的な手順を解説します。
---

GitHub Actions のワークフローで ambercast を実行するための、移植性の高い標準的な手順です。チェックアウトや Node・依存関係のインストール、Chromium のセットアップ、必要なプロバイダー認証を済ませたジョブに対して、`npx ambercast check` と `npx ambercast run` を順次実行する構成を整えます。

## 手順 {#steps}

1. チェックアウト、Node および依存関係のインストール、Chromium のインストール、そして必要なプロバイダー認証の完了後に、以下のジョブコマンドを追加します。

```yaml
- run: npx ambercast check
- run: npx ambercast run
```

`check` は読み取り専用の選択オプションを備えた独立したコマンドです。シェルが `check` から終了コード `0` を受け取った後にのみ、`run` がディスパッチされる動作を確認できます。

2. `--update-cache` は追加しないでください。
既定の CI 構成では `updateGroundingCache: false` に設定されていることが確認できます。

3. ワークフローのコミットとプッシュは人間が行ってください。エージェントはワークフローの差分を提示し、会話の中で明示的な要求があった場合にのみコミットまたはプッシュを実行します。
stale（古くなった状態）または信頼できないアーティファクトが存在する場合、終了コード `4` が返されて `run` の手前でジョブが停止することが確認できます。なお、エージェントのコミット／プッシュに関するポリシーは、CLI の動作とは独立しています。

## 完了状態 {#completion-state}

- ジョブは `check` が終了コード `0` で終了した後にのみ `run` に到達し、グラウンディングの書き戻し（grounding write-back）にはオプトインしていません。

関連情報: [他のCIプラットフォームでの実行](/ambercast/ja/how-to/run-on-other-ci/), [グラウンディングのライトバック制御](/ambercast/ja/how-to/control-grounding-writeback/), [ambercast check](/ambercast/ja/reference/cli/check/), [ambercast run](/ambercast/ja/reference/cli/run/), [終了コード](/ambercast/ja/reference/exit-codes/)
