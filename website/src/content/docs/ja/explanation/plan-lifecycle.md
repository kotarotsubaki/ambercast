---
title: 計画のライフサイクルと鮮度
description: 計画が再生できる状態かどうかを、`check` が何も実行せずに判定する仕組みを説明する。
---

計画（plan）を再生できるのは、生成時の入力と今も一致し、グラウンディングが計画に結び付いているときだけだ。`check` はまず鮮度を判定し、`fresh` の計画に限ってグラウンディングを調べる。`stale` の計画には、グラウンディングの状態が付かない。

## 来歴の入力 {#provenance-inputs}

`inputsDigest` は、計画が何から作られたかを表すSHA-256の値だ。次の入力を正規化JSONにまとめて計算する。

- 正規化したプロンプト
- 計画のスキーマバージョン
- 生成テンプレートのフィンガープリント
- プロデューサーバンドルのフィンガープリント（`producerBundleFingerprint`）
- 計画が参照するターゲットの定義（計画の `targets` に挙げた名前を、名前順に並べる）

参照していないターゲットを変えても、ダイジェストと鮮度は変わらない。`executor` はハッシュに入らない。

プロンプトが同じでも、スキーマ、テンプレート、プロデューサー契約のどれかが変わると、計画は `stale` になる。プロデューサーバンドルのフィンガープリントは、テンプレートのものとは別に持つ。契約が変わっただけでも、生成結果は変わりうるからだ。

関連リンク: [鮮度とダイジェスト](/ambercast/ja/spec/freshness/#inputs-digest)、[設定](/ambercast/ja/reference/configuration/#targets)、[互換性と再生成](/ambercast/ja/reference/compatibility/)

## 鮮度の判定 {#fresh-plan-decision}

`check` は、現在のプロンプトと計画が参照するターゲットの定義から `inputsDigest` を計算し直し、`plan.source.inputsDigest` と比べる。一致すれば `fresh`、一致しなければ `stale` を返す。

`stale` になる原因は、ダイジェストの不一致だけではない。次の場合も `stale` になる。

- JSONが不正である
- スキーマ検証に失敗する
- シリアライズが正規形でない
- 命令カバレッジが不正である
- 要素の意図（intent）またはソーススパンが不正である
- 廃止された計画の `schemaVersion`（4）を使っている
- 計画の参照先ターゲットが設定に見つからない

構造が壊れた計画を、`fresh` と報告しないためだ。

関連リンク: [ambercast check](/ambercast/ja/reference/cli/check/#results)、[古くなった成果物の復旧](/ambercast/ja/how-to/recover-stale-artifacts/#stale)

## グラウンディングの結び付き {#grounding-binding}

`fresh` な計画があっても、再生できるとは限らない。再生にはグラウンディングも要る。

`planDigest` は、再生に関わる計画の内容から `generatorMeta` を除いてハッシュにした値だ。グラウンディングを現在のものと見なすのは、記録した `planDigest` と計画から計算した値が等しいときだけである。計画の鮮度と、グラウンディングの結び付きは、別々に判定する。

`check` は、グラウンディングが無ければ `missing-grounding`、不正なら `invalid-grounding`、別の計画に結び付いていれば `stale-grounding` と報告する。

リポジトリのポリシーが `uncommitted` のときは、有効なグラウンディングの無い `fresh` な計画を `fresh-without-grounding` と報告する。これは鮮度の失敗ではない。

`check` は逆向きにも走査する。対応するテストの無い成果物は `orphaned-plan` または `orphaned-grounding`、対応するテストを逆引きできない名前は `invalid-artifact-name` と報告する。

関連リンク: [グラウンディングドキュメント](/ambercast/ja/spec/grounding-document/#plan-digest)、[レポート](/ambercast/ja/reference/reports/#check-results)

## 鮮度判定が引き渡すもの {#freshness-handoff}

`check` はAIを呼ばず、ブラウザーを起動せず、何も書き込まない。鮮度の判定結果は、計画が今の入力と合っているかどうかだけだ。

再生中に起きる問題は、鮮度とは別に扱う。UIが変わって要素のフィンガープリントが合わなくなると、`fingerprint-mismatch` と分類される。これはドリフトという実行時の状態で、`inputsDigest` を変えない。

再生かヒーリングが、この状態を引き継ぐ。

関連リンク: [再生とグラウンディング](/ambercast/ja/explanation/replay-and-grounding/#drift-handoff)、[ヒーリングモデル](/ambercast/ja/explanation/healing-model/#three-stages)、[オペレーション規約](/ambercast/ja/agents/operating-contract/#command-contract)
