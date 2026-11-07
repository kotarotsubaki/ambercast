---
title: ヒーリングモデル
description: UIが変わってテストが失敗したとき、ambercastがどこまで自動で直し、どこから人の判断に委ねるかを説明する。
---

アプリのUIを変更すると、それまで通っていたテストが突然失敗する。ボタンの文言や要素の場所の変化が典型的な原因だ。

ambercastのヒーリング機能は、こうした失敗の原因を自動で調べ、テストを直そうとする。ただし無制限には動かない。ケースごとに時間の上限があり、計画（plan）とグラウンディングのファイルへの書き込みは、人の確認を経てから行われる。

## 安全な前提条件 {#safe-precondition}

ヒーリングは、直し方を探すために実際にアプリへアクセスして試行錯誤する。対象のアプリが「何度アクセスしても同じ状態に戻る」ものでないと、試行を繰り返すうちにデータが増えたりアプリの状態が崩れたりする恐れがある。

そのためambercastは、設定で対象が`healReplayIsolation: "idempotent"`（「繰り返し再生しても安全」の意味）と宣言されていない限り、ヒーリングを拒否する。ブラウザを開いたりAIを呼んだりする前の時点で止める。宣言を省略した場合の既定値は、安全側に倒した`stateful`（「繰り返すと状態が変わる」の意味）であり、この場合もヒーリングは拒否される。

CI（自動テストの実行環境）では、人がその場で結果を見ていないため、設定`ci.heal`を有効にしない限りヒーリングは動かない。ただし「何を直せそうか一覧だけ見る」モードはアプリに実際の変更を加えないため、この制限を受けずに使える。

