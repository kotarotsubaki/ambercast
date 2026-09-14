---
title: シークレットの管理
description: 生成されたシークレット名を安全に承認し、その値を環境変数から解決する方法を説明します。
---

ambercast はプランの生成中に候補となるシークレット名を検出します。対話式の同意プロンプトでその名前を承認するか、非対話的な利用では設定の許可リストへあらかじめ追加します。シークレット値はプロンプトと成果物の外部に保持されます。

## 前提条件 {#prerequisites}

- 既存の `ambercast.config.json` ファイルは不要です。承認された同意によって許可リストを永続化する必要があり、設定済みのファイルが存在しない場合、ambercast が自動的に作成します。

## 手順 {#steps}

1. グラント行やシークレット値を含めずに、ユーザーの達成したい結果をプロンプトに記述します。

   ```markdown
   # Sign in

   Sign in as the configured test user and verify that the dashboard heading is visible.
   ```
2. `npx ambercast generate tests/ambercast/<name>.test.md` を実行します。生成では最初に候補プランを作成し、新たに提案されたシークレット名を一覧表示します。対話式端末では名前ごとに確認し、このテストに適切な名前だけを承認します。
3. CI または別の非対話環境では、生成前にレビュー済みの名前を追加します。

   ```json
   {
     "$schema": "https://kotarotsubaki.github.io/ambercast/schemas/config.schema.json",
     "secrets": { "allow": ["password"] }
   }
   ```

   空の `secrets.allow` ではすべての名前に同意が必要です。値が `"*"` の場合、AI が提案した任意の名前を名前ごとのレビューなしに受け入れます。この値は承認境界を取り除くため、そのことを理解した場合にのみ使用してください。すでに `"*"` である場合、同意を承認しても許可リストは更新されません。

   承認した名前を記録するとき、ambercast は排他的更新を行い、その中で現在ディスクにある設定を読み直して検証してからマージします。以前に読み込んだ設定スナップショットを上書きすることはありません。既存の `secrets.allow` の名前は重複を除きつつ現在の順序を維持します。新たに承認された名前は重複を除き、既存の名前を除外し、残りをアルファベット順に並べて末尾に追加します。
4. 対応する値はコマンド実行環境にのみ設定します。実行時、`{{secrets.a.b}}` は `AMBERCAST_SECRET_A_B` から解決されます。ドットはアンダースコアになり、セグメントは大文字になります。入力対象が `baseUrl` でない場合は、[ターゲットの設定](/ambercast/ja/how-to/configure-targets/) に従って追加のオリジンを設定します。

## 確認 {#verification}

- 同意を承認するか許可リスト項目を追加すると、生成はプランを永続化し、新しく承認された名前を `secrets.allow` に記録します。
- 1 回の生成バッチでは、ambercast はすべての新たに承認された名前を許可リストへ一度だけコミットしてから、候補ごとのプランまたは Grounding ファイルを書き込みます。これらは 1 つのトランザクションではなく別々の操作です。そのため、許可リストのコミット後に中断または失敗すると、候補のプランおよび Grounding ファイルの一部またはすべてが書き込まれなくても、許可リストの更新はディスクに残ります。これは、`secrets.allow` が生成済み成果物より先行し得る、既知かつ受け入れられた状態です。`generate` を再実行すると、すでに許可リストにある名前を使って回復できます。
- 同意を拒否した場合、または非対話端末で同意を要求できない場合、生成は `SECRET_CONSENT_REQUIRED` で失敗し、候補成果物を書き込みません。レビュー済みの名前を `secrets.allow` に追加してから、生成を再実行してください。
- 必要な `AMBERCAST_SECRET_<NAME>` 変数をコマンド実行環境に保持したまま、安全なターゲットに対して `npx ambercast run --resolve tests/ambercast/<name>.test.md` を実行します。`fill-secret` は稼働中のオリジンがシンクポリシーチェックに合格した後にのみ、名前付き変数を解決します。

## 関連情報 {#related}

リンク: [プランにおけるシークレット](/ambercast/ja/spec/secrets/)、[環境変数](/ambercast/ja/reference/environment-variables/)、[設定](/ambercast/ja/reference/configuration/)、[エラーコード](/ambercast/ja/reference/error-codes/)。
