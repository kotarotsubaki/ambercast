---
title: グラウンディングのライトバック制御
description: ローカル環境やCI環境において、テスト実行後に変更されたグラウンディングキャッシュを書き戻す動作を制御する手順を説明します。
---

ambercast でテストを実行した際、変更されたグラウンディングキャッシュをファイルへ書き戻す（ライトバックする）動作は、設定や実行時オプションによって制御できます。開発フローに合わせて、ローカル環境での自動永続化、差分確認を重視する明示的な更新、そして意図しない書き換えを防ぐCI環境の運用まで、目的に応じた設定手順を説明します。

## 前提条件 {#prerequisites}

設定を変更する前に、以下の設定値の取り扱いを確認してください。

- `grounding.localWriteBack` には `auto` または `explicit` を指定します。
- `ci.updateGroundingCache` は真偽値（boolean）を受け付けます。

## 手順 {#steps}

### 1. ローカル環境で自動的に永続化する

ローカルでのテスト実行時にキャッシュを自動で書き戻すには、設定ファイルに以下を定義します。

```json
{"$schema":"https://kotarotsubaki.github.io/ambercast/schemas/config.schema.json","grounding":{"localWriteBack":"auto"}}
```

上記の `$schema` は公開されている設定スキーマの URL です。なお、ローカル環境におけるデフォルトの挙動はすでに `auto` になっています。

### 2. レビューを挟んで明示的に永続化する

変更されたキャッシュの内容を確認してから書き戻したい場合は、`localWriteBack` を `explicit` に設定します。そのうえで、更新を適用したいタイミングでのみ `--update-cache` を付与して実行します。

```json
{
  "grounding": {
    "localWriteBack": "explicit"
  }
}
```

CLI パーサーがこの明示的な要求を受け取り、ランタイムへと処理を引き渡します。

### 3. CI環境で実行する

CI環境では、`ci.updateGroundingCache` を `false` のまま維持し、実行時にも `--update-cache` を指定しません。CI環境のデフォルトでは、明示的にオプトインしない限り書き戻しは行われません。

## 検証 {#verification}

意図した通りに実行されているかを検証するには、`--json` フラグを付けて実行します。

```bash
npx ambercast run --update-cache tests/ambercast/<name>.test.md
```

終了コード `0` はテストバッチ全体が合格した場合にのみ返されます。コミットを作成する前に、変更されたグラウンディングの差分（diff）を確認してください。

## 関連情報 {#related}

- [設定](/ambercast/ja/reference/configuration/)
- [ambercast run](/ambercast/ja/reference/cli/run/)
- [生成された差分のレビュー](/ambercast/ja/how-to/review-generated-diffs/)

```bash
npx ambercast run --json tests/ambercast/<name>.test.md
```
