---
title: ambercast generate
description: ambercast generate のフラグ、プロバイダーの解決、シークレットの同意、コンパニオンファイル、終了ステータスのリファレンス。
---

`ambercast generate` は、テストプロンプトから計画（plan）とコンパニオンの成果物を作る。対象はリテラルのファイルパスか、探索で選んだテストである。

## フラグ {#flags}

| フラグ | 値 | 効果 | 既定値 |
| --- | --- | --- | --- |
| files | path[] | リテラルのプロンプト。未指定なら探索 | discovery |
| --force | boolean | 生成を強制する | false |
| --dry-run | boolean | 何も書かずに結果だけを返す。生成が必要なら `would-generate`、計画が新しければ `skipped-fresh` | false |
| --target | name | 生成で使えるターゲットをこの 1 つに限る | omitted |
| --ai | claude\|codex | プロバイダーの上書き | omitted |
| --allow-empty | boolean | 空の選択を許可する | false |
| --list | boolean | 生成せずに一覧を出す | false |
| --json | boolean | JSON エンベロープで出力する | false |
| --config | path | 設定ファイルを明示する | omitted |
| --no-color | boolean | ANSI の色を無効にする | false |

## AI 呼び出し {#ai-calls}

`generate` がプロバイダーの実行器を解決するのは、生成の経路だけである。設定されたプロバイダーと `--ai` の上書きは、この解決処理に渡される。

`--list` は、生成せずに探索の行を返す。

`--dry-run` では、生成が必要な対象は `would-generate` を返し、計画が新しい対象は `skipped-fresh` を返す。どちらの結果も成果物を書かない。新しい計画の分岐はグラウンディングの修復を飛ばし、生成の分岐は書き込みの前で戻るからだ。

## シークレットの同意 {#secret-consent}

生成は、候補を作ってから同意を取る順で進む。まず候補の計画を作り、`secrets.allow` に無いシークレット名を見つけ、計画かグラウンディングを書く前に対話で承認を求める。`--force` でも、新しい計画を再生成するときは同じ同意の境界に従う。`--dry-run` は成果物を書かず、同意も保存しない。

非対話の環境や、同意を断った場合は、許可されていない候補が `SECRET_CONSENT_REQUIRED` で失敗し、終了コード `2` になる。CI で実行する前に、確認済みの名前を `secrets.allow` に加える。`"*"` は名前ごとの確認を省いて AI が提案したどの名前も受け入れるため、強いリスクを伴う。安全な手順は[シークレットの管理](/ambercast/ja/how-to/manage-secrets/)を参照する。

## 副作用と終了コード {#side-effects}

`<name>.test.md` という名前のプロンプトには、同じ場所に計画とグラウンディングのコンパニオンが対応する（[ファイルレイアウト](/ambercast/ja/reference/file-layout/#companions)を参照する）。

結果ステータスは `generated`・`would-generate`・`skipped-fresh`・`listed`・`failed`・`skipped` である（[レポート](/ambercast/ja/reference/reports/#generate-results)を参照する）。`would-generate` は、生成が必要な対象に対する `--dry-run` のステータスである。`skipped-fresh` は `--dry-run` でも返る。

終了コードの値と優先順位は[終了コード](/ambercast/ja/reference/exit-codes/#aggregation-priority)が定め、個々のコードは[終了コードの表](/ambercast/ja/reference/exit-codes/#exit-code-table)にある。`--allow-empty` は、空の選択が終了コード `5` に寄与するかどうかを決める（[設定](/ambercast/ja/reference/configuration/#file-selection)を参照する）。
