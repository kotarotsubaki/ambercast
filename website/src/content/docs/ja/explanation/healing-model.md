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

<div class="heal-stages">
<style>
.heal-stages {
  --ground: #FAF6F0; --surface: #FFFDFA; --line: #E2D9CC; --text: #27211C; --muted: #766B60;
  --amber: #A65C1F; --amber-soft: #FCF5EB; --verdigris: #2E7D5B; --verdigris-soft: rgba(46, 125, 91, .08);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .heal-stages {
    --ground: #181310; --surface: #27211C; --line: #3B332C; --text: #F1EBE2; --muted: #9E9184;
    --amber: #DB9140; --amber-soft: rgba(219,145,64,.14); --verdigris: #7FC8A9; --verdigris-soft: rgba(127,200,169,.12);
  }
}
:root[data-theme="dark"] .heal-stages {
  --ground: #181310; --surface: #27211C; --line: #3B332C; --text: #F1EBE2; --muted: #9E9184;
  --amber: #DB9140; --amber-soft: rgba(219,145,64,.14); --verdigris: #7FC8A9; --verdigris-soft: rgba(127,200,169,.12);
}
.heal-stages { margin: 1.5rem 0; }
.heal-stages figure { margin: 0 auto; max-width: 560px; display: grid; }
.heal-stages .node { border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; background: var(--surface); display: grid; gap: 8px; }
.heal-stages .node.stage { border-color: var(--amber); }
.heal-stages .top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 12px; }
.heal-stages .num { font: 600 11.5px/1 ui-monospace, "JetBrains Mono", monospace; letter-spacing: .08em; color: var(--muted); }
.heal-stages .stage .num { color: var(--amber); }
.heal-stages h3 { margin: 0; font: 700 16px/1.35 system-ui, "Noto Sans JP", sans-serif; letter-spacing: -.01em; color: var(--text); }
.heal-stages p { margin: 0; color: var(--text); }
.heal-stages .chip { display: inline-flex; align-items: center; gap: 6px; font: 500 11px/1 ui-monospace, monospace; letter-spacing: .04em; padding: 5px 8px; border-radius: 999px; border: 1px solid currentColor; white-space: nowrap; }
.heal-stages .chip::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.heal-stages .chip.ai { color: var(--amber); background: var(--amber-soft); }
.heal-stages .chip.replay { color: var(--verdigris); background: var(--verdigris-soft); }
.heal-stages .scope { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 10px; }
.heal-stages .track { height: 6px; border-radius: 3px; background: var(--line); overflow: hidden; }
.heal-stages .fill { height: 100%; background: var(--amber); }
.heal-stages .scope span { font: 500 11px/1.3 ui-monospace, monospace; color: var(--muted); white-space: nowrap; }
.heal-stages .aside { font-size: 13px; color: var(--muted); }
.heal-stages .link { display: grid; grid-template-columns: 28px 1fr; align-items: center; gap: 10px; padding-left: 18px; min-height: 56px; }
.heal-stages .link svg { width: 28px; height: 44px; color: var(--muted); }
.heal-stages .link.up svg { color: var(--amber); }
.heal-stages .link span { font-size: 13px; color: var(--muted); }
.heal-stages .link b { color: var(--text); font-weight: 700; }
@media (max-width: 420px) { .heal-stages .scope { grid-template-columns: 1fr; gap: 6px; } }
</style>
<figure aria-label="heal の3段階エスカレーション。基準の再生で失敗したら段階1、段階1で失敗した地点が進まなければ段階2、失敗が残り期限前なら段階3へ進む">

<div class="node"><div class="top"><span class="num">BASELINE</span><span class="chip replay">AIを呼ばない</span></div><h3>基準をフェイルクローズで再生する</h3><p class="aside">失敗が無ければ修復せずに終わる</p></div>

<div class="link" aria-hidden="true"><svg viewBox="0 0 28 52" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2v46M8 42l6 6 6-6"></path></svg><span><b>失敗があれば</b>、解決を有効にして計測し直す</span></div>

<div class="node stage"><div class="top"><span class="num">STAGE 1</span><span class="chip ai">AIを呼びうる</span></div><h3>グラウンディングを直す</h3><div class="scope"><div class="track"><div class="fill" style="width:22%"></div></div><span>最初に失敗した地点</span></div><p>失敗した地点の要素をつかみ直す。地点が先へ進めば、要素の再グラウンディングかAIによる再追跡として記録する。</p></div>

<div class="link up" aria-hidden="true"><svg viewBox="0 0 28 52" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2v46M8 42l6 6 6-6"></path></svg><span><b>失敗した地点が進まなかったら</b></span></div>

<div class="node stage"><div class="top"><span class="num">STAGE 2</span><span class="chip ai">AIを呼びうる</span></div><h3>1 stepか以降を直す</h3><div class="scope"><div class="track"><div class="fill" style="width:55%"></div></div><span>単一stepまたはtail</span></div><p>失敗したstepを1つ、またはそこから後ろ（tail）をまとめて直す。</p></div>

<div class="link up" aria-hidden="true"><svg viewBox="0 0 28 52" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2v46M8 42l6 6 6-6"></path></svg><span><b>失敗が残り、期限前なら</b></span></div>

<div class="node stage"><div class="top"><span class="num">STAGE 3</span><span class="chip ai">AIを呼びうる</span></div><h3>計画全体を作り直す</h3><div class="scope"><div class="track"><div class="fill" style="width:100%"></div></div><span>計画全体</span></div><p>AI executorを解決して生成を呼び、計画をまるごと作り直す。</p></div>

</figure>
</div>

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
