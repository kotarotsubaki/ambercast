---
title: 生成された差分のレビュー
description: 生成された差分を実践的な順序でレビューし、整合性を検証する手順を説明します。
---

生成された差分を実践的な順序でレビューする手順です。リゾルバーはプロンプトに対して固定のサフィックスを持つ plan および grounding コンパニオンを対応付けます。

## 前提条件 {#prerequisites}

- リゾルバーは、プロンプトに対して固定のサフィックスを持つ plan および grounding コンパニオンを対応付けます。

## 手順 {#steps}

1. 最初に `git status --short` を実行します。そこに表示された未追跡のプロンプト、plan、または grounding の各パスについて、その全内容を確認するか `git diff --no-index /dev/null <path>` を実行してください。変更された追跡対象ファイルには `git diff -- <path>` を使用します。これにより、セマンティックなレビューを行う前に候補となる完全なファイルセットが確定します。
2. `tests/ambercast/<name>.test.md` をレビューし、レビュー内で意図したユーザー結果を明記します。プロンプトの正規化では、1 つの BOM と改行表現以外のコンテンツが保持されます。
3. `tests/ambercast/<name>.ambercast.plan.json` をレビューし、生成されたステップをその結果と比較します。plan は独立した派生コンパニオンです。
4. `tests/ambercast/<name>.ambercast.grounding.json` をレビューし、解決（resolution）の変更と意図の変更を区別します。grounding は独立した派生コンパニオンです。
5. `npx ambercast check tests/ambercast/<name>.test.md` を実行します。check には書き込み、ブラウザ、プロバイダーの機能はありません。

## 確認 {#verification}

- 受け入れられたペアが fresh な状態である場合にのみ、check の終了コードが `0` になることを確認します。

## 関連情報 {#related}

リンク: [計画ドキュメント](/ambercast/ja/spec/plan-document/)、[グラウンディングドキュメント](/ambercast/ja/spec/grounding-document/)、[ambercast check](/ambercast/ja/reference/cli/check/)、[ファイルレイアウト](/ambercast/ja/reference/file-layout/)、[バージョン間のアップグレード](/ambercast/ja/how-to/upgrade/)。
