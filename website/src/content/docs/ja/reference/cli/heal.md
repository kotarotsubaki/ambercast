---
title: ambercast heal
description: ambercast heal コマンドのフラグ、修復モデル、制限事項、認可境界、および副作用に関するリファレンス。
---

`ambercast heal` は、修復処理の実行、認可境界、および関連する副作用を制御します。対象プロンプトの指定やディスカバリーの実行、変更をコミットせずに修復を測定するドライラン、非対話形式でのコミット認可など、実行時の挙動を指定する各種フラグを提供します。

## フラグ {#flags}

| フラグ | 値 | 効果 | デフォルト |
| --- | --- | --- | --- |
| files | path[] | リテラルプロンプト。未指定時はディスカバリーを選択 | discovery |
| --dry-run | boolean | バッファされた Plan または Grounding の変更をコミットせずに修復を測定 | false |
| --yes, -y | boolean | 非対話形式のコミットを認可 | false |
| --target | name | ターゲットを選択 | 省略 |
| --ai | claude\|codex | プロバイダーのオーバーライド | 省略 |
| --allow-empty | boolean | 空の選択を許可 | false |
| --list | boolean | 修復を実行せずに一覧表示 | false |
| --json | boolean | JSON エンベロープ | false |
| --no-color | boolean | ANSI 出力を無効化 | false |

## 修復モデル {#repair-model}

完了した修復結果は、`healed`、`partially-healed`、`unresolved`、および `no-changes-needed` を区別します。これらはそれぞれ制約された `application` と `stopReason` の値を持ちます。

修復はまず Grounding を修復し、次に単一ステップまたは末尾の修復を試行し、最後に必要に応じてプラン全体の修復を実行します。Stage 3 は AI エグゼキューターを解決して生成を呼び出すため、実際のプロバイダーをディスパッチできます。

## 制限事項 {#limits}

`heal.maxStepRepairs` が設定されている場合、実際の増分修復プロバイダーのディスパッチに対する正のハードリミットとなります。これには要素確認が含まれ、キャッシュのみのベースラインおよび Stage 3 は除外されます。

`heal.caseTimeoutMs` は、ケース全体に対する正の受付期限（admission deadline）です。解決される既定値は 300000 ms です。

## 確認 {#confirmation}

`--dry-run` が指定されていない限り、対象となる修復成果物は認可後にのみコミットされます。`--yes` は非対話形式の認可を提供します。

## CI {#ci}

`--list` を除き、`ci.heal` が true でない限り、CI 環境での修復は拒否されます。

## 前提条件と書き込み {#preconditions}

`--list` を除き、選択されたターゲットは冪等でなければなりません。`healReplayIsolation` の既定値は `stateful` です。

Plan および Grounding コンパニオンへの書き込みは認可された確定までバッファされますが、各測定において runsDir に含まれるストレージを介して試行エビデンスが書き込まれる場合があります。この副作用は、認可前や `--dry-run` の実行中にも発生する可能性があります。

プロセス終了コードの値とその優先順位は [終了コード](/ambercast/ja/reference/exit-codes/#aggregation-priority) が管理します。

関連リンク: [設定](/ambercast/ja/reference/configuration/#grounding)、[レポート](/ambercast/ja/reference/reports/#heal-results)、[終了コード](/ambercast/ja/reference/exit-codes/#exit-code-table)、[ファイルレイアウト](/ambercast/ja/reference/file-layout/#run-artifacts)。
