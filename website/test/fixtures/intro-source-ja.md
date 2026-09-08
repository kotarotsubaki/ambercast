---
title: はじめに
description: 自然言語テストプロンプトからプランとグラウンディングを生成し、プロバイダーの解決を行わないリプレイとUIドリフトに対する意図的な修復サイクルを提供するambercastの概要です。
---

ambercastは、自然言語で記述されたテストプロンプトからプランおよびグラウンディングの成果物を生成し、グラウンディングされたリプレイやUIドリフトに対する意図的な修復を実現するプロンプトネイティブなE2Eテストツールです。プロンプトの来歴を保持し、明確に定義されたスキーマに基づいてテスト成果物を管理します。本書では、ambercastの中核となるワークフローサイクルと各成果物ファイルの構成を説明します。

## ambercastが保持するもの {#what-ambercast-preserves}

ambercastでは、テストの再現性と来歴を正確に管理するため、入力と成果物の保持に関して明確な設計方針をとっています。

プロンプトの正規化において変更されるのは、先頭の1つのBOMおよびCR/CRLF改行コードのみです。来歴を保持するため、それ以外のすべてのコンテンツはそのまま保持されます。

また、コミットされたプランおよびグラウンディング成果物に対する実行時のオーソリティはZod IRスキーマであり、JSON SchemaはこのZod IRスキーマから導出されます。

## 生成・実行・修復のサイクル {#generate-run-heal-cycle}

ambercastの中核となるのは、プロンプトの作成から日々のテスト実行、そしてUIの変更に伴う修復までを一貫して扱うワークフローサイクルです。

キャプション: プロバイダーが動作するノードには琥珀色（amber）、リプレイ成功ノードには緑青色（verdigris）のステータスラベルと枠線パネルを用い、プロンプトからコンパニオンの生成、実行、修復へと循環する有向ループを示しています。

代替テキスト: 「有向ループ：プロンプトからプランとグラウンディングのコンパニオンが生成されます。runの実行時には、グラウンディングがヒットした場合はプロバイダーの解決を行わずにリプレイされ、失敗した場合はユーザーが個別のhealコマンドを明示的に選択できます。承認されたheal処理によってコンパニオンが更新されます。」

ノード:
- `SIGN-IN.TEST.MD · PROMPT`: 正規化されたプロンプトが生成の入力になります。
- `GENERATE · AI WHEN NEEDED`: 生成（generate）は遅延AIエグゼキューターを構成します。
- `PLAN + GROUNDING`: コンパニオンのパスは `.test.md` のパスから導出されます。
- `RUN · REPLAY`: 完全にグラウンディングされたリプレイには、利用可能なプロバイダーを必要としません。
- `GROUNDING HIT · 0 AI CALLS`: 実行（run）はフォールバックポートを通じてのみプロバイダーを解決します。
- `HEAL · APPROVAL BEFORE WRITE`: ヒールのランタイムが確認とコミットの構成を担当します。

エッジ:
- `prompt → generate` (`ambercast generate`)
- `generate → artifacts` (`write companions`)
- `artifacts → run` (`ambercast run`)
- `run → replay` (`grounding hit`)
- `run → heal` (`repair needed`)
- `heal → artifacts` (`authorized update`)

## 3つのファイル {#three-files}

ambercastにおけるファイル配置は、プロンプトと生成される成果物の対応関係が明確になるよう設計されています。

キャプション: 作成者が記述したテストプロンプトと、そこから生成されるプランおよびグラウンディングの2つの派生JSONコンパニオンファイルとの隣接した関係を示しています。

代替テキスト: 「作成された1つのプロンプトから、隣接する2つの派生JSONコンパニオン（プランとグラウンディング）へと分岐します。」

ノード:
- `PROMPT · <name>.test.md`: 完全一致する末尾の `.test.md` パスのみがコンパニオンのマッピングを持ちます。
- `PLAN · <name>.ambercast.plan.json`: プランのサフィックスは `.ambercast.plan.json` です。
- `GROUNDING · <name>.ambercast.grounding.json`: グラウンディングのサフィックスは `.ambercast.grounding.json` です。

エッジ:
- `prompt-file → plan-file` (`generate`)
- `prompt-file → grounding-file` (`generate`)
- `plan-file ↔ grounding-file` (`paired derived artifacts`)

## AI呼び出しの台帳 {#ai-call-ledger}

テストの各フェーズにおいて、いつプロバイダーが関与するのかを可視化することは重要です。ambercastでは、プロバイダー呼び出しの発生を厳密に制御しています。

キャプション: 各フェーズにおけるプロバイダーの関与を示しています。生成時には必要に応じてプロバイダーが動作し、完全にグラウンディングされたリプレイではプロバイダーの解決を行わず0回のAI呼び出しで実行され、修復時には明示的な確認を経て実行されます。

代替テキスト: 「生成時のプロバイダー呼び出し、完全にグラウンディングされたリプレイにおけるプロバイダー呼び出しゼロ、そして修復時の明示的な確認を示します。」

ノード:
- `GENERATE · PROVIDER AS NEEDED`: 生成処理は遅延AIエグゼキューターリゾルバーを受け取ります。
- `REPLAY · 0 AI CALLS WHEN GROUNDED`: 実行（run）はフォールバックポートを通じてのみプロバイダーを解決します。
- `HEAL · EXPLICIT REPAIR`: ヒール処理は個別の確認と永続化の構成を持ちます。

エッジ:
- `generate → replay` (`committed companions`)
- `replay → heal` (`repair needed`)
- `heal → replay` (`authorized update`)

## 次のステップ {#next}

ambercastの全体像を把握した後は、以下のリンクからチュートリアルや詳細なリファレンスをご覧ください。

リンク:
- [5分で動かす最初のテスト](/ambercast/ja/tutorials/quick-start/)
- [設計思想](/ambercast/ja/philosophy/)
- [ファイルレイアウト](/ambercast/ja/reference/file-layout/)
- [ambercast generate](/ambercast/ja/reference/cli/generate/)
- [ambercast run](/ambercast/ja/reference/cli/run/)
- [ambercast heal](/ambercast/ja/reference/cli/heal/)
