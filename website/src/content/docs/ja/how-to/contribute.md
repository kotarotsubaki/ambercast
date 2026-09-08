---
title: 貢献ガイド
description: リポジトリへの貢献手順について説明します。
---

リポジトリへの貢献手順を説明します。本パッケージには `npm test`、`npm run typecheck`、`npm run lint` のスクリプトが宣言されています。

## 前提条件 {#prerequisites}

- パッケージには `npm test`、`npm run typecheck`、および `npm run lint` スクリプトが宣言されています。

## 手順 {#steps}

### 外部コントリビューターのパス

1. 問題や提案を説明する Issue を作成し、その後リポジトリをフォークしてブランチを作成します。これが公開されている外部コントリビューションの流れです。
2. `npm test`、`npm run typecheck`、および `npm run lint` を実行し、Conventional Commits 形式のタイトルでプルリクエストを作成して、レビューでの会話を解決します。リポジトリではこの PR ワークフローが求められます。
3. 脆弱性を報告する場合は、公開の Issue ではなく GitHub Security Advisories を通じて報告します。セキュリティポリシーでは、バージョン、再現手順、および影響範囲を含めた非公開での報告を求めています。

### メンテナーおよびエージェントのワークフロー

- `AGENTS.md` および `.claude/` にはメンテナー向けの AI エージェント自動化について記載されていますが、外部コントリビューターの前提条件ではありません。外部の PR チェックは CI で実行されます。
- メンテナーまたはリポジトリのエージェントは、挙動変更時のテスト順序を含め、`AGENTS.md` に記載の開発ワークフローに従います。

## 確認 {#verification}

- 3つのパッケージコマンドが終了コード `0` で完了することを確認するか、引き渡し前にその失敗内容を記録します。

## 関連情報 {#related}

リンク: [セキュリティポリシー](/ambercast/ja/reference/security-policy/)、[変更履歴](/ambercast/ja/reference/changelog/)。
