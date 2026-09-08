---
title: ヒーリングモデル
description: 制限付きのエスカレーションと人間による制御に基づく自己修復モデルの仕組みを解説します。
---

ambercastのヒーリング（自己修復）モデルは、制限付きのエスカレーションと人間による制御を中心に設計されています。修復作業が無制限に実行されることを防ぐため、ブラウザーやプロバイダーの処理を開始する前の前提条件による制限から始まり、キャッシュされた証拠に基づく最小限の修正から段階的なエスカレーションを経て、承認された変更のみが適用されます。

## 安全な前提条件 {#safe-precondition}

修復作業が開始される前には、処理を安全に実行するための前提条件が検証されます。

選択されたターゲットは `healReplayIsolation: "idempotent"` として解決される必要があります。非冪等（non-idempotent）なターゲットに対する自己修復は、ブラウザーやプロバイダーの作業が開始される前に拒否されます。設定境界としては `idempotent` または `stateful` が許容されていますが、読み込み時には保守的な挙動として、`healReplayIsolation` の既定値は `stateful` となります。

CI環境においては、`ci.heal` が有効化されていない限り、実際の修復の試行は拒絶されます。ただし、リストモードは主作用を持たないため、この拒絶をバイパスして実行できます。

関連リンク: [ambercast heal](/ambercast/ja/reference/cli/heal/#preconditions), [設定](/ambercast/ja/reference/configuration/#targets), [CIにおける決定性](/ambercast/ja/explanation/determinism-in-ci/#heal-refusal)

## 3段階のエスカレーション {#three-stages}

自己修復では、キャッシュされた証拠に基づく局所的な対応から、より広範な再生成へと順を追って段階的にエスカレーションします。

処理の開始時には、まずキャッシュのみのリプレイベースラインが測定されます。非キャッシュ測定が試行されるのは、このベースライン測定で失敗が確認された場合のみです。

第1ステージでは、最初に失敗したフロンティアにおいてグラウンディング修復を試みます。フロンティアが前進する際には、要素の再グラウンディングまたはAIによる再トレースのいずれかが記録されます。

第2ステージでは、第1ステージで失敗フロンティアが前進しなかった場合にのみ、構造化された単一ステップ／末尾修復（single-step/tail repair）が試行されます。

さらに失敗が残っており、かつ対象ケースがそのデッドラインで停止しなかった場合にのみ、第3ステージとしてプラン全体の修復（full-plan repair）が試行されます。

関連リンク: [ambercast heal](/ambercast/ja/reference/cli/heal/#repair-model), [ステップ](/ambercast/ja/spec/steps/), [リプレイとグラウンディング](/ambercast/ja/explanation/replay-and-grounding/#drift-handoff)

## 増分修復を制限するバジェット {#repair-budgets}

増分修復の範囲を限定するために、バジェットによる境界が設けられています。

`heal.maxStepRepairs` は、任意の正の整数の設定値です。個々の修復ケースは、この `maxStepRepairs` の値（未設定の場合は `Infinity`）を用いてディスパッチバジェットを作成します。

また、`heal.caseTimeoutMs` は正の整数であり、ベースラインリプレイの前にケース全体の受付デッドラインを確立します。このタイムアウトは、新しい修復フェーズやディスパッチの開始を阻止します。ただし、進行中の作業を中断したり、すでに生成されたコミットを無効化したりすることはありません。

関連リンク: [設定](/ambercast/ja/reference/configuration/#heal), [ambercast heal](/ambercast/ja/reference/cli/heal/#limits)

## 測定と書き込みを分離する確認プロセス {#confirmation-and-writes}

提案された修復内容が常にレビュー可能であるよう、ambercastは測定処理と実際の成果物への書き込みを明確に分離しています。

各ケースは、生成された候補成果物をプライベートオーバーレイに蓄積します。実際の成果物への書き込みを行う唯一の経路は、処理から返されるコミット機能（commit capability）のみです。

確認プロセスは測定の後、最初のコミットの前に実行されます。これにより、事前の同意なしに書き込みが行われることなく、プロンプト上で保留中のファイルや修復種別を提示して確認を求めることができます。

`--dry-run` はプロンプト表示もコミットも行いません。`--yes` は確認境界に対する事前承認であり、エージェントによるユーザー認可の代替となるものではありません。非対話型の呼び出し元において `--yes` が指定されていない場合は、暗黙的な書き込みが行われる代わりに設定エラーが返されます。

関連リンク: [ambercast heal](/ambercast/ja/reference/cli/heal/#confirmation), [オペレーション規約](/ambercast/ja/agents/operating-contract/#command-contract), [生成された差分のレビュー](/ambercast/ja/how-to/review-generated-diffs/)
