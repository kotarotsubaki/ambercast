---
title: stale（古くなった状態）のアーティファクトの復旧
description: check のステータスに応じたアーティファクトの復旧手順と期待される結果を説明します。
---

`ambercast check` が報告する各ステータスに応じて、アーティファクトを復旧するための正確なアクションと期待される結果を説明します。

## 前提条件 {#prerequisites}

`ambercast check` は読み取り専用です。その依存関係にはプロバイダー、ブラウザ、イベントシンク、および変更可能なストレージは含まれません。

## 手順 {#stale}

| check ステータス | 正確な次のアクション | 期待される観察可能な結果 |
| --- | --- | --- |
| `fresh` | `npx ambercast check` を実行し、アーティファクトの変更は行いません。 | 終了コード `0` で終了します。 |
| `fresh-without-grounding` | `npx ambercast generate tests/ambercast/<name>.test.md` を実行します。 | `generate` はディスク上の隣接する Grounding ファイルを修復し、その後 `planFile` のみを伴う `skipped-fresh` を報告します。Grounding のパスは報告しません。 |
| `stale` | `npx ambercast generate tests/ambercast/<name>.test.md` を実行し、差分を確認します。 | 新規の生成は終了コード `0` で終了することがあります。依然として信頼されていない（untrusted）check は終了コード `4` で終了します。 |
| `missing-plan` | バージョン管理から Plan を復元するか、`npx ambercast generate tests/ambercast/<name>.test.md` を実行します。 | 生成結果に `planFile` が含まれます。 |
| `missing-grounding` | `npx ambercast generate tests/ambercast/<name>.test.md` を実行します。 | Plan が fresh な場合、`generate` はディスク上に隣接する Grounding ファイルを作成し、`planFile` のみを伴う `skipped-fresh` を返します。`groundingFile` は Generate の結果フィールドではありません。 |
| `stale-grounding` | `npx ambercast generate tests/ambercast/<name>.test.md` を実行し、新しい Grounding を確認します。 | 有効な場合、check は整合性検証の失敗を出力しなくなります。 |
| `invalid-grounding` | プロンプトから再生成し、新しい Grounding を確認します。 | 有効な場合、check は整合性検証の失敗を出力しなくなります。 |
| `orphaned-plan` | プロンプトを復元するか、プロジェクトの通常のレビュープロセスを通じて孤立したアーティファクトを削除します。 | 次回の check ではその孤立の指摘が含まれなくなります。 |
| `orphaned-grounding` | プロンプトを復元するか、プロジェクトの通常のレビュープロセスを通じて孤立したアーティファクトを削除します。 | 次回の check ではその孤立の指摘が含まれなくなります。 |
| `invalid-artifact-name` | 通常のレビューを通じて無効なコンパニオンの名前を変更または削除します。 | 次回の check では、その逆変換が不可能なアーティファクトが報告されなくなります。 |
| `listed` | 鮮度を検査するために、`--list` なしで再実行します。 | `--list` は Plan または Grounding の読み取りを実行しませんでした。 |
| `skipped` | 中断を解消した後に再実行します。 | 実行スコープの `INTERRUPTED` エラーは終了コード `3` に寄与します。 |

## 確認 {#verification}

`npx ambercast check --json` を実行します。より高い優先度を持つ候補が残っていない場合にのみ、終了コード `0` が期待されます。

## 関連情報 {#related}

- [ambercast check](/ambercast/ja/reference/cli/check/)
- [ambercast generate](/ambercast/ja/reference/cli/generate/)
- [エラーコード](/ambercast/ja/reference/error-codes/)
- [終了コード](/ambercast/ja/reference/exit-codes/)
- [ambercast heal](/ambercast/ja/reference/cli/heal/)
- [生成された差分のレビュー](/ambercast/ja/how-to/review-generated-diffs/)