関連リンク: [ambercast heal](/ambercast/ja/reference/cli/heal/#preconditions)、[設定](/ambercast/ja/reference/configuration/#targets)、[CIにおける決定性](/ambercast/ja/explanation/determinism-in-ci/#heal-refusal)

## 3段階のエスカレーション {#three-stages}

ヒーリングはまず、AIを使わない通常の再生（replay）でテストを実行し、本当に失敗するかどうかを確かめる。ここで失敗が再現しなかった場合、それ以上の修復は行わない。

失敗が再現したら、解決を有効にして計測し直す。計測し直して全てのstepが通れば、修復せずに終わる。失敗が残り、修復を始められるときだけ、次の3段階に進む。

<figure class="ac-flow" aria-label="healの3段階エスカレーション。基準の再生で失敗が無ければ修復せずに終わる。失敗があれば、解決を有効にして計測し直し、失敗が残り修復を始められるときだけ進む。計測し直して全てのstepが通れば修復せずに終わる。段階1では最初に失敗した地点のグラウンディングを直す。失敗した地点が進まなかったら、段階2で単一stepかtailを直す。失敗が残り、期限前なら、段階3で計画全体を作り直す。期限を過ぎたら新しい修復は始めない。計画とグラウンディングへの書き込みは確認の後だけ行う。">
<div class="ac-flow-node"><div class="ac-flow-head"><span class="ac-flow-num">BASELINE</span><span class="ac-flow-chip ac-flow-chip-replay">AIを呼ばない</span></div><p class="ac-flow-title">基準をフェイルクローズで再生する</p><p class="ac-flow-note">失敗が無ければ修復せずに終わる</p></div>
<div class="ac-flow-link"><svg aria-hidden="true" viewbox="0 0 28 52" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2v46M8 42l6 6 6-6"></path></svg><span class="ac-flow-cond"><b>失敗があれば</b>、解決を有効にして計測し直し、失敗が残り修復を始められるときだけ進む</span></div>
<div class="ac-flow-node ac-flow-stage"><div class="ac-flow-head"><span class="ac-flow-num">STAGE 1</span><span class="ac-flow-chip ac-flow-chip-ai">AIを呼びうる</span></div><p class="ac-flow-title">グラウンディングを直す</p><div class="ac-flow-meter ac-flow-meter-s"><div class="ac-flow-track"><div class="ac-flow-fill"></div></div><span>最初に失敗した地点</span></div><p class="ac-flow-body">失敗した地点の要素をつかみ直す。地点が先へ進めば、要素の再グラウンディングかAIによる再追跡として記録する。</p></div>
<div class="ac-flow-link ac-flow-link-stage"><svg aria-hidden="true" viewbox="0 0 28 52" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2v46M8 42l6 6 6-6"></path></svg><span class="ac-flow-cond"><b>失敗した地点が進まなかったら</b></span></div>
<div class="ac-flow-node ac-flow-stage"><div class="ac-flow-head"><span class="ac-flow-num">STAGE 2</span><span class="ac-flow-chip ac-flow-chip-ai">AIを呼びうる</span></div><p class="ac-flow-title">1 stepか以降を直す</p><div class="ac-flow-meter ac-flow-meter-m"><div class="ac-flow-track"><div class="ac-flow-fill"></div></div><span>単一stepまたはtail</span></div><p class="ac-flow-body">失敗したstepを1つ、またはそこから後ろ（tail）をまとめて直す。</p></div>
<div class="ac-flow-link ac-flow-link-stage"><svg aria-hidden="true" viewbox="0 0 28 52" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2v46M8 42l6 6 6-6"></path></svg><span class="ac-flow-cond"><b>失敗が残り、期限前なら</b></span></div>
<div class="ac-flow-node ac-flow-stage"><div class="ac-flow-head"><span class="ac-flow-num">STAGE 3</span><span class="ac-flow-chip ac-flow-chip-ai">AIを呼びうる</span></div><p class="ac-flow-title">計画全体を作り直す</p><div class="ac-flow-meter ac-flow-meter-l"><div class="ac-flow-track"><div class="ac-flow-fill"></div></div><span>計画全体</span></div><p class="ac-flow-body">AI executorを解決して生成を呼び、計画をまるごと作り直す。</p></div>
</figure>

軽い対応から重い対応へと順に試すのは、無駄なAI呼び出しとコストを避けるためである。

関連リンク: [ambercast heal](/ambercast/ja/reference/cli/heal/#repair-model)、[ステップ](/ambercast/ja/spec/steps/)、[再生とグラウンディング](/ambercast/ja/explanation/replay-and-grounding/#drift-handoff)

## 修復の回数と時間を制限するバジェット {#repair-budgets}

ヒーリングがいつまでも試行を続けないよう、2種類の上限を設定できる。

- `heal.maxStepRepairs`: STAGE 1・STAGE 2の修復でAIを呼び出す回数の上限。呼び出した時点で数える。STAGE 3はAIを呼ぶがこの上限には数えない。正の整数で指定し、省略すると上限なしになる
- `heal.caseTimeoutMs`: 1つのケースのヒーリングにかけてよい時間の上限（ミリ秒）。期限はケースごとに、そのケースの最初の再生を始める前に決まる。複数のテストを選ぶと、コマンド全体ではこの値より長くかかることがある。期限を過ぎると新しい修復は始めないが、すでに進行中の作業を強制的に止めたり、できあがった修正を無効にしたりはしない

関連リンク: [設定](/ambercast/ja/reference/configuration/#heal)、[ambercast heal](/ambercast/ja/reference/cli/heal/#limits)

## 計画とグラウンディングへの書き込みは確認の後 {#confirmation-and-writes}

ヒーリングが修復案を見つけても、その時点ではまだ計画とグラウンディングのファイルは変わらない。見つかった修正案はいったん一時的な置き場に溜められ、CLIの確認プロンプトに答えた後か、`--yes`で事前に承認した後にだけ、実際のファイルへ書き込まれる。確認する前に、提案された変更をレビューする。

この仕組みにより、どのファイルがどう変わるかを、書き込みが起きるより前に確認できる。

:::caution
`--dry-run`を付けると確認を求められず、計画やグラウンディングへの書き込みは一切起きない。ただし再生の試行自体はrunsディレクトリ配下に証跡を書き込むことがある。`--yes`はCLIが出す確認プロンプトを先に承認するだけであり、それ自体はユーザー自身による内容確認・承認ではない。

エージェント経由で実行する場合、`--yes`が無く対話的な確認もできない状況では、ambercastは黙って書き込まずエラーで止まる。

:::

関連リンク: [ambercast heal](/ambercast/ja/reference/cli/heal/#confirmation)、[オペレーション規約](/ambercast/ja/agents/operating-contract/#command-contract)、[生成された差分のレビュー](/ambercast/ja/how-to/review-generated-diffs/)
