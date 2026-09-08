---
title: 実行するテストの選択
description: 実行対象とするテストプロンプトを選択・フィルタリングするための手順です。
---

ambercast で実行するテストを選択・フィルタリングするための手順です。既定のディスカバリーでは `**/*.test.md` が対象となり、runs、plans、およびグラウンディングのコンパニオンは無視されます。

## 前提条件 {#prerequisites}

- 既定のディスカバリーは `**/*.test.md` に一致し、runs、plans、およびグラウンディングのコンパニオンを無視します。

## 手順 {#steps}

1. `npx ambercast run tests/ambercast/sign-in.test.md --list` を実行します。位置引数はリテラルのプロンプトパスとして扱われ、`--list` はリプレイを実行せずに結果を返します。
2. `npx ambercast run --grep 'sign-in' --list` を実行します。パーサーによってディスカバリーのフィルタリング用正規表現が構築されます。
3. 有効な設定ファイルに `"testMatch":["**/*.test.md"],"testIgnore":["**/.runs/**"]` を記述します。一致する ignore が存在する場合、そのパスが `testMatch` に一致していても除外されます。
4. `--` で始まるリテラルパスに対して `npx ambercast run --list -- --literal.test.md` を実行します。`--list` などのフラグはセパレーターの前に配置しなければなりません。`--` より後の引数はすべてリテラルの位置パスとして扱われるため、末尾に置かれた `--list` はファイル名として処理されます。

## 確認 {#verification}

- 選択されたパスが報告される場合、`--list` の終了コードは `0` になります。一致するファイルが 0 件のケースは、意図的な場合にのみ `--allow-empty` で解決してください。

## 関連情報 {#related}

リンク: [ディスカバリーパターン](/ambercast/ja/reference/discovery-patterns/)、[ambercast run](/ambercast/ja/reference/cli/run/)、[ambercast generate](/ambercast/ja/reference/cli/generate/)、[設定](/ambercast/ja/reference/configuration/)
