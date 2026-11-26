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

## 成分 {#components}

省略可能な `components` レコードは `a11y-components-v1` を用い、完全な指紋と同じ正規化済みの記述子から作る。各ハッシュは、[正準 JSON](/ambercast/ja/spec/canonical-json/#digest-form)の正準 UTF-8 JSON の SHA-256 を小文字の16進数で表す（`src/core/ir/fingerprint.ts:74-94`）。

| 項目 | 正準 JSON のプリイメージ |
| --- | --- |
| `structure` | `{ role, name, parentRole, siblingBeforeRole, siblingAfterRole }` |
| `parentName` | `{ slot: "parent", name }` |
| `siblingBeforeName` | `{ slot: "siblingBefore", name }` |
| `siblingAfterName` | `{ slot: "siblingAfter", name }` |

`structure` の `name` は対象の正規化済みの名前である。`role`、`parentRole`、`siblingBeforeRole`、`siblingAfterRole` はロールを厳密に保持する。兄弟が存在しなければそのロールは `null` になる。

各スロットのプリイメージの `name` は、その隣接要素の正規化済みの名前である。兄弟が存在しなければプリイメージを作らず、名前のハッシュを `null` とする。

最上位の対象の `parentName` は、合成ルートの空の名前をハッシュするため、値は変わらない。

生成時は、記述子のすべてのロールと名前を秘匿値の汚染について検査してから、指紋と成分を作る。汚染があれば両方とも作らない。対にならないサロゲートがある場合も両方とも作らない。

照合と操作直前の再確認は既存の検査を維持し、秘匿値の汚染による拒否を追加しない（`src/core/ir/fingerprint.ts:343-448`）。

`ignoredNames` がなければ完全な指紋を比べる。ある場合は `structure` と除外しないスロットの名前のハッシュを比べる。3つすべてを除外した場合は `structure` だけを比べる。

操作直前は、同じ実行で対象を特定したときの完全な指紋を比べる。除外した表示でも、特定後に変われば操作しない。

## ダイジェスト {#digest}

実装は、記述子を[正準 JSON](/ambercast/ja/spec/canonical-json/#digest-form)で直列化し、その SHA-256 を計算しなければならない（MUST）（`src/core/ir/fingerprint.ts:6`、`src/core/ir/digest.ts:35`）。

v2 以外のタグは、厳格なグラウンディングのスキーマ検証に失敗する（`src/core/ir/schema.ts:319-322`）。

`run` では、現在の来歴を持つ生のグラウンディング文書が `trace.verificationCoverage` を主張している場合、その後の厳格検証または正準化の失敗は整合性の失敗になる。その主張がなければ、使えない付随ファイルはキャッシュミスになる（`src/usecases/run.ts:773-851`）。

`check` では、グラウンディングの検査が、スキーマに反する付随ファイルを、来歴の比較より前に `invalid` と分類する。公開レポートの状態は、[鮮度とダイジェスト](/ambercast/ja/spec/freshness/#freshness-consequences)で定めるリポジトリ方針の対応に従う（`src/usecases/check-grounding.ts:50`）。

## マッチング {#matching}

指紋の不一致はミスとして扱う。ただし、保存済みの `ignoredNames` が許す成分の比較で一致した場合は例外である。名前が空の対象も、ロールと正規化した名前で一意に特定する必要がある。

保存済みの成分がある場合、`structure` が違えば違いの種類は `structure` になる。構造が同じで、除外していない名前のハッシュが違えば `neighbor-names` になる。変わったスロットは `parent`、`siblingBefore`、`siblingAfter` の固定順で示す。

成分がなければ違いの種類を省く。厳密なエントリの指紋が異なるのに成分がすべて同じ場合も、種類とスロットを省く。この不整合な記録はミスのままとし、成分の修正も照合の緩和も行わない。

resolve が許可され、意図の一致する保存済みエントリが指紋の不一致になった場合だけ、除外するスロットを追加できる。取り直したロールと正規化した名前、および構造が保存済みと同じである必要がある。取り直し時点の名前のハッシュで差を判定し、既存の一覧に重複なく加える。

差がなければ既存の一覧を保つ。条件を満たさない取り直しは、除外のない厳密なエントリになる。resolve が許可されない再生も保存済みの除外を使うが、新たな除外は加えない。

確定またはケースの完走後に、書き戻しの許可に従って保存する。一致したエントリは書き換えない。除外を減らすには、厳密なエントリを作り直す必要がある。

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
