---
title: 一般的な障害のトラブルシューティング
description: 発生した症状から原因を特定し、次の対応アクションを実行するための手順を説明します。
---

ambercast で発生した症状から原因を特定し、次に取るべき対応アクションを見つけるための手順です。

## 前提条件 {#prerequisites}

無効なフラグ、不正な形式のコマンド引数、またはオプション値の欠落がある場合、stderr に使用方法が出力され、レポートエンベロープなしで終了コード `2` で終了します。

## 手順 {#steps}

| 症状 | 原因 | 次の対応 |
| --- | --- | --- |
| 設定の不備、未解決のシークレット、またはターゲットの不正 | 設定または呼び出し境界の修正が必要です。 | [エラーコード](/ambercast/ja/reference/error-codes/) を確認し、値を推測せずに指定された設定を修正します。 |
| コンパニオンの欠落、stale（古くなった状態）、または信頼できないコンパニオン | コミットされた成果物を現在のエビデンスとして使用できません。 | [stale（古くなった状態）のアーティファクトの復旧](/ambercast/ja/how-to/recover-stale-artifacts/) の該当する行を参照して対応します。 |
| リテラルシークレットまたは帰属不能な権限付与 | Protected IR がシークレット処理の境界を拒否しました。 | [シークレットの管理](/ambercast/ja/how-to/manage-secrets/) を参照してください。プロンプト内にリテラルを記述しないでください。 |
| ブラウザ、プロバイダー、ストレージ、またはクラッシュ | 実行環境に障害が発生しました。 | JSON 出力を保存し、環境を修復した上で、最小限のコマンドを再実行します。 |
| 中断された処理 | バッチ処理が完了していませんでした。 | 中断の原因が解決した後に再実行します。 |
| アサーションの失敗 | 再生されたケースに失敗エビデンスが存在します。 | レポートを確認し、アプリケーションまたはプロンプトを修正してから再実行します。 |
| 選択対象が空 | 指定された選択条件に一致するプロンプトがありませんでした。 | 選択条件を修正するか、意図して空にする場合にのみ `--allow-empty` を使用します。 |

正確なエラー語彙については [エラーコード](/ambercast/ja/reference/error-codes/) を、プロセスステータスの値と優先順位については [終了コード](/ambercast/ja/reference/exit-codes/#priority) を参照してください。

## 確認 {#verification}

影響を受けた最小限のコマンドを再実行し、より優先度の高い状態が残っていないことを確認した上で、終了コード `0` となることを確認します。

## 関連情報 {#related}

リンク: [エラーコード](/ambercast/ja/reference/error-codes/)、[終了コード](/ambercast/ja/reference/exit-codes/)、[ambercast check](/ambercast/ja/reference/cli/check/)、[ambercast generate](/ambercast/ja/reference/cli/generate/)、[ambercast run](/ambercast/ja/reference/cli/run/)、[ambercast heal](/ambercast/ja/reference/cli/heal/)、[stale（古くなった状態）のアーティファクトの復旧](/ambercast/ja/how-to/recover-stale-artifacts/)、[シークレットの管理](/ambercast/ja/how-to/manage-secrets/)、[ターゲットの設定](/ambercast/ja/how-to/configure-targets/)
