---
title: "要素フィンガープリント"
description: "この章は、グラウンディングが要素ステップごとに保存する要素フィンガープリントを定義し、その算出方法と、保存済みフィンガープリントの照合方法を述べる。"
---

## アルゴリズム {#algorithm}

`Fingerprint.algorithm` は `a11y-neighborhood-v2` でなければならない（MUST）（`src/core/ir/schema.ts:303`、`src/core/ir/schema.ts:320`）。

記述子は、対象のロールと名前に、直接の親と、直前および直後の兄弟のロールと名前を加えて構成する。存在しない隣接兄弟だけが `null` になる。一致したノードには必ず直接の親があり、最上位のノードは合成ルートを親とする（`src/core/ir/fingerprint.ts:174`、`src/core/ir/fingerprint.ts:216`）。

名前は、NFC 正規化し、連続する空白を縮約し、前後の空白を除かなければならない（MUST）。ロールは完全一致のままとする（`src/core/ir/fingerprint.ts:106`）。

アルゴリズムは次の処理を行わなければならない（MUST）（`src/core/ir/fingerprint.ts:241`、`src/core/ir/fingerprint.ts:348`）。

1. 有効なアクセシビリティツリーを解析する。
2. ロールが参照と厳密に一致し、名前が NFC 正規化と連続空白の縮約と前後空白の除去の後に一致するノードを、ちょうど 1 つ見つける。
3. `{role,name,parent,siblingBefore,siblingAfter}` を組み立てる。
4. 存在しない兄弟を `null` で表す。
5. 記述子を RFC 8785 互換の正準 UTF-8 JSON に直列化する。
6. そのバイト列の SHA-256 を計算する。
7. 小文字の 16 進数の出力を v2 タグとともに保存する。

子孫と、隣接しない兄弟は、プリイメージに含めてはならない（MUST NOT）（`src/core/ir/fingerprint.ts:46-50`）。

## ダイジェスト {#digest}

実装は、記述子を[正準 JSON](/ambercast/ja/spec/canonical-json/#digest-form)で直列化し、その SHA-256 を計算しなければならない（MUST）（`src/core/ir/fingerprint.ts:6`、`src/core/ir/digest.ts:35`）。

v2 以外のタグは、厳格なグラウンディングのスキーマ検証に失敗する（`src/core/ir/schema.ts:319-322`）。

`run` では、現在の来歴を持つ生のグラウンディング文書が `trace.verificationCoverage` を主張している場合、その後の厳格検証または正準化の失敗は整合性の失敗になる。その主張がなければ、使えない付随ファイルはキャッシュミスになる（`src/usecases/run.ts:773-851`）。

`check` では、グラウンディングの検査が、スキーマに反する付随ファイルを、来歴の比較より前に `invalid` と分類する。公開レポートの状態は、[鮮度とダイジェスト](/ambercast/ja/spec/freshness/#freshness-consequences)で定めるリポジトリ方針の対応に従う（`src/usecases/check-grounding.ts:50`）。

## マッチング {#matching}

フィンガープリントの不一致は、古い要素を安全に再生できる証拠とせず、ミスとして扱わなければならない（MUST）。これは、実装済みのバージョン判定と、不一致時の無効化に従う（`src/core/ir/schema.ts:320`、`src/core/ir/fingerprint.ts:436`）。

`hit`、`fingerprint-mismatch`、`element-not-found`、`ambiguous-match`、`snapshot-invalid` は、それぞれ別の解決結果である。ツリーがないか形式が不正なら `element-not-found`、正規化後のロールと名前に一致するノードが複数あれば `ambiguous-match`、ハッシュが古いか異なれば `fingerprint-mismatch` になる（`src/core/ir/fingerprint.ts:348`、`src/core/ir/fingerprint.ts:436`）。対にならないサロゲートがあると、生成時にはフィンガープリントが作られず、解決時には `element-not-found` になる（`src/core/ir/fingerprint.ts:57-59`、`src/core/ir/fingerprint.ts:251-253`）。

名前が空の参照は、正規化後の名前が空のノードにだけ一致する。

## 引用のマッチング {#quote-matching}

`matchQuotedCandidates(tree, {text, roleHint?})` は、合成ルートの子から、フィンガープリントの照合と同じ順序でアクセシビリティツリーを 1 回だけ線形に走査する。照会する文字列とノード名の両方に `normalizeName`（NFC、連続空白の縮約、前後空白の除去）を適用し、任意のロールヒントは完全一致で比べる。`{{run.x}}` の形の文字列は補間しない。結果は順序付きの `{role, name}` の組であり、ツリーが無効なら `{kind: 'snapshot-invalid'}` を返す（`src/core/ir/fingerprint.ts:106-108`、`src/core/ir/fingerprint.ts:125-172`）。

この関数は、初回バインディングのリテラル引用の待機と、AI の提案のローカル検証に使われる。グラウンディングを使わない要素アサーションの評価にも使われる。詳細は[ステップ](/ambercast/ja/spec/steps/#step-union)を参照。

## 設計根拠 {#rationale}

課題は、古くなったロケータが見た目の似た要素に対して再生されることを許さずに、局所的な UI のドリフトを検出することである。範囲を限った近傍が、その証拠を明示する。

採用した設計は、安定した文字列の正規化の後に、対象、親、直接隣接する兄弟をハッシュ化する。ミスと一致を区別し、ヒューリスティックな再利用は認めない。

却下した代替案の 1 つは、ツリー全体のハッシュである。無関係な変更でミスが過剰に生じるため、却下した。もう 1 つは、セレクタに由来する識別子である。セレクタは保持すべき意図の証拠ではなく実装の詳細であるため、却下した。

v1 のパーサーは、アクセシビリティの証拠をフェイルクローズで走査できなかった。バージョン 2 ではアルゴリズムのタグを変え、v1 のフィンガープリントを v2 の証拠として解釈できないようにした。運用上の結果は、無条件に再解決へ戻すのではなく、[要素フィンガープリント](/ambercast/ja/spec/fingerprint/#digest)の、現在の来歴と被覆の主張に関する規則に従う（`CHANGELOG.md:257`、`src/usecases/run.ts:773-851`）。
