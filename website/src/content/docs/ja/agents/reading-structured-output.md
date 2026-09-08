---
title: 構造化出力の読み取り
description: エージェントがレポートエンベロープに基づいて安全な順序で分岐処理を行い、実行結果を正しく判定するための手順を解説します。
---

ambercast の構造化出力を処理する際は、スキーマ全体を再構築するのではなく、エンベロープに基づいて分岐を行います。`command`、`reportPersistence`、`errors[].code`、そして `results[].status` を安全な順序で評価し、適切なアクションを決定します。

## エンベロープ決定木 {#decision-tree}

レポートエンベロープは、`command` によって generate、run、check、heal、review の各ブランチに判別されます。このうち `reportPersistence` を含むのは run ブランチのみであり、その値は persisted、failed、not-attempted のいずれかです。また、レポートスキーマは `errors[].code` の安定した公開ボキャブラリを提供しています。

~~~
Read command.
├─ run: read reportPersistence first.
│  ├─ failed → retain stdout envelope; treat persistence as an environment problem.
│  └─ persisted/not-attempted → continue to results.
├─ generate/check/heal/review → continue to results.
Read every errors[].code.
├─ any code → use operating-contract's error-code table before changing files.
└─ none → classify every results[].status for this command.
   ├─ failed/error/stale/missing/orphaned → stop at the corresponding contract.
   ├─ skipped/listed → treat as incomplete or discovery-only, not success.
   └─ healthy status → continue only within approved scope.
~~~

リンク: [レポート](/ambercast/ja/reference/reports/), [オペレーション規約](/ambercast/ja/agents/operating-contract/#next-action-by-report-error)

## status はコマンド固有のエビデンス {#status-by-command}

run の実行結果には passed、failed、または error が使用されます。listed はディスカバリー専用であり、skipped は実行エビデンスを持ちません。generate では generated、would-generate、skipped-fresh、listed、failed、および skipped が区別されます。check には fresh、stale（古くなった状態）、plan-missing または grounding-missing、あるいは orphaned の結果が含まれ、さらに fresh-without-grounding、listed、skipped も含まれます。

リンク: [レポート](/ambercast/ja/reference/reports/#result-statuses), [プランのライフサイクルと鮮度](/ambercast/ja/explanation/plan-lifecycle/#grounding-binding)

## プロセスステータスはバッチレベルのシグナル {#exit-code-signal}

レポートエラーには、code とともにその scope および kind が記録されます。

リンク: [終了コード](/ambercast/ja/reference/exit-codes/#priority), [オペレーション規約](/ambercast/ja/agents/operating-contract/#next-action-by-exit-code)
