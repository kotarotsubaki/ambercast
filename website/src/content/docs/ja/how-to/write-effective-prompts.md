---
title: 効果的なプロンプトの作成
description: レビューしやすく焦点の定まったテストプロンプトを作成し、ドライランで検証する手順を説明します。
---

テストプロンプトを明確に構造化しておくことで、レビュー時の負担を減らし、意図通りのテストを正確に生成できます。ここでは、焦点を絞ったプロンプトファイルの記述方法と、ドライランによる生成内容の事前確認手順を説明します。

## 前提条件 {#prerequisites}

プロンプトファイルは、関連ファイルの正確なマッピングを有効にするため、ファイル名の末尾が厳密に `.test.md` で終わっている必要があります。

## 手順 {#steps}

1. `tests/ambercast/checkout.test.md` を作成し、1つのH1、ケースに必要なセットアップ、そして1文につき1つの観測可能な結果を記述します。これらはパーサーの構文規則ではなく、レビュー時に焦点を明確に保つための推奨事項です。

   成功条件には、URLに到達したことだけでなく、到達先で確認できる見出し、メッセージ、要素を記述します。

   > …I reach the dashboard and see the heading "Welcome back".
2. 関連しないユーザー成果は、別々の `<name>.test.md` ファイルに分割します。テストケースごとに焦点を絞るため、ファイルを分ける構成が推奨されます。
3. シークレットが必要な場合にのみ、独立した行として `@ambercast-secret {{secrets.name}}` を記述します。パーサーはコードブロック外に置かれた完全な付与行のみを認識します。
4. `--dry-run` フラグを指定して生成を実行し、結果をプレビューします。

   有効なプレビュー結果では、ステータスが `would-generate` かつ `dryRun: true` となり、実際の書き込みはコミットされません。

## 検証 {#verification}

ドライランの結果を確認したら、`--dry-run` なしで生成コマンドを実行します。



生成が成功すると、結果に `generated` が表示され、終了コード `0` で完了します。

## 関連ドキュメント {#related}

- [プロンプトファイルのフォーマット](/ambercast/ja/reference/prompt-format/)
- [プランにおけるシークレット](/ambercast/ja/spec/secrets/)
- [ambercast generate](/ambercast/ja/reference/cli/generate/)
- [計画ドキュメント](/ambercast/ja/spec/plan-document/)
- [生成された差分のレビュー](/ambercast/ja/how-to/review-generated-diffs/)
