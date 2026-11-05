---
title: "Ambercast 計画仕様"
description: "本仕様は、ambercast 0.9.0 が受け付けるアーティファクトについて記述する。"
---

## ステータス {#status}

本仕様は、ambercast 0.9.0 が受け付けるアーティファクトについて記述する。本実装は、計画（plan）のスキーマバージョン 5 と、グラウンディングのスキーマバージョン 4 を受け付ける（`src/core/ir/schema.ts:62`、`src/core/ir/schema.ts:74`）。

## 規範的文言 {#normative-language}

単語 **MUST**、**SHOULD**、**MAY** は、RFC 2119 の要求語として解釈する。適合するプロデューサは、ここで定義するバージョンと構造だけを出力しなければならない（MUST）。コンシューマは、検証できない構造を拒絶しなければならない（MUST）。

## 依存関係モデル {#dependency-model}

<figure class="ac-flow" aria-label="正規化したプロンプトから再生までの依存の連鎖。ダイジェストは、正規化したプロンプト、スキーマ、プロデューサの入力、ターゲットを束縛する。計画は、そのダイジェストを inputsDigest として記録する。planDigest は、再生に関わる計画の内容を束縛する。グラウンディング文書は planDigest に束縛され、再計算したダイジェストと等しいときだけ受け入れられる。再生は、束縛されたグラウンディングを読む。">
<div class="ac-flow-node"><div class="ac-flow-head"><span class="ac-flow-num">PROMPT</span></div><p class="ac-flow-title">正規化したプロンプト</p></div>
<div class="ac-flow-link"><svg aria-hidden="true" viewbox="0 0 28 52" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2v46M8 42l6 6 6-6"></path></svg><span class="ac-flow-cond"><b>ダイジェストは、正規化したプロンプト、スキーマ、プロデューサの入力、ターゲットを束縛する</b></span></div>
<div class="ac-flow-node"><div class="ac-flow-head"><span class="ac-flow-num">DIGEST</span></div><p class="ac-flow-title">inputsDigest</p></div>
<div class="ac-flow-link"><svg aria-hidden="true" viewbox="0 0 28 52" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2v46M8 42l6 6 6-6"></path></svg><span class="ac-flow-cond"><b>計画は、そのダイジェストを inputsDigest として記録する</b></span></div>
<div class="ac-flow-node ac-flow-stage"><div class="ac-flow-head"><span class="ac-flow-num">PLAN</span><span class="ac-flow-chip ac-flow-chip-ai">AI を呼びうる</span></div><p class="ac-flow-title">PlanDocument</p></div>
<div class="ac-flow-link"><svg aria-hidden="true" viewbox="0 0 28 52" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2v46M8 42l6 6 6-6"></path></svg><span class="ac-flow-cond"><b>planDigest は、再生に関わる計画の内容を束縛する</b></span></div>
<div class="ac-flow-node"><div class="ac-flow-head"><span class="ac-flow-num">DIGEST</span></div><p class="ac-flow-title">planDigest</p></div>
<div class="ac-flow-link"><svg aria-hidden="true" viewbox="0 0 28 52" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2v46M8 42l6 6 6-6"></path></svg><span class="ac-flow-cond"><b>グラウンディング文書は planDigest に束縛され、再計算したダイジェストと等しいときだけ受け入れられる</b></span></div>
<div class="ac-flow-node ac-flow-stage"><div class="ac-flow-head"><span class="ac-flow-num">GROUNDING</span></div><p class="ac-flow-title">GroundingDocument</p></div>
<div class="ac-flow-link"><svg aria-hidden="true" viewbox="0 0 28 52" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2v46M8 42l6 6 6-6"></path></svg><span class="ac-flow-cond"><b>再生は、束縛されたグラウンディングを読む</b></span></div>
<div class="ac-flow-node"><div class="ac-flow-head"><span class="ac-flow-num">REPLAY</span><span class="ac-flow-chip ac-flow-chip-replay">キャッシュ再生では AI 不要</span></div><p class="ac-flow-title">再生</p></div>
</figure>

すべてのダイジェストの経路は、[正準 JSON](/ambercast/ja/spec/canonical-json/#digest-form)を使わなければならない（MUST）。`inputsDigest` は、正規化したプロンプト、スキーマ、プロデューサの入力、ターゲットを束縛する。`planDigest` は、再生に関わる計画の内容を束縛する（`src/core/ir/digest.ts:130`、`src/core/ir/digest.ts:153`）。

計画は自身の `inputsDigest` を記録し、`planDigest` は計画から計算する。グラウンディングドキュメントは、その `planDigest` が再計算したダイジェストと等しいときだけ受け入れる。定義は[グラウンディングドキュメント](/ambercast/ja/spec/grounding-document/#authority-and-binding)にある。再生は、束縛されたグラウンディングを読む。

## 互換性 {#compatibility}

| アーティファクト | 受け付ける値 | 根拠 |
| --- | --- | --- |
| 計画の `schemaVersion` | `5` | `src/core/ir/schema.ts:62` |
| グラウンディングの `schemaVersion` | `4` | `src/core/ir/schema.ts:74` |
| フィンガープリントのアルゴリズム | `a11y-neighborhood-v2` | `src/core/ir/schema.ts:303` |
| Report `schemaVersion` | `3.11` | `src/report/schema.ts:58` |

## 読解順序 {#reading-order}

読む順序は次のとおりである。

1. [計画ドキュメント](/ambercast/ja/spec/plan-document/#document-shape)、[ステップ](/ambercast/ja/spec/steps/#step-union)、[値型](/ambercast/ja/spec/value-types/#shared-types)を最初に読む。
2. [鮮度とダイジェスト](/ambercast/ja/spec/freshness/#inputs-digest)、[グラウンディングドキュメント](/ambercast/ja/spec/grounding-document/#grounding-shape)、[要素フィンガープリント](/ambercast/ja/spec/fingerprint/#algorithm)を次に読む。
3. 実装者は、[正準 JSON](/ambercast/ja/spec/canonical-json/#digest-form)、[計画におけるシークレット](/ambercast/ja/spec/secrets/#authorization)、[適合性](/ambercast/ja/spec/conformance/#semantic-validation)を最後に読まなければならない（MUST）。

## 設計根拠 {#rationale}

課題は、読者がフィールドを安全に解釈する前に、書き手の意図を、派生した実行と揮発するグラウンディングから区別しなければならないことである。

採用した依存関係優先の構成は、詳細なスキーマより先に、ダイジェストの境界と互換性のバージョンを見えるようにする。

却下した代替案の 1 つは、区別のない単一のアーティファクトである。計画と UI の証拠では無効化の規則が異なるため、却下した。もう 1 つは、章ごとのバージョン管理である。互換性はドキュメント体系全体の契約であるため、却下した。
