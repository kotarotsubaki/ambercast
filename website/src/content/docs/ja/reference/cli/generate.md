---
title: ambercast generate
description: ambercast generate コマンドのフラグ仕様および成果物生成に関するリファレンスです。
---

`ambercast generate` は、テストプロンプトに対応する Plan および Grounding 成果物を生成するためのコマンドです。本リファレンスでは、コマンドラインフラグの仕様、AIプロバイダ実行エンジンの解決、成果物の生成に伴う副作用、および終了ステータスについて解説します。

## フラグ {#flags}

`ambercast generate` で利用可能なフラグの一覧です。ファイル指定を省略した場合は自動検出（discovery）が実行されます（ファイル選択の詳細は [設定](/ambercast/ja/reference/configuration/#file-selection) を参照してください）。

| flag | value | effect | default |
| --- | --- | --- | --- |
| files | path[] | literal prompts; absent selects discovery | discovery |
| --strict | boolean | strict generation policy | false |
| --force | boolean | force generation | false |
| --dry-run | boolean | preview: `would-generate` only when generation is needed; fresh Plan returns `skipped-fresh`; neither outcome writes | false |
| --target | name | select target | omitted |
| --ai | claude\|codex | provider override | omitted |
| --allow-empty | boolean | allow empty selection | false |
| --list | boolean | list without generation | false |
| --json | boolean | JSON envelope | false |
| --config | path | explicit config | omitted |
| --no-color | boolean | disable ANSI | false |

## AI呼び出し {#ai-calls}

`ambercast generate` は、プロバイダ実行エンジン（provider executor）の解決を、その生成依存関係（generation dependency）を通じてのみ行います。設定済みのプロバイダおよび `--ai` によるオーバーライド指定は、このリゾルバへ渡されます。

フラグによる実行制御と生成動作は以下のとおりです。

- `--list` は生成を実行せず、検出行（discovery rows）を返します。
- `--dry-run` を指定した場合、生成が必要なターゲットに対しては `would-generate` を返し、最新状態の Plan（fresh Plan）に対しては `skipped-fresh` を返します。
- `--dry-run` のいずれの結果においても、成果物への書き込みは行われません。fresh ブランチでは Grounding の修復（Grounding repair）がスキップされ、生成ブランチでは実際の書き込み処理の前にリターンします。

## 副作用と終了コード {#side-effects}

`<name>.test.md` という名称のプロンプトは、その隣に配置される Plan および Grounding のコンパニオンファイルに対応付けられます（詳細は [ファイルレイアウト](/ambercast/ja/reference/file-layout/#companions) を参照してください）。

### 結果ステータス

コマンド実行結果のステータスには、`generated`、`would-generate`、`skipped-fresh`、`listed`、`failed`、`skipped` があります（詳細は [レポート](/ambercast/ja/reference/reports/#generate-results) を参照してください）。

- `would-generate`: 生成が必要なターゲットに対してのみ返される `--dry-run` 時のステータスです。
- `skipped-fresh`: 最新状態の Plan に対して返されるステータスであり、`--dry-run` モードでも有効です。

### 終了コード

プロセスコードの値およびその集約の優先順位は [終了コード](/ambercast/ja/reference/exit-codes/#aggregation-priority) に従います（終了コード一覧については [終了コード](/ambercast/ja/reference/exit-codes/#exit-code-table) を参照してください）。空の選択（empty selection）が行われた際に終了コード 5 を計上するかどうかは、`--allow-empty` フラグによって制御されます。

関連リンク: [ファイルレイアウト](/ambercast/ja/reference/file-layout/#companions)、[レポート](/ambercast/ja/reference/reports/#generate-results)、[終了コード](/ambercast/ja/reference/exit-codes/#exit-code-table)、[設定](/ambercast/ja/reference/configuration/#file-selection)
