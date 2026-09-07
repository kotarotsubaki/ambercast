---
title: CIにおける決定性
description: CI環境における動作の背後にある信頼境界について解説します。
---

CI環境における ambercast の振る舞いは、明確に定義された信頼境界に基づいています。CIのパイプラインで検査ゲートとして機能させるため、システムは構造的なレベルで読み取り専用の境界を設けています。

## 読み取り専用の検査は構造的である {#read-only-check}

`check` を検査ゲートとして使用できる理由は、その依存関係の構造にあります。

検査処理を担う `CheckDeps` は、`ReadStorageAdapter`、レイアウト解決、探索、選択された設定、および任意の abort signal のみを公開します。AI エグゼキューター、ブラウザードライバー、シークレット、クロック、イベントポートは意図的に除外されており、コード上でもそれらの不在が読み取り専用の境界として定義されています。

ストレージ機能自体も明示的に読み取り専用です。プロンプト、プラン、グラウンディングコンパニオン、および孤立した検出結果に対しては、読み取りと存在確認だけで十分に対応できます。

関連情報:
- [ambercast check](/ambercast/ja/reference/cli/check/#read-only-contract)
- [プランのライフサイクルと鮮度](/ambercast/ja/explanation/plan-lifecycle/#fresh-plan-decision)

## リプレイの永続化範囲は限定されている {#bounded-side-effects}

リプレイの実行時には、エビデンスの記録とソースアーティファクトの変更が区別されます。

run コマンドは、まず `persisted` とマークされたエンベロープを確定し、その JSON を当該呼び出しの実行レポートパスにのみ書き込みます。この書き込みが失敗した場合、run は `reportPersistence: "failed"` を持つエンベロープを返します。この条件では、成功したバッチであっても終了コード 3 となります。

エンベロープの状態において、`reportPersistence: "not-attempted"` は永続化の書き込みが試行されなかったことを意味し、`failed` はターゲットパスに部分的なコンテンツが一切可視化されなかったことを意味します。

関連情報:
- [レポート](/ambercast/ja/reference/reports/#report-persistence)
- [ambercast run](/ambercast/ja/reference/cli/run/#grounding-write-back)

## CI環境での修復は既定で拒否される {#heal-refusal}

CI パイプラインにおいて、修復処理がアーティファクトを通知なく変更することはありません。

CI 環境における実際の `heal` 呼び出しは、`config.ci.heal` が true でない限り設定エラーを送出します。この CI 拒否の判定はリストモードの短絡評価の後に評価されるため、`heal --list` は書き込みを行わない探索操作のままとなります。

修復処理では、プランとグラウンディングコンパニオンのみをプライベートなオーバーレイにバッファリングします。確認の前、または `--dry-run` の実行中であっても、リプレイの試行によってケース実行ディレクトリ配下に限定されたエビデンスが書き込まれることはあります。

バッファリングされたコンパニオン候補から実際のアーティファクトの書き込みに至るルートは、その後のコミット機能のみです。

関連情報:
- [ambercast heal](/ambercast/ja/reference/cli/heal/#ci)
- [ヒーリングモデル](/ambercast/ja/explanation/healing-model/#confirmation-and-writes)

## 1つのプロセスステータスが最も強いブロッカーを表す {#exit-priority}

混合した結果が存在する場合でも、プロセスステータスは1つの値として決定されます。

終了ステータスのセレクターは、イテレーション順序や重複した候補とは無関係に、最も強い候補を選択します。

モジュール読み込み時のアサーションが無効な順位テーブルを拒否し、この選択ルールを実行時不変条件として維持します。

関連情報:
- [終了コード](/ambercast/ja/reference/exit-codes/#priority)
- [オペレーション規約](/ambercast/ja/agents/operating-contract/#next-action-by-exit-code)
- [構造化出力の読み取り](/ambercast/ja/agents/reading-structured-output/#decision-tree)
