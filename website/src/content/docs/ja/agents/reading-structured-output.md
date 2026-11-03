---
title: 構造化出力の読み取り
description: JSONレポートは`command`、`run`の`reportPersistence`、`errors[].code`、各`results[].status`の順に読み、最初に対応が要るものから動く。
---

エージェントはこのページで、レポートのどこから読み、どの結果で止まり、どの結果なら続けてよいかを決める。レポートは`command`で分かれ、`generate`、`run`、`check`、`heal`、`review`のどれかになる。

## 判断の木 {#decision-tree}

`command`、`reportPersistence`、`errors[].code`、`results[].status`を、この順に読む。`reportPersistence`を持つのは`run`だけで、値は`persisted`、`failed`、`not-attempted`のいずれかである。スキーマには`review`の分岐があるが、CLIに`review`コマンドはない。

`errors[].code`が1つでもあれば、ファイルを変える前に、オペレーション規約のエラー表を使う。コードがなければ、そのコマンドの規則で`results[].status`を1行ずつ分類する。

~~~
Read command.
├─ run: read reportPersistence first.
│  ├─ failed → keep the stdout report; treat persistence as an environment problem.
│  └─ persisted/not-attempted → continue to errors.
├─ generate/check/heal/review → continue to errors.
Read every errors[].code.
├─ any code → use the operating contract's report-error table before changing files.
└─ none → classify every results[].status for this command.
   ├─ listed/skipped → discovery-only or incomplete, not success.
   ├─ generate failed, run failed/error → read the evidence; do not heal or regenerate automatically.
   ├─ check other than fresh/fresh-without-grounding → artifacts are untrustworthy; use stale-artifact recovery.
   ├─ heal unresolved/partially-healed → report it; do not retry automatically.
   └─ any other status → continue only within approved scope.
~~~

関連リンク: [レポート](/ambercast/ja/reference/reports/)、[オペレーション規約](/ambercast/ja/agents/operating-contract/#next-action-by-report-error)

## ステータスはコマンドごとの証拠を表す {#status-by-command}

`results[].status`の語彙はコマンドごとに違い、`listed`は検出だけ、`skipped`は実行の証拠を持たない。どちらも成功ではない。

- `generate`は`generated`、`would-generate`、`skipped-fresh`、`listed`、`failed`、`skipped`を使う。
- `run`は`passed`、`failed`、`error`、`listed`、`skipped`を使う。
- `check`は`fresh`、`stale`、`missing-plan`、`missing-grounding`、`stale-grounding`、`invalid-grounding`、`fresh-without-grounding`、`orphaned-plan`、`orphaned-grounding`、`invalid-artifact-name`、`listed`、`skipped`を使う。
- `heal`の完了した行は`status: completed`で、`repairOutcome`が`healed`、`partially-healed`、`unresolved`、`no-changes-needed`のいずれかになる。`listed`と`skipped`の行は識別情報だけを持つ。

関連リンク: [generateの結果](/ambercast/ja/reference/reports/#generate-results)、[runの結果](/ambercast/ja/reference/reports/#run-results)、[checkの結果](/ambercast/ja/reference/reports/#check-results)、[healの結果](/ambercast/ja/reference/reports/#heal-results)、[計画のライフサイクルと鮮度](/ambercast/ja/explanation/plan-lifecycle/#grounding-binding)

## 終了コードはバッチ全体の合図 {#exit-code-signal}

終了コードは、各行とエラーを読んだ後で、バッチ全体の合図として使う。レポートのエラーは、コードに加えて範囲と種別を`errors[]`に持つ。

関連リンク: [終了コード](/ambercast/ja/reference/exit-codes/#aggregation-priority)、[オペレーション規約](/ambercast/ja/agents/operating-contract/#next-action-by-exit-code)
