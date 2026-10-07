---
title: ヒーリングモデル
description: 制限付きのエスカレーションと人間による制御で、ambercastの自己修復を安全に保つ仕組み。
---

ambercastのヒーリングは、制限付きのエスカレーションと明示的な人間による制御で動作する。修復作業の開始前に、ヒーリングはターゲットの冪等性と環境設定を評価し、試行を許可するかどうかを決める。

## 安全な前提条件 {#safe-precondition}

選択したターゲットは `healReplayIsolation: "idempotent"` として解決される必要がある。非冪等なターゲットへのヒーリングは、ブラウザーやプロバイダーの処理が始まる前に拒否される。設定境界は `idempotent` と `stateful` のどちらも許すが、読み込み時の既定値は保守的な `stateful` である。

自動テスト実行では、`ci.heal` が有効でない限り、CI内の実際のヒーリング試行は拒否される。リストモードは主作用を持たないため、この拒否を回避する。

関連リンク: [ambercast heal](/ambercast/ja/reference/cli/heal/#preconditions)、[設定](/ambercast/ja/reference/configuration/#targets)、[CIにおける決定性](/ambercast/ja/explanation/determinism-in-ci/#heal-refusal)

## 3段階のエスカレーション {#three-stages}

テストドリフトへの対応では、ヒーリングはキャッシュされた証拠から広範な再生成へと順に進む。まずフェイルクローズのリプレイベースラインを測定し、そのベースラインに失敗があるときだけ、解決を有効にした測定を試みる。

ベースラインが失敗したとき、修復は3段階でエスカレーションする。

```mermaid alt="ベースラインリプレイが失敗すると段階1のgrounding修復を試み、frontierが前進しなければ段階2のsingle-step/tail修復へ進む。失敗が残り期限前なら段階3のplan全体修復に至る。書き込みは確認の後だけ行われる。"
flowchart TD
  B[baseline replay] -->|fails| S1[stage 1: grounding repair]
  S1 -->|frontier not advanced| S2[stage 2: single-step/tail repair]
  S2 -->|failure remains, before deadline| S3[stage 3: full-plan repair]
  S1 --> O[private overlay]
  S2 --> O
  S3 --> O
  O -->|after confirmation| C[commit]
```

段階1は、最初に失敗したフロンティアでgrounding修復を試みる。フロンティアが前進すると、要素の再グラウンディングまたはAIによる再トレースのどちらかが記録される。

段階2は、段階1がフロンティアを前進させられなかったときだけ、構造化されたsingle-step/tail修復を試みる。

段階3は、失敗が残っておりケースが期限で停止していないときだけ、plan全体の修復を試みる。

関連リンク: [ambercast heal](/ambercast/ja/reference/cli/heal/#repair-model)、[ステップ](/ambercast/ja/spec/steps/)、[リプレイとグラウンディング](/ambercast/ja/explanation/replay-and-grounding/#drift-handoff)

## 増分修復を制限するバジェット {#repair-budgets}

明示的なバジェットが修復試行の範囲を制限し、作業を有界に保つ。

設定キー `heal.maxStepRepairs` は任意の正の整数である。ヒーリングケースの実行時、`maxStepRepairs` が未設定なら `Infinity` を使ってディスパッチバジェットを作る。

時間制限はディスパッチ制限と並行して働く。設定 `heal.caseTimeoutMs` は正の整数で、ベースラインリプレイより前にケース全体の受付期限を定める。このタイムアウトは新しい修復フェーズやディスパッチの開始を止めるが、進行中の作業を中断したり、生成済みのコミットを無効にしたりはしない。

関連リンク: [設定](/ambercast/ja/reference/configuration/#heal)、[ambercast heal](/ambercast/ja/reference/cli/heal/#limits)

## 確認が測定と書き込みを分離する {#confirmation-and-writes}

提案された修復は常にレビュー可能である。ambercastが測定と書き込みを分離しているためだ。各ケースは候補となる成果物をプライベートオーバーレイに蓄積し、返されたコミット機能だけが実際の成果物への書き込み経路になる。

確認は測定の後、最初のコミットの前に行われる。そのため、書き込みが同意より先に起きることなく、保留中のファイルと修復の種類をプロンプトで示せる。

コマンドラインフラグは、対話環境と自動化環境の両方でこの境界がどう働くかを定める。`--dry-run` はプロンプトを出さず、コミットもしない。`--yes` は確認境界への事前承認であり、エージェントがユーザーから得る承認の代わりにはならない。`--yes` が無いと、非対話の呼び出し元は暗黙の書き込みではなく設定エラーを受け取る。

関連リンク: [ambercast heal](/ambercast/ja/reference/cli/heal/#confirmation)、[オペレーティングコントラクト](/ambercast/ja/agents/operating-contract/#command-contract)、[生成された差分をレビューする](/ambercast/ja/how-to/review-generated-diffs/)
