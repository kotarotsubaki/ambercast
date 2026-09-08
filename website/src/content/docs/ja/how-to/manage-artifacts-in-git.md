---
title: Gitでの成果物の管理
description: ambercast の成果物をリポジトリポリシーや実行ディレクトリの設定に合わせて Git でバージョン管理する手順を説明します。
---

ambercast で生成される成果物を、設定されたリポジトリポリシーやディレクトリ構成に合わせて Git でバージョン管理する手順を説明します。

## 前提条件 {#prerequisites}

作業を始める前に、以下の既定値を確認してください。

- 既定のグラウンディングポリシーでは、`repositoryPolicy` は `"committed"` です。
- 実行成果物を出力する既定の runs ディレクトリは `tests/ambercast/.runs` です。

## 手順 {#steps}

1. ポリシーが `committed` の場合は、`<name>.test.md`、`<name>.ambercast.plan.json`、および `<name>.ambercast.grounding.json` をステージングします。リゾルバーによって、テストファイルに隣接する2つのコンパニオン接尾辞が定義されています。

2. グラウンディングをローカルキャッシュとして扱う場合は、設定ファイルで `repositoryPolicy` を `uncommitted` に設定します。公開されている設定スキーマ URL を指定し、以下のように記述します。`uncommitted` は受け入れられるポリシー値です。



3. 設定された `runsDir` を `.gitignore` に追加します。既定の設定を使用している場合は `tests/ambercast/.runs/` を追加してください。`runsDir` は設定可能であり、実行時にはその配下に生成される呼び出しごとのディレクトリ内に1つの `report.json` が書き込まれます。

4. `repositoryPolicy` が `uncommitted` の場合は、`.gitignore` に `tests/ambercast/**/*.ambercast.grounding.json` も追加します。設定された `testDir` が既定値と異なる場合は、`tests/ambercast` の部分を置き換えてください。リゾルバーは固定の `.ambercast.grounding.json` 接尾辞を持つグラウンディングコンパニオンを `testDir` 内でのみ解決します。これにより、プランの追跡を維持したまま、ローカルのグラウンディングコンパニオンのみを無視できます。

## 確認 {#verification}

`git status --short` を実行して、状態を確認します。

- `committed` ポリシーの場合: プランとグラウンディングコンパニオンが表示されることを確認します。
- `uncommitted` ポリシーの場合: プランは表示され、`testDir` 配下のローカルな `*.ambercast.grounding.json` は表示されないことを確認します。
- 設定された `runsDir` を無視している場合: その実行証跡が表示されないことを確認します。

## 関連情報 {#related}

関連リンク: [ファイルレイアウト](/ambercast/ja/reference/file-layout/), [設定](/ambercast/ja/reference/configuration/), [計画ドキュメント](/ambercast/ja/spec/plan-document/), [グラウンディングドキュメント](/ambercast/ja/spec/grounding-document/), [グラウンディングのライトバック制御](/ambercast/ja/how-to/control-grounding-writeback/).
