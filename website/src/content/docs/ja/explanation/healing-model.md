---
title: ヒーリングモデル
description: UIが変わってテストが失敗したとき、ambercastがどこまで自動で直し、どこから人の判断に委ねるかを説明する。
---

アプリのUIを変更すると、それまで通っていたテストが突然失敗する。ボタンの文言や要素の場所の変化が典型的な原因だ。

ambercastのヒーリング機能は、こうした失敗の原因を自動で調べ、テストを直そうとする。ただし無制限には動かない。試行回数には上限があり、ファイルへの書き込みは必ず人の確認を経てから行われる。

## 安全な前提条件 {#safe-precondition}

ヒーリングは、直し方を探すために実際にアプリへアクセスして試行錯誤する。対象のアプリが「何度アクセスしても同じ状態に戻る」ものでないと、試行を繰り返すうちにデータが増えたりアプリの状態が崩れたりする恐れがある。

そのためambercastは、設定で対象が`healReplayIsolation: "idempotent"`（「繰り返し再生しても安全」の意味）と宣言されていない限り、ヒーリングを拒否する。ブラウザを開いたりAIを呼んだりする前の時点で止める。宣言を省略した場合の既定値は、安全側に倒した`stateful`（「繰り返すと状態が変わる」の意味）であり、この場合もヒーリングは拒否される。

CI（自動テストの実行環境）では、人がその場で結果を見ていないため、設定`ci.heal`を有効にしない限りヒーリングは動かない。ただし「何を直せそうか一覧だけ見る」モードはアプリに実際の変更を加えないため、この制限を受けずに使える。

関連リンク: [ambercast heal](/ambercast/ja/reference/cli/heal/#preconditions)、[設定](/ambercast/ja/reference/configuration/#targets)、[CIにおける決定性](/ambercast/ja/explanation/determinism-in-ci/#heal-refusal)

## 3段階のエスカレーション {#three-stages}

ヒーリングはまず、AIを使わない通常のリプレイでテストを再実行し、本当に失敗するかどうかを確かめる。ここで失敗が再現しなかった場合、それ以上の修復は行わない。失敗が再現したときだけ、次の3段階に進む。

```mermaid alt="ベースラインリプレイが失敗すると段階1のgrounding修復を試み、frontierが前進しなければ段階2のsingle-step/tail修復へ進む。失敗が残り期限前なら段階3のplan全体修復に至る。書き込みは確認の後だけ行われる。"
flowchart LR
  B[baseline replay] -->|fails| S1[stage 1]
  S1 -->|not advanced| S2[stage 2]
  S2 -->|still failing| S3[stage 3]
  S3 --> O[overlay]
  O -->|confirmed| C[commit]
```

- 段階1: テストが最初に失敗したステップだけを見て、ページ上の要素を探し直す。軽い再スキャンで見つかることもあれば、AIに新しい位置を推測させることもある
- 段階2: 段階1で解決しなかった場合だけ、その失敗ステップとその後ろの数ステップをまとめてAIに作り直させる
- 段階3: それでも失敗が残り、かつ後述の制限時間内であれば、テスト全体の実行手順をAIに最初から作り直させる

軽い対応から重い対応へと順に試すのは、無駄なAI呼び出しとコストを避けるためである。

関連リンク: [ambercast heal](/ambercast/ja/reference/cli/heal/#repair-model)、[ステップ](/ambercast/ja/spec/steps/)、[リプレイとグラウンディング](/ambercast/ja/explanation/replay-and-grounding/#drift-handoff)

## 修復の回数と時間を制限するバジェット {#repair-budgets}

ヒーリングがいつまでも試行を続けないよう、2種類の上限を設定できる。

- `heal.maxStepRepairs`: 1回のヒーリングでステップの修復を試みる回数の上限。正の整数で指定し、省略すると上限なしになる
- `heal.caseTimeoutMs`: ヒーリング全体にかけてよい時間の上限（ミリ秒）。この期限は最初のリプレイを始める前に決まる。期限を過ぎると新しい修復は始めないが、すでに進行中の作業を強制的に止めたり、できあがった修正を無効にしたりはしない

関連リンク: [設定](/ambercast/ja/reference/configuration/#heal)、[ambercast heal](/ambercast/ja/reference/cli/heal/#limits)

## 書き込む前に必ず確認する {#confirmation-and-writes}

ヒーリングが修復案を見つけても、その時点ではまだプロジェクトのファイルは一切変わらない。見つかった修正案はいったん一時的な置き場に溜められ、ユーザーが内容を確認して承認した後にだけ、実際のファイルへ書き込まれる。

この仕組みにより、どのファイルがどう変わるかを、書き込みが起きるより前に確認できる。

:::caution
`--dry-run`を付けると、確認を求められず結果を見るだけで終わり、ファイルへの書き込みも一切起きない。`--yes`はCLIが出す確認メッセージを省略するだけであり、それ自体が「ユーザーが変更内容を承認した」ことにはならない。

エージェント経由で実行する場合、`--yes`が無く対話的な確認もできない状況では、ambercastは黙って書き込まずエラーで止まる。

:::

関連リンク: [ambercast heal](/ambercast/ja/reference/cli/heal/#confirmation)、[オペレーティングコントラクト](/ambercast/ja/agents/operating-contract/#command-contract)、[生成された差分をレビューする](/ambercast/ja/how-to/review-generated-diffs/)
