---
title: 他のCIプラットフォームでの実行
description: GitLab CIや汎用ランナー環境でambercastを実行するためのポータブルなCI設定手順です。
---

GitLab CI や汎用ランナー環境で ambercast を実行するためのポータブルな CI レシピです。

## 前提条件 {#prerequisites}

- `run` は `--cache-only`、`--update-cache`、`--allow-empty`、`--list` を受け付けますが、`--config` オプションは持ちません。

## 手順 {#steps}

1. GitLab CI または汎用ランナーにおいて、プロジェクトの Node 依存関係と Chromium を `npx playwright-core install chromium` でインストールし、そのプラットフォームのキャッシュ機構を使用してブラウザのインストールディレクトリをキャッシュします。リポジトリは Chromium を必要としており、このインストールコマンドが文書化されています。完全にグラウンディングされたリプレイは、プロバイダーの解決なしで進行する場合があります。
2. `npx ambercast check` を実行し、続いて `npx ambercast run` を正確に実行します。呼び出し時の `report.json` をアップロードする前に、事前のレビュー、アクセス制限、および短い保持期間を適用し、これらの管理策が利用可能な場合にのみアップロードしてください。シェルの順次実行により、`check` が正常終了した場合にのみ `run` に到達します。`run` は呼び出しディレクトリに1つのレポートを書き出し、レポートのステップ結果には `actual` のテキストやアクセシビリティのスナップショットが保持されることがあります。
3. 呼び出し時のエビデンスやスクリーンショットは、同様の事前レビュー、アクセス制限、および短い保持期間を適用した上で、明示的なオプトインによってのみアップロードします。失敗したライブブラウザのステップは呼び出しエビデンスディレクトリ配下に PNG スクリーンショットを保存することがあり、セーフティスキャンでは canvas、画像、CSS でレンダリングされたピクセル、あるいはスキャンからスクリーンショット取得までのタイミングの隙間を検出できません。
4. `heal` を呼び出さず、`--update-cache` も渡さないでください。CI の既定値では `heal: false` および `updateGroundingCache: false` となっています。実際の修復は `ci.heal: true` による明示的なオプトインであり、CI の既定のアクションではありません。

## 確認 {#verification}

- プロセスの終了コードに基づいてジョブの成否を判定し、その解釈には [終了コード](/ambercast/ja/reference/exit-codes/) を使用します。信頼できないアーティファクトと環境の障害は、プロセス上異なるカテゴリです。

## 関連情報 {#related}

関連リンク: [GitHub Actions で ambercast を実行する](/ambercast/ja/tutorials/github-actions/), [ambercast check](/ambercast/ja/reference/cli/check/), [ambercast run](/ambercast/ja/reference/cli/run/), [終了コード](/ambercast/ja/reference/exit-codes/), [設定](/ambercast/ja/reference/configuration/)
