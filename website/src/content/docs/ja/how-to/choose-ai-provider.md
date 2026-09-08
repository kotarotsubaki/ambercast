---
title: AIプロバイダーの選択
description: ambercast.config.json、環境変数、または --ai オプションを使用してAIプロバイダーを選択・指定する手順を説明します。
---

ambercast でテストプランを生成する際は、環境や再現性の要件に合わせて利用する AI プロバイダーを選択できます。設定ファイルによるプロバイダーの固定、フォールバックを考慮した自動検出、およびコマンドライン引数による一時的な上書きの手順を解説します。

## 前提条件 {#prerequisites}

設定の `ai.provider` に指定できる値は `claude`、`codex`、または `auto` です。未指定時のデフォルト値は `auto` に設定されています。

## 手順 {#steps}

1. **設定ファイルでプロバイダーを固定する**  
   環境変数 `AMBERCAST_AI_PROVIDER` や `--ai` による上書きを行わない場合、再現性を確保するために `ambercast.config.json` に設定を記述してプロバイダーを固定します。利用可能な選択肢に合わせて、以下のように `claude` を指定するか、`claude` の部分を `codex` に置き換えてください。
```bash
npx ambercast generate --ai codex
```
   これは公開されている設定スキーマの URL です。なお、環境設定は設定ファイルを上書きし、`--ai` オプションは解決された設定を上書きします。

2. **可用性を重視して `auto` を利用する**  
   環境変数やオプションによる上書きを設定しておらず、固定のプロバイダーを選択することよりも可用性を優先したい場合は、`ai.provider` の指定を省略して `auto` を使用します。プロバイダー解決処理では Claude、続いて Codex の順にプローブが実行され、最初に利用可能と確認されたプロバイダーが返されます。

3. **コマンドライン引数でプロバイダーを上書きする**  
   実行時にプロバイダーを切り替えたい場合は、`--ai` オプションを指定してコマンドを実行します。

   コマンドの上書き引数として受け付けられるのは `claude` と `codex` です。無効なプロバイダー文字列を指定した場合は終了コード `2` で終了します。

## 検証 {#verification}

`npx ambercast generate --list` はプロンプトの選択を確認するためだけに使用してください。このコマンドはプロバイダー解決の前に処理を終了して結果を返します。実際に選択されたプロバイダーを検証するには、AI の実行まで到達する新規生成、stale な生成、または `--force` を指定した生成を実行してください。

## 関連情報 {#related}

- [設定](/ambercast/ja/reference/configuration/)
- [環境変数](/ambercast/ja/reference/environment-variables/)
- [ambercast generate](/ambercast/ja/reference/cli/generate/)
