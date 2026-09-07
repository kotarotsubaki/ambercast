---
title: ambercast init
description: 計画されている ambercast init のスキャフォールディング機能と未決定の設計事項について説明します。
status: planned
sidebar:
  badge:
    text: Planned
    variant: caution
---

:::caution
`ambercast init` はバージョン 0.3.1 では実装されていません。現行のパーサーは `generate`、`run`、`check`、`heal` のみを受け付け、その他のコマンドは拒否されます。本ページで説明している内容は計画中の設計仕様であり、現行の動作ではありません。
:::

`ambercast init` は、プロジェクトの初期設定を行うスキャフォールディング機能として計画されているコマンドです。本リファレンスでは、計画されているインターフェース仕様と未決定の設計項目について説明します。

## ステータス {#status}

`ambercast init` はバージョン 0.3.1 では実装されていません。CLI パーサーは `generate`、`run`、`check`、`heal` のみを受け付け、それ以外のコマンドはすべて拒否します。計画されているスキャフォールディングのインターフェース仕様は、CLI 設計において定義されています。

関連情報:
- [CLIの概要](/ambercast/ja/reference/cli/overview/#command-surface)
- [5分で動かす最初のテスト](/ambercast/ja/tutorials/quick-start/)

## 計画されているインターフェース {#planned-interface}

| 構文 / 動作 | 計画されている契約 |
| --- | --- |
| `init [--dir <path>] [--yes]` | `ambercast.config.json` およびサンプルの `test.md` を準備します。 |
| `--yes`, `-y` | スキャフォールディングを非対話形式で完了します。 |
| 既存の設定 | 警告を表示して停止します。説明文では `--force` で上書きするとされています。 |
| CIワークフロー | 生成しません。 |
| 設計共通フラグ | `--config <path>`、`--no-color`、`--version`、`--help` が、計画されている全コマンド共通として宣言されています。 |

計画されている本コマンドは設定ファイルおよびサンプルのテストファイルを準備するために存在し、Plan の生成やテストの実行は行いません。

設計における共通の非対話判定ルールは `!process.stdout.isTTY || CI` です。`CI` は定義されており、かつ空でも `"false"` でもない場合にアクティブとみなされます。

## 未決定の項目 {#undecided-items}

| 状態 | 項目 | 未決のままとなっている理由 |
| --- | --- | --- |
| ギャップ | `--force` の正確なインターフェース | コマンドの概要構文およびコマンドとフラグのマトリクスから `--force` が省略されている一方、同一コマンドの説明文では `--force` に上書き動作が割り当てられており、未確認の計画事項となっています。 |
| 未規定 | 非対話時の拒否動作 | 設計上 `init` は共有非対話ルールのコンシューマと位置付けられていますが、`--yes` が指定されていない場合に拒否されるのか、あるいはどのような結果や終了ステータスになるのかは記載されておらず、未確認となっています。 |
| 明示的に未決 | `init` に関してはなし | 設計において「未決」とラベル付けされているのは `baseline` と `restore` のみであり、`init` の項目にはそのラベルが付与されていません。 |

関連情報:
- [設定](/ambercast/ja/reference/configuration/#file-selection)
- [ターゲットの設定](/ambercast/ja/how-to/configure-targets/)
