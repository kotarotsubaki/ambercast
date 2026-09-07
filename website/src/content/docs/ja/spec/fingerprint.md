---
title: "要素フィンガープリント"
description: "`Fingerprint."
---

## アルゴリズム {#algorithm}

`Fingerprint.algorithm` は `a11y-neighborhood-v2` でなければならない（MUST）。[src/core/ir/schema.ts:221](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L221) その記述子は、対象のロール／名前、ならびに直接の親および直前／直後の兄弟のロール／名前で構成される。存在しない隣接兄弟のみが `null` となる。一致するノードには常に直接の親が存在し、最上位ノードはその親として合成ルートを使用する。[src/core/ir/fingerprint.ts:164](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/fingerprint.ts#L164) [src/core/ir/fingerprint.ts:259](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/fingerprint.ts#L259) 名前は NFC 正規化され、空白の連続が縮約され、トリムされなければならない（MUST）。ロールは完全一致のままとする。[src/core/ir/fingerprint.ts:82](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/fingerprint.ts#L82)

アルゴリズムは以下を行わなければならない（MUST）：(1) 有効なアクセシビリティツリーをパースする、(2) ロールが参照と厳密に一致し、NFC、連続する空白の縮約、およびトリムを行った後に名前が一致するノードを厳密に1つ見つける、(3) `{role,name,parent,siblingBefore,siblingAfter}` を構築する、(4) 存在しない兄弟を `null` としてエンコードする、(5) 記述子を RFC 8785 互換の正規 UTF-8 JSON としてシリアライズする、(6) それらのバイト列を SHA-256 でハッシュ化する、(7) 小文字の16進数出力を v2 タグとともに格納する。[src/core/ir/fingerprint.ts:240](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/fingerprint.ts#L240), [src/core/ir/fingerprint.ts:340](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/fingerprint.ts#L340) 子孫および隣接していない兄弟はプリイメージに含まれてはならない（MUST NOT）。[src/core/ir/fingerprint.ts:39](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/fingerprint.ts#L39)

## ダイジェスト {#digest}

実装は [正準 JSON](/ambercast/ja/spec/canonical-json/#digest-form) を用いて記述子をシリアライズし、それを SHA-256 でハッシュ化しなければならない（MUST）。[src/core/ir/fingerprint.ts:6](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/fingerprint.ts#L6) [src/core/ir/digest.ts:33](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/digest.ts#L33) v2 以外のタグは、厳格な Grounding スキーマ検証に失敗する。`run` において、`trace.verificationCoverage` を主張する現在の来歴を持つ生の Grounding ドキュメントは、その後の厳格または正規化の失敗を整合性の失敗（integrity failure）とする。その主張がない場合、使用不能なコンパニオンはキャッシュミスとなる。[src/core/ir/schema.ts:215](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L215) [src/usecases/run.ts:498](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L498) `check` において、grounding 検査は、来歴比較の前にスキーマが無効なコンパニオンを `invalid` として分類する。公開レポートのステータスは、[鮮度とダイジェスト](/ambercast/ja/spec/freshness/#freshness-consequences) で定義されているリポジトリポリシーのマッピングに従う。[src/usecases/check-grounding.ts:45](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/check-grounding.ts#L45)

## マッチング {#matching}

フィンガープリントの不一致はミスとして扱われなければならず（MUST）、古い要素を安全にリプレイできる証拠として扱ってはならない。これは実装されたバージョンゲートおよび不一致の無効化に従う。[src/core/ir/schema.ts:215](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/schema.ts#L215) [src/core/ir/fingerprint.ts:39](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/fingerprint.ts#L39)

`hit`、`fingerprint-mismatch`、`element-not-found`、`ambiguous-match`、および `snapshot-invalid` は、それぞれ異なる解決結果である。ツリーが存在しないか不正な形式である場合は `element-not-found` となり、正規化されたロール／名前の一致が複数存在する場合は `ambiguous-match` となり、古いハッシュまたは異なるハッシュである場合は `fingerprint-mismatch` となる。[src/core/ir/fingerprint.ts:347](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/fingerprint.ts#L347), [src/core/ir/fingerprint.ts:388](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/fingerprint.ts#L388) 孤立サロゲートは、生成時にはフィンガープリントを生成せず、解決時には `element-not-found` を生じさせる。[src/core/ir/fingerprint.ts:181](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/fingerprint.ts#L181)

## 設計根拠 {#rationale}

課題は、古くなったロケータが視覚的に類似した要素に対してリプレイされることを許容せずに、局所的な UI ドリフトを検出することである。境界付けられた近傍は、その証拠を明示的なものにする。

採用された設計では、安定したテキスト正規化を行った後に、対象、親、および直接隣接する兄弟をハッシュ化する。これは、ヒューリスティックな再利用を許容するのではなく、ミスと一致を区別する。

却下された代替案の1つはツリー全体のハッシュであった。無関係な変更によって過剰なミスが発生するため、これは却下された。もう1つの代替案はセレクタ由来の識別子であった。セレクタは保持された意図の証拠ではなく実装の詳細であるため、これも却下された。 

v1 パーサーはアクセシビリティの証拠に対するフェイルクローズなスキャンを提供できなかった。バージョン2ではアルゴリズムタグが変更されており、v1 フィンガープリントが v2 の証拠として解釈されることはない。その運用の結果は、無条件に再解決へとフォールバックするのではなく、[要素フィンガープリント](/ambercast/ja/spec/fingerprint/#digest) における現在の来歴およびカバレッジ主張のルールに従う。[CHANGELOG.md:78](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/CHANGELOG.md#L78) [src/usecases/run.ts:498](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/usecases/run.ts#L498)
