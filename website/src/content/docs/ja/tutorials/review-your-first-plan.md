---
title: 最初の plan と grounding の読み込み
description: テストプロンプトから解決される plan と grounding のファイル配置を確認し、freshness を検証します。
---

テストプロンプトに対応する plan および grounding のファイル配置を確認し、`npx ambercast check` を使ってその freshness を検証する手順を学びます。リゾルバーがどのように各成果物のパスを導出するのか、そして check コマンドがどのようなレポートを出力するのかを順に見ていきましょう。

## 手順 {#steps}

1. `tests/ambercast/sign-in.ambercast.plan.json` を開き、`schemaVersion`、`source.inputsDigest`、および `steps` を確認します。リゾルバーは、プロンプトの正確な `.test.md` サフィックスを置き換えることでこのパスを導出します。
2. `tests/ambercast/sign-in.ambercast.grounding.json` を開き、その `schemaVersion`、`planDigest`、および `entries` を確認します。リゾルバーは、同一のプロンプトからペアとなる grounding のパスを導出します。
3. `npx ambercast check tests/ambercast/sign-in.test.md --json` を実行します。check はレポートエンベロープを生成します。fresh な結果のステータスは `fresh` または `fresh-without-grounding` になります。

## 完了状態 {#completion-state}

- このコマンドは、レポート全体に failure、case error、または interruption が一切ない場合にのみ `0` で終了します。選択されたケースが fresh であること単体ではこれを保証しません。check は orphan findings がないかコンパニオン成果物もスキャンするためです。JSON レポートには freshness の結果が出力されます。

## 関連情報

- [計画ドキュメント](/ambercast/ja/spec/plan-document/)
- [グラウンディングドキュメント](/ambercast/ja/spec/grounding-document/)
- [ファイルレイアウト](/ambercast/ja/reference/file-layout/)
- [ambercast check](/ambercast/ja/reference/cli/check/)
- [生成された差分のレビュー](/ambercast/ja/how-to/review-generated-diffs/)
