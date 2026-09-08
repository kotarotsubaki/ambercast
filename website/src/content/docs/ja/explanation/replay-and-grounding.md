---
title: リプレイとグラウンディング
description: リプレイの実行パスと、キャッシュされたグラウンディングが提供する安全性境界の仕組みを解説します。
---

ambercastのリプレイ実行において、グラウンディングは実行パスとその安全性境界を明確に定める中核的な仕組みです。テスト実行パイプラインが各ステップを評価する際、キャッシュされたグラウンディング情報が存在するかどうかが、以後の処理経路を決定づける基準となります。

## リプレイのエビデンスとしてのグラウンディング {#grounding-as-replay-evidence}

`run` は、AIステップおよび要素グラウンディングのステップバリアントに対してグラウンディングを消費します。一方で、ナビゲーション（navigation）、テキスト可視（text-visible）、URLマッチ（URL-match）、要素カウント（element-count）の各バリアントではグラウンディングの参照は行われません。カバレッジを満たす有効なAIトレース（covered, valid AI trace）が存在する場合、AIエグゼキューター（AI executor）を解決することなくリプレイできます。

要素グラウンディングにはアクセシビリティフィンガープリント（accessibility fingerprint）が保存されており、解決処理では保存されているアルゴリズムとハッシュを、マッチしたノードから新たに取得したフィンガープリントと比較します。

リゾルバー（resolver）はヒット（hit）を、`fingerprint-mismatch`、`element-not-found`、`ambiguous-match`、`snapshot-invalid` から明確に区別して判定します。ここでミスマッチがヒットとして扱われることはありません。

関連情報: [グラウンディングドキュメント](/ambercast/ja/spec/grounding-document/), [要素フィンガープリント](/ambercast/ja/spec/fingerprint/), [ambercast run](/ambercast/ja/reference/cli/run/#ai-calls)

## リプレイパス: グラウンディングヒット {#grounding-hit}

キャッシュされたエビデンスが完全に合致するグラウンディングヒットの経路では、外部プロバイダーとの通信を伴わない実行パスが選択されます。カバレッジを満たす有効なAIトレースは、遅延エージェントフォールバック（lazy agentic fallback）が選択される前にリプレイされます。

要素の分類が成功した場合、新たなライブ解決を要求するのではなく、保存されているフィンガープリントをリプレイコンテキストに提供します。このように、`run` の実行パイプラインは、完全なキャッシュが存在するときにプロバイダーへの問い合わせ（プロバイダーの解決）を行わずに実行できるように設計されています。

関連情報: [ambercast run](/ambercast/ja/reference/cli/run/#replay), [CIにおける決定性](/ambercast/ja/explanation/determinism-in-ci/#bounded-side-effects)

## リプレイパス: フォールバックを伴うミス {#miss-with-ai-fallback}

キャッシュから有効なグラウンディングが得られない場合、実行パスはフォールバックを伴う分岐へと進みます。グラウンディングの不在、stale（古くなった状態）なプロベナンス（provenance）、無効なJSON、およびキャッシュミスは、遅延エージェントフォールバックの前に分類されます。

cache-onlyモードが有効になっていない場合、要素グラウンディングのミスが発生してもライブで解決（resolve live）を行い、解決された要素フィンガープリントでグラウンディングエントリを更新できます。

フォールバック処理はミスパスを経た後にのみ開始されます。グラウンディングヒットの経路では、AI呼び出しイベント（AI-call event）は発行されません。

関連情報: [ambercast run](/ambercast/ja/reference/cli/run/#grounding-write-back), [グラウンディングのライトバック制御](/ambercast/ja/how-to/control-grounding-writeback/)

## リプレイパス: cache-only ミス {#cache-only-miss}

厳格なリプレイ境界を維持する経路では、フォールバックの発生そのものが拒否されます。`--cache-only` は、コールドスタートおよび回復可能なミスの双方において、AIフォールバックを抑制します。

AI-directed replay において、使用可能なトレースが存在しないAIディレクテッドステップ（AI-directed step）は、cache-onlyモードが有効な場合に中断（abort）します。同様に、要素グラウンディングのミスが発生した際も、要素をライブで解決するのではなく、cache-onlyモードでは処理を中断します。

関連情報: [ambercast run](/ambercast/ja/reference/cli/run/#cache-only), [構造化出力の読み取り](/ambercast/ja/agents/reading-structured-output/#decision-tree)

## ドリフトのハンドオフ {#drift-handoff}

UIの変更などによってリプレイが単純なキャッシュ判定にとどまらなくなった段階で、関心はリプレイからヒーリング（healing）へと移行します。

`fingerprint-mismatch` は、マッチしたノードの現在のアクセシビリティフィンガープリントが、保存されているフィンガープリントと異なることを意味します。`run` のユースケースでは、`fingerprint-mismatch` をグラウンディング解決が成功した場合とは明確に異なる分類ケースとして記録します。

ヒーリング処理はまず cache-only のベースラインリプレイから開始され、そこで失敗が残る場合にグラウンディングの修復を試行できます。

関連情報: [ヒーリングモデル](/ambercast/ja/explanation/healing-model/#three-stages), [UI変更後にテストを修復する](/ambercast/ja/tutorials/repair-your-first-drift/)
