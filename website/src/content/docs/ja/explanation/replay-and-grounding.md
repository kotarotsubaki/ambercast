---
title: 再生とグラウンディング
description: 再生が記録済みのグラウンディングを使ってAIを呼ばずに動く仕組みと、ミスしたときの扱いを説明する。
---

グラウンディングが全ステップを覆っている実行では、AIを呼ばずに再生できる。覆えないミスは、既定ではフェイルクローズする。`--resolve` を付けたときだけ、ミスをその場で解決する。

## 再生の証拠としてのグラウンディング {#grounding-as-replay-evidence}

`run` がグラウンディングを参照するのは、`ai` ステップと、要素に結び付くステップ（click、press、fill、fill-secret、capture）だ。ナビゲーションとすべてのアサーションは、グラウンディングを引かず、実ページを直接確かめる。

要素のエントリは、ロケーター、フィンガープリント、意図のダイジェスト、来歴を持つ。解決では保存済みのロケーターを使い、フィンガープリントを照合する。エントリの形は、グラウンディングドキュメントで確かめられる。

リゾルバーは、命中と `fingerprint-mismatch`、`element-not-found`、`ambiguous-match`、`snapshot-invalid`、`secret-contaminated` を区別する。保存済みの除外スロットがあれば、以下の限定した規則で照合できる。`snapshot-invalid` と `secret-contaminated` は、ケースを中止させる。

再生中の判断は、次の4つに分かれる。

- 有効なエントリがある場合は、AIを呼ばずに再生する。
- 整合性が壊れている場合は、`--resolve` の有無に関わらずフェイルクローズする。
- 回復できるミスで `--resolve` がある場合は、その場で解決する。
- 回復できるミスで `--resolve` がない場合は、`GROUNDING_UNRESOLVED`（終了コード4）で止まる。

関連リンク: [グラウンディングドキュメント](/ambercast/ja/spec/grounding-document/)、[要素フィンガープリント](/ambercast/ja/spec/fingerprint/)、[ambercast run](/ambercast/ja/reference/cli/run/#ai-calls)

## 命中したときの再生 {#grounding-hit}

記録済みで有効なAIトレースは、AIエグゼキューターを解決せずに再生する。エージェント的なフォールバックを選ぶより前に、この経路を使う。

要素の解決が命中したときは、同じ実行で観測した完全な指紋を再生に渡す。新しい解決は要求しない。キャッシュが揃っていれば、プロバイダーを調べずに実行でき、AI呼び出しのイベントも出ない。

関連リンク: [ambercast run](/ambercast/ja/reference/cli/run/#replay)、[CIにおける決定性](/ambercast/ja/explanation/determinism-in-ci/#bounded-side-effects)

## 解決を明示したときのミス {#miss-with-explicit-resolution}

グラウンディングの整合性が壊れていると、`--resolve` を付けてもフェイルクローズする。JSONが不正な場合や、カバレッジか検証の証明に失敗した場合が当てはまる。

`--resolve` が扱うのは、グラウンディングが無い場合と、構造は有効で回復できるエントリの場合だ。廃止された形式のバージョンで書かれたグラウンディングも、ここに入る。要素に結び付くステップを持つ計画（plan）では、`--resolve` を付けない `run` がこれを `GROUNDING_UNRESOLVED` と報告し、`run --resolve --update-cache` が作り直す。

`--resolve` を付けると、要素のミスはその場で解決する。ケースの途中で確認済みにするには、少なくとも 1 つのステップが操作を `confirms` に挙げる必要がある。該当する全ステップが有効な根拠で合格すると、ambercast はエントリを保存対象にする。

ケースの全ステップが合格すると、残りの操作と capture のエントリも保存対象になる。操作には click・press・fill・fill-secret が含まれる。`confirms` に挙がらない操作や、`element-visible` の一致が複数ある操作も含まれる。

ケースが途中で失敗・中断した場合、要素のエントリは `confirms` で確認済みになったものだけが保存対象である。ファイルへの保存には、ライトバックのゲートの許可が必要だ。ゲートは `localWriteBack`、`--update-cache`、`ci.updateGroundingCache` で決まる。

ケースが合格してグラウンディングの保存も成功すると、同じ計画と画面の状態から AI なしで再生できる。ただし、`ai` ステップのエントリは、検証の記録を残して合格したときだけ作る。記録を残さずに合格した `ai` ステップは、引き続き再生時に `--resolve` が必要である。

関連リンク: [ambercast run](/ambercast/ja/reference/cli/run/#grounding-write-back)、[グラウンディングのライトバック制御](/ambercast/ja/how-to/control-grounding-writeback/)

## 解決しないミス {#unresolved-miss}

`--resolve` を付けないと、`run` はコールドスタートのミスと回復できるミスを、その場では解決しない。AI主導の再生で使えるトレースを持たない `ai` ステップは、`grounding-unresolved`（終了コード4）でフェイルクローズし、`--resolve` を案内する。

要素のミスも同じで、その場で解決せず、終了コード4でフェイルクローズする。

関連リンク: [ambercast run](/ambercast/ja/reference/cli/run/#resolve)、[構造化出力の読み取り](/ambercast/ja/agents/reading-structured-output/#decision-tree)

## 実行ごとに変わる隣の表示 {#changing-neighbor-text}

保存済みの成分があり、対象と構造が同じまま隣の表示だけが実行ごとに変わる場合、最初のAIなしの再生は一度止まる。`ambercast run --resolve` を再実行し、その結果をグラウンディングに書き戻せれば、以後は隣の表示の違いでこの要素の再生が止まることはない。ほかの原因の停止（直前の操作によるページの切り替わりの途中で照合される場合など）は含まないので、その要素が以後かならずAIなしで再生できるとは限らない。対象のアクセシブルな名前の有無は問わない。

v5より前のグラウンディングには成分がないため、停止がもう一度増える。最初のresolveは成分つきの厳密なエントリを作り直す。その次のresolveで、除外するスロットが加わる。

隣接する要素の出現や消失など、構造の変化は不一致のままとし、照合を緩めない。resolveの許可がない再生では、除外するスロットを追加しない。操作直前は、除外した名前も含め、同じ実行で取得した完全な指紋を比べる。

表示の変化をresolveする前に、ページが意図したレコードを表示しているか確認する。[レポート](/ambercast/ja/reference/reports/#neighbor-name-warnings)で、新たに除外したスロットと保存の成否を確認できる。

## ドリフトの引き継ぎ {#drift-handoff}

`fingerprint-mismatch` は、一致した要素の現在のフィンガープリントが、保存済みのものと違うことを表す。`run` はこれを、解決に成功した場合とは別の分類として記録する。

ヒーリングは、フェイルクローズの基準再生から始める。失敗が残るときだけ、修復を試みる。

関連リンク: [ヒーリングモデル](/ambercast/ja/explanation/healing-model/#three-stages)、[UI変更後にテストを修復する](/ambercast/ja/tutorials/repair-your-first-drift/)
