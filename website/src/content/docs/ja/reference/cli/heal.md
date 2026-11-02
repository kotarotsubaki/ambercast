---
title: ambercast heal
description: ambercast heal のフラグ、修復の段階、上限、認可、CI での扱い、書き込みの挙動のリファレンス。
---

`ambercast heal` は計画（plan）とグラウンディングのコンパニオンを修復する。対象のプロンプトを選び、確定せずに修復を測定し、書き込みを認可できる。

## フラグ {#flags}

`files` を渡さないと、heal は探索でプロンプトを選ぶ。

| フラグ | 値 | 効果 | 既定値 |
| --- | --- | --- | --- |
| files | path[] | リテラルのプロンプト。未指定なら探索 | discovery |
| --dry-run | boolean | バッファした計画とグラウンディングの変更を確定せずに、修復だけを測定する | false |
| --yes, -y | boolean | 非対話で確定することを認可する | false |
| --ai | claude\|codex | プロバイダーの上書き | omitted |
| --allow-empty | boolean | 空の選択を許可する | false |
| --list | boolean | 修復せずに一覧を出す | false |
| --json | boolean | JSON エンベロープで出力する | false |
| --no-color | boolean | ANSI の色を無効にする | false |

## 修復モデル {#repair-model}

完了した修復の結果は `healed`・`partially-healed`・`unresolved`・`no-changes-needed` のどれかである。それぞれ、取りうる `application` と `stopReason` の値が決まっている。

heal は最大 3 段階で修復する。

1. 先にグラウンディングを修復する。
2. 次に、1 つのステップか計画の後半を修復する。
3. 前の段階で直らず、ケースの期限にも達していないときだけ、計画の全体を修復する。

第 3 段階は AI 実行器を解決して生成を呼ぶため、実際のプロバイダーを呼び出すことがある。

heal は、シークレットの同意を新たに判断しない。第 2 段階の候補に不正なシークレット名、許可リストの違反、環境変数との衝突があると、`secret-name-invalid` で却下する。第 3 段階の候補が論理的なシークレット名の集合全体を変えると、`stage3Rejection.reason: "secret-set-changed"` で却下する。この却下では、計画とグラウンディングのどちらも更新しない。

CLI の人間向け出力は、続けて `hint: ` と下のヒントを表示する。`<file>` の部分は実際のプロンプトのパスに置き換わる。`--json` の出力は `stage3Rejection` を含み、ヒントは含まない。

`秘匿値の構成が変わった。ambercast generate --force <file> で再生成し同意を取り直す`

## 上限 {#limits}

- `heal.maxStepRepairs` は、設定した場合、段階的な修復で実際に起動するプロバイダー呼び出しの正の上限になる。要素の確認は数え、フェイルクローズの基準測定と第 3 段階は数えない。
- `heal.caseTimeoutMs` は、ケース全体の受け付け期限を表す正の値である。既定値は `300000` ms である。

## 確認 {#confirmation}

`--dry-run` を除き、heal は認可を得てからでないと修復の成果物を確定しない。`--yes` は非対話で認可する。

## CI {#ci}

`--list` を除き、CI での heal は `ci.heal` が `true` でないと拒否される。

## 前提条件と書き込み {#preconditions}

`--list` を除き、プロンプトの計画を読み込んだ後は、その計画が参照するすべてのターゲットに `healReplayIsolation: "idempotent"` が必要である。満たさないと、heal はそのプロンプトを `CONFIG_INVALID`（終了コード `2`）で失敗させる。`healReplayIsolation` の既定値は `stateful` である。計画が参照しない他のターゲットは、heal を妨げない。

heal は、認可された確定まで計画とグラウンディングの書き込みをバッファする。ただし、測定ごとの試行の証跡は、認可の前でも `--dry-run` の間でも、`runsDir` 内のストレージに書かれることがある。

終了コードの値と優先順位は[終了コード](/ambercast/ja/reference/exit-codes/#aggregation-priority)が定め、個々のコードは[終了コードの表](/ambercast/ja/reference/exit-codes/#exit-code-table)にある。

関連ページ: [設定](/ambercast/ja/reference/configuration/#grounding)、[レポート](/ambercast/ja/reference/reports/#heal-results)、[ファイルレイアウト](/ambercast/ja/reference/file-layout/#run-artifacts)
