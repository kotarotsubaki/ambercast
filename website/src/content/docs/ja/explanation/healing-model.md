---
title: ヒーリングモデル
description: 制限付きのエスカレーションと人間による制御で、ambercastの自己修復を安全に保つ仕組み。
---

ambercastのヒーリングは、制限付きのエスカレーションと明示的な人間による制御で動作する。修復作業の開始前に、ヒーリングはターゲットの冪等性と環境設定を評価し、試行を許可するかどうかを決める。

## 安全な前提条件 {#safe-precondition}

ヒーリングを実行するには、次の2条件を満たす必要がある。

- 選択したターゲットが `healReplayIsolation: "idempotent"` として解決される。設定境界は `idempotent` と `stateful` のどちらも許すが、読み込み時の既定値は保守的な `stateful` である。非冪等なターゲットへのヒーリングは、ブラウザーやプロバイダーの処理が始まる前に拒否される
- 自動テスト実行では `ci.heal` が有効である。リストモードは主作用を持たないため、この拒否を回避する

関連リンク: [ambercast heal](/ambercast/ja/reference/cli/heal/#preconditions)、[設定](/ambercast/ja/reference/configuration/#targets)、[CIにおける決定性](/ambercast/ja/explanation/determinism-in-ci/#heal-refusal)

## 3段階のエスカレーション {#three-stages}

テストドリフトへの対応では、ヒーリングはキャッシュされた証拠から広範な再生成へと順に進む。まずフェイルクローズのリプレイベースラインを測定し、そのベースラインに失敗があるときだけ、解決を有効にした測定を試みる。

```mermaid alt="ベースラインリプレイが失敗すると段階1のgrounding修復を試み、frontierが前進しなければ段階2のsingle-step/tail修復へ進む。失敗が残り期限前なら段階3のplan全体修復に至る。書き込みは確認の後だけ行われる。"
flowchart LR
  B[baseline replay] -->|fails| S1[stage 1]
  S1 -->|not advanced| S2[stage 2]
  S2 -->|still failing| S3[stage 3]
  S3 --> O[overlay]
  O -->|confirmed| C[commit]
```

ベースラインが失敗したとき、修復は次の3段階でエスカレーションする。

1. grounding修復を、最初に失敗したフロンティアで試みる。フロンティアが前進すると、要素の再グラウンディングまたはAIによる再トレースのどちらかが記録される
2. 段階1がフロンティアを前進させられなかったときだけ、構造化されたsingle-step/tail修復を試みる
3. 失敗が残っておりケースが期限で停止していないときだけ、plan全体の修復を試みる

関連リンク: [ambercast heal](/ambercast/ja/reference/cli/heal/#repair-model)、[ステップ](/ambercast/ja/spec/steps/)、[リプレイとグラウンディング](/ambercast/ja/explanation/replay-and-grounding/#drift-handoff)

## 増分修復を制限するバジェット {#repair-budgets}

明示的なバジェットが修復試行の範囲を制限し、作業を有界に保つ。

- `heal.maxStepRepairs`（任意の正の整数）はディスパッチ回数の上限である。未設定なら`Infinity`を使う。
- `heal.caseTimeoutMs`（正の整数）はベースラインリプレイより前に定めるケース全体の受付期限である。新しい修復フェーズやディスパッチの開始だけを止め、進行中の作業や生成済みコミットには影響しない。

関連リンク: [設定](/ambercast/ja/reference/configuration/#heal)、[ambercast heal](/ambercast/ja/reference/cli/heal/#limits)

## 確認が測定と書き込みを分離する {#confirmation-and-writes}

提案された修復は常にレビュー可能である。ambercastが測定と書き込みを分離しているためだ。各ケースは候補となる成果物をプライベートオーバーレイに蓄積し、返されたコミット機能だけが実際の成果物への書き込み経路になる。

確認は測定の後、最初のコミットの前に行われる。そのため、書き込みが同意より先に起きることなく、保留中のファイルと修復の種類をプロンプトで示せる。

:::caution
`--dry-run`はプロンプトを出さず、コミットもしない。`--yes`は確認境界への事前承認であり、エージェントがユーザーから得る承認の代わりにはならない。`--yes`が無いと、非対話の呼び出し元は暗黙の書き込みではなく設定エラーを受け取る。

:::

関連リンク: [ambercast heal](/ambercast/ja/reference/cli/heal/#confirmation)、[オペレーティングコントラクト](/ambercast/ja/agents/operating-contract/#command-contract)、[生成された差分をレビューする](/ambercast/ja/how-to/review-generated-diffs/)
