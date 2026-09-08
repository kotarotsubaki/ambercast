---
title: バージョン間のアップグレード
description: ambercast のバージョン間を安全にアップグレードし、プランの整合性を確認する手順です。
---

ambercast のバージョン間を安全にアップグレードするための手順です。リリースの更新によって producer-fingerprint が変更され、プランが stale（古くなった状態）になった場合の再生成と検証を扱います。

## 前提条件 {#prerequisites}

CHANGELOG 0.3.1 に記載されている通り、producer-fingerprint の変更によって 0.1.0 のプランは stale（古くなった状態）になり、再生成が必要になります。

## 手順 {#steps}

1. 依存関係を変更する前に、アップグレード対象リリースの BREAKING セクションを確認します。0.3.1 の項目では `inputsDigest` への影響が明記されています。
2. プロジェクトのパッケージマネージャーを使用して ambercast をアップグレードし、`npx ambercast check --json` を実行します。check はレポートを返し、信頼できない検出結果に対して終了コード `4` を選択します。
3. check が終了コード `4` で終了した場合は、`npx ambercast generate` を実行してプランとグラウンディングの差分を確認します。生成処理はジェネレーターとレポート結果を構成します。
4. 依存関係と、受け入れたコンパニオンの変更をまとめてコミットします。その後に check を再実行して、最終的な状態を観測可能にします。

## 確認 {#verification}

再生成を受け入れた後、`npx ambercast check` が終了コード `0` で終了することを確認します。

## 関連情報 {#related}

リンク: [変更履歴](/ambercast/ja/reference/changelog/), [鮮度とダイジェスト](/ambercast/ja/spec/freshness/), [ambercast check](/ambercast/ja/reference/cli/check/), [ambercast generate](/ambercast/ja/reference/cli/generate/), [生成された差分のレビュー](/ambercast/ja/how-to/review-generated-diffs/)
