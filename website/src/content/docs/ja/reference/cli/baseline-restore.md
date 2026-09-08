---
title: ambercast baseline と ambercast restore
description: ambercast baseline および ambercast restore で計画されている外部境界、ストレージ、および鮮度検知の仕様。
status: planned
sidebar:
  badge:
    text: Planned
    variant: caution
---

:::caution
`ambercast baseline` および `ambercast restore` は計画中の機能であり、バージョン 0.3.1 には実装されていません。本ドキュメントには現在の動作ではなく、計画されている設計上の動作を記載しています。
:::

`ambercast baseline` および `ambercast restore` は、データベースのキャプチャと復元を担う計画中のコマンドです。計画されているデータベース境界は DB リセット設計によって定義されています。

## ステータス {#status}

`ambercast baseline` および `ambercast restore` はバージョン 0.3.1 には実装されていません。CLI パーサーは `generate`、`run`、`check`、`heal` のみを受け付け、それ以外のコマンドはすべて拒絶します。両コマンドの計画されているデータベース境界は、DB リセット設計によって定義されています。

リンク: [CLIの概要](/ambercast/ja/reference/cli/overview/#command-surface), [設定](/ambercast/ja/reference/configuration/#key-table)

## 計画されている境界 {#planned-boundary}

| コマンド / オプション | 計画されている規約 |
| --- | --- |
| `baseline [--target <name>] [--list] [--clear] [--force] [--json]` | 現在のデータベースを選択されたターゲットのベースラインとしてキャプチャします。 |
| `baseline --force` | 既存のベースラインの上書きを許可します。TTY の有無にかかわらず指定が必要であり、主キーが存在しない場合のリンターを回避することはありません。 |
| `baseline --list` | ベースラインのメタデータのみを表示します。 |
| `baseline --clear` | 選択されたベースラインを削除します。存在しない場合も冪等に成功します。 |
| `restore [--target <name>] [--json]` | 手動デバッグまたは QA のために、選択されたターゲットをベースラインへ復元します。 |
| `run --no-reset` | その実行においてリセットとフックをスキップします。デバッグを意図しており、CI での使用は推奨されません。 |
| `check` 統合 | DB 接続を開くことなく、DB 設定の形式、解決可能なシークレット、ベースラインの存在、および `configDigest` を検証します。 |

キャプチャと復元は相反する効果を持つため、別個のフラットな動詞として定義されています。`reset` という名称やモードフラグによる設計は、誤用を招きやすいため却下されました。

## 計画されているストレージと鮮度 {#planned-storage-and-freshness}

| 概念 | 計画されている規約 |
| --- | --- |
| 配置場所 | 解決された設定ディレクトリからの相対パス `.baseline/<target>/`。設定変更不可であり、`runsDir` とは分離され、gitignore への追加が意図されています。 |
| メタデータ | `meta.json` に target、driver、capturedAt、capabilities、configDigest、sourceFingerprint、および artifactRef を記録します。 |
| `configDigest` | 未解決の driver / connection / driverOptions プレースホルダーのハッシュ。不一致は設定ドリフトとなり、自動再キャプチャは行われず終了コード 2 で終了します。 |
| `sourceFingerprint` | シークレット以外のリモート識別情報のハッシュ。シークレット解決後の不一致は終了コード 3 で終了します。 |
| プランの鮮度 | いずれの DB 鮮度値も Plan の `inputsDigest` には含まれません。 |

`resetPerCase: true` の場合、リセットは最初のケースの実行前および各ケースの実行後に実行され、その後に順序付けられた境界フックが実行されます。そして次のケースの前にバリアプローブが成功する必要があります。

リセットまたはバリアプローブの失敗時は、既定では影響を受けたケースをエラーとして記録して実行を継続します。`onResetFailure: "abort"` が指定されている場合は実行全体を停止し、いずれの経路でも終了コード 3 で終了します。フックの失敗時は該当ケースのみをエラーとして実行を継続します。

計画されている設定エラー（`baseline-missing`、未解決のターゲット／ドライバー、設定ドリフト、ベースラインの競合、無効なフラグの組み合わせ）は終了コード 2 で終了します。DB 接続エラー、リセット失敗、フック失敗、および source-fingerprint の不一致は終了コード 3 で終了します。集計の優先順位は `2 > 3 > 4 > 1 > 5 > 0` のまま維持されます。

人間向け出力および JSON 出力では、`mode` を `captured` または `restored` として明記する必要があります。

## 未決事項 {#undecided-items}

| 状態 | 項目 |
| --- | --- |
| 明示的に未決 | `baseline` および `restore` を導入するリリース。両コマンドともフィクスチャ機能に紐付いています。 |
| 予約（未決ではない） | `--all-targets`、`--list --live`、追加のフックフェーズ、および並行ワーカー用の `db.<target>` サブキーは v2 の予約項目であり、本計画インターフェースの一部ではありません。 |

リンク: [レポート](/ambercast/ja/reference/reports/#envelope), [MCP ツール](/ambercast/ja/reference/mcp-tools/#planned-tool-contract), [鮮度とダイジェスト](/ambercast/ja/spec/freshness/)
