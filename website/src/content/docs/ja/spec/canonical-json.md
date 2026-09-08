---
title: "正準 JSON"
description: "ダイジェスト入力は、トークン間の空白を含まず、UTF-8 でエンコードされたコンパクトな RFC 8785 互換 JSON を使用しなければならない（MUST）。"
---

## ダイジェスト形式 {#digest-form}

ダイジェスト入力は、トークン間の空白を含まず、UTF-8 でエンコードされたコンパクトな RFC 8785 互換 JSON を使用しなければならない（MUST）。 [src/core/ir/canonical-json.ts:172](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/canonical-json.ts#L172) オブジェクトのキーは UTF-16 順でソートしなければならない（MUST）。 [src/core/ir/canonical-json.ts:147](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/canonical-json.ts#L147) 非有限数および孤立した UTF-16 サロゲートは拒絶しなければならない（MUST）。 [src/core/ir/canonical-json.ts:9](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/canonical-json.ts#L9) [src/core/ir/canonical-json.ts:20](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/canonical-json.ts#L20)

JCS の適用は再帰的である。文字列は孤立したサロゲートを拒絶した後に JSON エスケープされ、有限数は ECMAScript の数値レンダリングを使用し、ブール値は `true`/`false` となり、null は `null` となり、配列は順序を保持し、オブジェクトはキーをソートし、undefined、bigint、function、symbol、およびプレーンでないオブジェクトは拒絶される。 [src/core/ir/canonical-json.ts:55](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/canonical-json.ts#L55), [src/core/ir/canonical-json.ts:92](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/canonical-json.ts#L92), [src/core/ir/canonical-json.ts:112](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/canonical-json.ts#L112), [src/core/ir/canonical-json.ts:130](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/canonical-json.ts#L130) JavaScript のオブジェクト同一性や整形テキストではなく、そのコンパクトなテキストの UTF-8 バイト列がダイジェストのプリイメージである。 [src/core/ir/canonical-json.ts:172](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/canonical-json.ts#L172)

## アーティファクト形式 {#artifact-form}

コミットされるアーティファクトは、正準アーティファクト形式を使用しなければならない（MUST）。すなわち、ダイジェスト形式と同じキー順序およびスカラーレンダリング、2 スペースのインデント、ならびに末尾の改行である。 [src/core/ir/canonical-json.ts:186](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/canonical-json.ts#L186) 生成者は、整形された JSON バイト列をダイジェストのプリイメージとして使用してはならない（MUST NOT）。 [src/core/ir/canonical-json.ts:23](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/canonical-json.ts#L23)

## 永続化 {#persistence}

ストレージへの書き込みはアトミックな可視性を持たなければならない（MUST）。読み取り側は完全な古いファイルまたは完全な新しいファイルを参照し、部分的な書き込みを参照することは決してない。 [src/ports/storage.ts:89](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/ports/storage.ts#L89) 呼び出し側は、中断された書き込みの後に一覧表示された場合、予約された `.ambercast-tmp-` ステージング名を無視しなければならない（MUST）。 [src/ports/storage.ts:56](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/ports/storage.ts#L56)

アトミックなライターは、ファイルシステムアダプタで使用される予約済みの一時プレフィックスおよびリネーム戦略を使用してもよい（MAY）が、そのステージング機構は移植可能な適合性要件ではない。すべての `StorageAdapter.writeText` 実装は、上記のアトミックな可視性の規約を提供しなければならない（MUST）。 [src/ports/storage.ts:56](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/ports/storage.ts#L56), [src/ports/storage.ts:89](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/ports/storage.ts#L89) ディスク上の形式は 2 スペースでインデントされ、ダイジェスト形式と同じスカラーレンダリングでソートされ、1 つの改行で終わる。 [src/core/ir/canonical-json.ts:186](https://github.com/kotarotsubaki/ambercast/blob/v0.3.1/src/core/ir/canonical-json.ts#L186)

## 設計根拠 {#rationale}

課題は、人間がレビュー可能なアーティファクトを維持しつつ、偶発的な JSON フォーマットからハッシュを独立させることである。 

選定された単一の値ウォーカーは、コンパクトなダイジェスト出力と整形されたアーティファクト出力を持つため、両者の間で順序付けやスカラーセマンティクスが乖離することはない。 

却下された代替案の 1 つは、ハッシュ化に整形バイト列を使用するものであったが、空白に意味が生じてしまうため却下された。もう 1 つは順序付けを各呼び出し側に委譲するものであったが、同等な値であっても再現性のないダイジェストになってしまうため却下された。 
