---
title: ambercast baseline と ambercast restore
description: 未実装の ambercast baseline と ambercast restore の、計画中のインターフェース、保存先、鮮度の規則、未決事項。
status: planned
sidebar:
  badge:
    text: Planned
    variant: caution
---

:::caution
`ambercast baseline` と `ambercast restore` は、現行版では実装されていない計画中の機能である。ここに書く内容は意図した設計であり、現在の機能ではない。

:::

このページは、ambercast が計画しているデータベースの境界を記録する。ベースラインの取得と復元は、別々の操作として扱う。

## ステータス {#status}

`ambercast baseline` と `ambercast restore` は、現行版では実装されておらず、利用できる CLI コマンドでもない。2 つは効果が逆なので、別々の単純な動詞にしている。`reset` に統合するコマンドや、モードを切り替えるフラグは、誤用しやすいとして退けた。利用できるコマンドは[CLI の概要](/ambercast/ja/reference/cli/overview/#command-surface)に、現在ある設定キーは[設定](/ambercast/ja/reference/configuration/#key-table)にある。

## 計画中の境界 {#planned-boundary}

| コマンド / オプション | 計画中の契約 |
| --- | --- |
| `baseline [--target <name>] [--list] [--clear] [--force] [--json]` | 現在のデータベースを、選んだターゲットのベースラインとして取得する。 |
| `baseline --force` | 既存のベースラインの上書きを許可する。TTY の有無にかかわらず必要で、主キーなしの検査は回避しない。 |
| `baseline --list` | ベースラインのメタデータだけを表示する。 |
| `baseline --clear` | 選んだベースラインを削除する。すでに無くても成功する。 |
| `restore [--target <name>] [--json]` | 手動のデバッグや QA のために、選んだターゲットをベースラインへ戻す。 |
| `run --no-reset` | その呼び出しだけ、リセットとフックを省く。デバッグ用で、CI では推奨しない。 |
| `check` との連携 | データベース接続を開かずに、データベース設定の形、解決できるシークレット、ベースラインの有無、`configDigest` を検証する。 |

## 計画中の保存先と鮮度 {#planned-storage-and-freshness}

| 概念 | 計画中の契約 |
| --- | --- |
| 場所 | `.baseline/<target>/`。解決した設定ディレクトリからの相対パスで、変更できず、`runsDir` とは別にし、gitignore する想定である。 |
| メタデータ | `meta.json` に target、driver、capturedAt、capabilities、configDigest、sourceFingerprint、artifactRef を記録する。 |
| `configDigest` | 未解決の driver、connection、driverOptions のプレースホルダーのハッシュ。不一致は設定のドリフトで、終了コード `2`、自動での再取得はしない。 |
| `sourceFingerprint` | 秘匿でないリモートの識別情報のハッシュ。シークレット解決後の不一致は終了コード `3` になる。 |
| 計画（plan）の鮮度 | 2 つのデータベースの鮮度の値は、どちらも計画の `inputsDigest` に入らない。 |

`resetPerCase: true` のときは、最初のケースの前と、すべてのケースの後にリセットを行う。その後に順序付きの境界フックを実行し、次のケースへ進む前にバリアプローブが成功しなければならない。

リセットまたはバリアプローブの失敗は、既定では該当のケースをエラーにして実行を続ける。`onResetFailure: "abort"` なら実行を止める。どちらの場合も終了コードは `3` である。フックの失敗でエラーになるのは、そのケースだけで、実行は続く。

計画中の設定の失敗は終了コード `2` になる。`baseline-missing`、未解決のターゲットやドライバー、設定のドリフト、ベースラインの衝突、フラグの不正な組み合わせが該当する。データベース接続、リセット、フックの失敗と、ソースのフィンガープリントの不一致は終了コード `3` になる。集約時の優先順位は `2 > 3 > 4 > 1 > 5 > 0` のままである。

人間向け出力と JSON 出力は、`mode` を `captured` か `restored` で示さなければならない。

## 未決事項 {#undecided-items}

| 状態 | 項目 |
| --- | --- |
| 明示的に未決 | `baseline` と `restore` を導入するリリース。どちらもフィクスチャ機能に結び付いている。 |
| 予約済み、未決ではない | `--all-targets`、`--list --live`、追加のフックフェーズ、並列ワーカーの `db.<target>` サブキーは v2 の予約であり、この計画中のインターフェースには含まれない。 |

共通のレポートエンベロープは[レポート](/ambercast/ja/reference/reports/#envelope)を、ツール側の挙動は[MCP ツール](/ambercast/ja/reference/mcp-tools/#tool-table)を、鮮度の導出は[鮮度とダイジェスト](/ambercast/ja/spec/freshness/)を参照する。
