---
title: CIにおける決定性
description: CIで検査が副作用を持たず、書き込みが限られ、修復が既定で断られ、終了コードが1つに決まる仕組みを説明する。
---

CIでは、検査が副作用を持たない。書き込むのは、既定では実行レポートと閉じた証跡だけだ。修復は既定で断り、混在した結果は最も強い問題を示す1つの終了コードで返す。

## 読み取り専用の検査 {#read-only-check}

`check` は、AIエグゼキューター、ブラウザー、シークレット、クロック、イベントのどれにも触れられない。ストレージへのアクセスも読み取り専用だ。読み取り専用であることは、慣習ではなく構造で保証される。

プロンプト、計画（plan）、グラウンディング、孤立した成果物の検出には、読み取りと存在確認があれば足りる。

関連リンク: [ambercast check](/ambercast/ja/reference/cli/check/#read-only-contract)、[計画のライフサイクルと鮮度](/ambercast/ja/explanation/plan-lifecycle/#fresh-plan-decision)

## 再生の書き込みは限られる {#bounded-side-effects}

`run` が実行レポートのJSONを書く先は、その呼び出しのレポートパスだけだ。書く前に、エンベロープを `persisted` として確定させる。書き込みに成功した場合、ファイルは返したエンベロープと同じ内容になる。

書き込みに失敗すると、`run` は `reportPersistence: "failed"` のエンベロープを返す。このとき、終了コードが0だったはずの実行だけが3になる。1、2、4、5は通常そのまま残る。`not-attempted` は書き込みを試していないことを、`failed` は途中までの内容が見える状態で残っていないことを表す。

CIでのグラウンディングの書き戻しは、`--update-cache` か `ci.updateGroundingCache: true` を指定したときだけ行う。詳しくは[設定](/ambercast/ja/reference/configuration/#grounding)にある。

関連リンク: [レポート](/ambercast/ja/reference/reports/#persistence)、[ambercast run](/ambercast/ja/reference/cli/run/#grounding-write-back)

## CIでは既定でヒーリングを断る {#heal-refusal}

`--list` 以外の `heal` は、`ci.heal` が true でない限り、CIでは設定エラーで断る。`heal --list` は、書き込まない探索のまま使える。

ヒーリングは、計画とグラウンディングの候補を非公開の領域にためる。実ファイルへ書くのは、`ambercast heal` の確認プロンプトに答えたあと、または `--yes` で事前に答えたあとだけだ。一方、再生の試行は、`--dry-run` でもrunsディレクトリ下のケースのディレクトリに閉じた証跡を書くことがある。

関連リンク: [ambercast heal](/ambercast/ja/reference/cli/heal/#ci)、[ヒーリングモデル](/ambercast/ja/explanation/healing-model/#confirmation-and-writes)

## 最も強い問題が終了コードになる {#exit-priority}

結果が混在すると、終了コードは最も強い候補になる。優先順位は `2 > 3 > 4 > 1 > 5 > 0` で固定だ。反復の順序にも、候補の重複にも左右されない。

関連リンク: [終了コード](/ambercast/ja/reference/exit-codes/#aggregation-priority)、[オペレーション規約](/ambercast/ja/agents/operating-contract/#next-action-by-exit-code)、[構造化出力の読み取り](/ambercast/ja/agents/reading-structured-output/#decision-tree)
