---
title: ステータスとロードマップ
description: ambercastの現在の実装境界、今後の計画、およびバージョン方針について解説します。
---

ambercastの現在の実装境界を明確にし、実装済みの機能と今後の計画を区別して説明します。現行バージョンのCLIパーサーの公開コマンドとプラン再生成の要件を整理し、現時点でのツールの境界を把握できるようにします。

## 現行リリースで実装済み {#implemented}

CLIパーサーは、`init`、`generate`、`run`、`check`、`heal`、`view`、`mcp` を公開しています。MCP サブコマンドは stdio で 6 ツールを提供します。

また、0.3.1 ではプロデューサ契約のフィンガープリントが変更されました。これにより、プロデューサバンドルおよび `inputsDigest` がstale（古くなった状態）になるため、0.3.1 では 0.1.0 のプランの再生成が必要です。

関連情報:
- [CLIの概要](/ambercast/ja/reference/cli/overview/)
- [互換性と再生成](/ambercast/ja/reference/compatibility/)
- [変更履歴](/ambercast/ja/reference/changelog/)

## 現行境界以降の計画 {#planned-after-current-boundary}

`review`、baseline/restore は引き続き計画中です。公式スキルは計画中のままですが、MCP ツールは利用できます。

また、ブラウザ対応に関しては、1.0までにFirefoxとWebKitが計画されています。

関連情報:
- [ambercast review](/ambercast/ja/reference/cli/review/)
- [MCP サーバー](/ambercast/ja/agents/mcp-server/)

## バージョン方針 {#version-policy}

現在公開されているパッケージバージョンは 0.3.1 です。

プロダクトの方針として、0.x の間はCLIのみを提供し、クラウド版とともに 1.0.0 をリリースします。

関連情報:
- [変更履歴](/ambercast/ja/reference/changelog/)
- [設計思想](/ambercast/ja/philosophy/)
