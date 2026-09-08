---
title: プランのライフサイクルと鮮度
description: アーティファクトがリプレイ可能かどうかを判断するための来歴と鮮度判定の仕組みを解説します。
---

アーティファクトをリプレイできるかどうかを判断する際には、そのプランが持つ来歴（Provenance）と鮮度（Freshness）の確認が必要です。ambercastでは、プロンプトテキストやスキーマバージョン、テンプレートやプロデューサバンドルのフィンガープリント、ターゲット定義といった入力要素一式をもとに来歴を特定し、プランが現在の状態に対して有効であるかを判定します。

## 来歴の入力要素 {#provenance-inputs}

プランの来歴は、`inputsDigest` によって保護される入力セット全体によって定義されます。`inputsDigest` は、正規化されたプロンプトテキスト、Planスキーマのバージョン、generator-template（ジェネレーターテンプレート）のフィンガープリント、`producerBundleFingerprint`（プロデューサバンドルのフィンガープリント）、および名前付きターゲット定義を含む正規化JSON（canonical JSON）のSHA-256ハッシュです。

この構造により、プロンプトテキストやターゲット定義に変更がない場合であっても、Planスキーマやgenerator-templateに変更があれば、既存のプランはstale（古くなった状態）になります。

また、`producerBundleFingerprint` はテンプレートのフィンガープリントから独立しています。プロンプト、スキーマ、テンプレートのバイト列に変更がない場合でも、プロデューサのコントラクト（producer-contract）の変更によって生成結果が変わる可能性があるためです。

関連リンク:
- [鮮度とダイジェスト](/ambercast/ja/spec/freshness/#inputs-digest)
- [設定](/ambercast/ja/reference/configuration/#targets)
- [互換性と再生成](/ambercast/ja/reference/compatibility/)

## プラン鮮度の判定 {#fresh-plan-decision}

プランが現在も有効であるかどうかの鮮度判定は、`check` コマンドにおける比較処理によって確立されます。`check` は正規化されたプロンプトテキストと選択されたターゲット定義から現在の来歴情報を導出し、それをプラン内に記録されている `plan.source.inputsDigest` と比較します。

ダイジェスト値が一致した場合は `fresh` と判定されます。一方でダイジェスト値が不一致となった場合は、現在のプロンプトまたはターゲットに対してプランがstale（古くなった状態）であるという理由とともに、`stale` という結果が返されます。

また、入力ダイジェストの不一致だけでなく、無効なJSON、スキーマ検証の失敗、非正規化シリアライズ、あるいは無効な命令カバレッジ（invalid instruction coverage）が検出された場合にも、信頼できるフレッシュな結果ではなく `stale` と判定されます。

関連リンク:
- [ambercast check](/ambercast/ja/reference/cli/check/#results)
- [stale（古くなった状態）のアーティファクトの復旧](/ambercast/ja/how-to/recover-stale-artifacts/#stale)

## グラウンディングのバインドと1対1の対応関係 {#grounding-binding}

フレッシュなプランが存在することと、有効なリプレイ用のコンパニオンが存在することは明確に区別されます。`planDigest` は、`generatorMeta` を除外した上で、リプレイに関連するプラン内容をハッシュ化した値です。グラウンディング（grounding）は、そこに記録されている `planDigest` が計算されたプランダイジェストと等しい場合にのみ有効（current）と見なされます。

プラン自体がフレッシュであっても、コンパニオンとなるグラウンディングが存在しないときは `missing-grounding`、無効であるときは `invalid-grounding`、別のプランにバインドされているときは `stale-grounding` として `check` により報告されます。

リポジトリのポリシーが `uncommitted` である場合、有効なグラウンディングを持たないフレッシュなプランは、プラン自体の鮮度エラーではなく `fresh-without-grounding` として報告されます。

さらに、`check` はコンパニオンアーティファクトの逆スキャンも行います。対応するテストが存在しないアーティファクトが見つかった場合は `orphaned-plan` または `orphaned-grounding` として報告され、逆解決が不可能な名前を持つアーティファクトは `invalid-artifact-name` として報告されます。

関連リンク:
- [グラウンディングドキュメント](/ambercast/ja/spec/grounding-document/#plan-digest)
- [レポート](/ambercast/ja/reference/reports/#check-results)

## 鮮度判定が引き渡すもの {#freshness-handoff}

鮮度の検査は、修復手順を直接規定することなく、その後の実行処理へと連携します。`check` は読み取り専用ストレージに加え、レイアウトおよびディスカバリーの依存関係のみを使用します。その依存性コントラクトには、AIエグゼキューター、ブラウザードライバー、シークレット、クロック、イベントポートは公開されていません。

プランがフレッシュであるという結論は来歴情報から導かれるものであり、グラウンディングの検査はプランの鮮度を再定義することなく、リプレイキャッシュのライフサイクルに関する証拠を追加します。

リプレイ実行中に生じるドリフトは、鮮度とは切り離されたランタイム固有の状態です。要素フィンガープリントの解決によって `fingerprint-mismatch` が分類された場合、その情報は `inputsDigest` を変更するのではなく、リプレイのフォールバックや修復（healing）へと引き渡されます。

関連リンク:
- [リプレイとグラウンディング](/ambercast/ja/explanation/replay-and-grounding/#drift-handoff)
- [ヒーリングモデル](/ambercast/ja/explanation/healing-model/#three-stages)
- [オペレーション規約](/ambercast/ja/agents/operating-contract/#command-contract)
