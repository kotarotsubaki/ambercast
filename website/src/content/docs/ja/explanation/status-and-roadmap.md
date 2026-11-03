---
title: ステータスとロードマップ
description: 現行リリースが実装している範囲、計画中の機能、1.0より前のバージョンの扱いを説明する。
---

現行のCLIは `init`、`generate`、`run`、`check`、`heal`、`view`、`mcp` の7つのサブコマンドを持つ。`review` とbaseline/restoreは計画中だ。1.0より前は、スキーマとプロデューサーの変更で計画（plan）の再生成が必要になる。

## 現行リリースで実装済み {#implemented}

CLIパーサーは、`init`、`generate`、`run`、`check`、`heal`、`view`、`mcp` の7つのサブコマンドを公開している。`ambercast mcp` は、stdio上で6つのツールを提供する。

ブラウザーはChromiumだけに対応する。

1.0より前は、マイナーリリースにも破壊的変更が入りうる。スキーマやプロデューサーの変更は、既存の計画の再生成を求める。たとえば0.2.0では、プロデューサー契約の変更で0.1.0の計画が `stale` になった。どの版で再生成が必要になるかは、[互換性](/ambercast/ja/reference/compatibility/#regeneration-boundary)と[0.2.0の変更履歴](/ambercast/ja/reference/changelog/#release-020)で確かめられる。

関連リンク: [CLIの概要](/ambercast/ja/reference/cli/overview/)、[互換性と再生成](/ambercast/ja/reference/compatibility/)、[変更履歴](/ambercast/ja/reference/changelog/)

## 現行の範囲より後の計画 {#planned-after-current-boundary}

`review` と、baseline/restoreは計画中だ。ブラウザーは、FirefoxとWebKitへの対応を計画している。クラウド版も計画している。MCPツールは、すでに使える。

関連リンク: [ambercast review](/ambercast/ja/reference/cli/review/)、[MCPサーバー](/ambercast/ja/agents/mcp-server/)

## バージョン方針 {#version-policy}

公開済みのパッケージバージョンは、[互換性テーブル](/ambercast/ja/reference/compatibility/#compatibility-table)にまとめている。製品は、MVPまで0.x系にとどまる。

関連リンク: [変更履歴](/ambercast/ja/reference/changelog/)、[設計思想](/ambercast/ja/philosophy/)
