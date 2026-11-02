---
title: 再生とグラウンディング
description: 再生が記録済みのグラウンディングを使ってAIを呼ばずに動く仕組みと、ミスしたときの扱いを説明する。
---

グラウンディングが全ステップを覆っている実行では、AIを呼ばずに再生できる。覆えないミスは、既定ではフェイルクローズする。`--resolve` を付けたときだけ、ミスをその場で解決する。

## 再生の証拠としてのグラウンディング {#grounding-as-replay-evidence}

`run` がグラウンディングを参照するのは、`ai` ステップと、要素に結び付くステップ（click、press、fill、fill-secret、capture）だ。ナビゲーションとすべてのアサーションは、グラウンディングを引かず、実ページを直接確かめる。

要素のエントリは、ロケーター、フィンガープリント、意図のダイジェスト、来歴を持つ。解決では保存済みのロケーターを使い、フィンガープリントを照合する。エントリの形は、グラウンディングドキュメントで確かめられる。

リゾルバーは、命中と `fingerprint-mismatch`、`element-not-found`、`ambiguous-match`、`snapshot-invalid`、`secret-contaminated` を区別する。不一致を命中として扱うことはない。`snapshot-invalid` と `secret-contaminated` は、ケースを中止させる。

再生中の判断は、次の4つに分かれる。

- 有効なエントリがある場合は、AIを呼ばずに再生する。
- 整合性が壊れている場合は、`--resolve` の有無に関わらずフェイルクローズする。
- 回復できるミスで `--resolve` がある場合は、その場で解決する。
- 回復できるミスで `--resolve` がない場合は、`GROUNDING_UNRESOLVED`（終了コード4）で止まる。

関連リンク: [グラウンディングドキュメント](/ambercast/ja/spec/grounding-document/)、[要素フィンガープリント](/ambercast/ja/spec/fingerprint/)、[ambercast run](/ambercast/ja/reference/cli/run/#ai-calls)

## 命中したときの再生 {#grounding-hit}

記録済みで有効なAIトレースは、AIエグゼキューターを解決せずに再生する。エージェント的なフォールバックを選ぶより前に、この経路を使う。

要素の解決が命中したときは、保存済みのフィンガープリントを再生に渡す。新しい解決は要求しない。キャッシュが揃っていれば、プロバイダーを調べずに実行でき、AI呼び出しのイベントも出ない。

関連リンク: [ambercast run](/ambercast/ja/reference/cli/run/#replay)、[CIにおける決定性](/ambercast/ja/explanation/determinism-in-ci/#bounded-side-effects)

## 解決を明示したときのミス {#miss-with-explicit-resolution}

グラウンディングの整合性が壊れていると、`--resolve` を付けてもフェイルクローズする。JSONが不正な場合や、カバレッジか検証の証明に失敗した場合が当てはまる。

`--resolve` が扱うのは、グラウンディングが無い場合と、構造は有効で回復できるエントリの場合だ。廃止された形式のバージョンで書かれたグラウンディングも、ここに入る。要素に結び付くステップを持つ計画では、`--resolve` を付けない `run` がこれを `GROUNDING_UNRESOLVED` と報告し、`run --resolve --update-cache` が作り直す。

`--resolve` を付けると、要素のミスはその場で解決する。解決したエントリを書くのは、バインディングを確かめる全ステップが合格し、ライトバックのゲートが許したときだけだ。ゲートは `localWriteBack`、`--update-cache`、`ci.updateGroundingCache` で決まる。

関連リンク: [ambercast run](/ambercast/ja/reference/cli/run/#grounding-write-back)、[グラウンディングのライトバック制御](/ambercast/ja/how-to/control-grounding-writeback/)

## 解決しないミス {#unresolved-miss}

`--resolve` を付けないと、`run` はコールドスタートのミスと回復できるミスを、その場では解決しない。AI主導の再生で使えるトレースを持たない `ai` ステップは、`grounding-unresolved`（終了コード4）でフェイルクローズし、`--resolve` を案内する。

要素のミスも同じで、その場で解決せず、終了コード4でフェイルクローズする。

関連リンク: [ambercast run](/ambercast/ja/reference/cli/run/#resolve)、[構造化出力の読み取り](/ambercast/ja/agents/reading-structured-output/#decision-tree)

## ドリフトの引き継ぎ {#drift-handoff}

`fingerprint-mismatch` は、一致した要素の現在のフィンガープリントが、保存済みのものと違うことを表す。`run` はこれを、解決に成功した場合とは別の分類として記録する。

ヒーリングは、フェイルクローズの基準再生から始める。失敗が残るときだけ、修復を試みる。

関連リンク: [ヒーリングモデル](/ambercast/ja/explanation/healing-model/#three-stages)、[UI変更後にテストを修復する](/ambercast/ja/tutorials/repair-your-first-drift/)
