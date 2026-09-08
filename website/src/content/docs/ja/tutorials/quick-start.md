---
title: 5分で動かす最初のテスト
description: ambercast で最初のテストプロンプトを作成し、生成から実行までを5分でガイドします。
---

ambercast で最初のテストプロンプトを生成し、実行するまでの手順を5分で進めます。設定ファイルを作成しない構成でも、デフォルトの `testDir` である `tests/ambercast` と、`http://localhost:3000` を対象に Chromium を使用するデフォルトターゲット `web-user` を使ってすぐに始めることができます。

## 前提条件 {#prerequisites}

- デフォルトの `testDir` は `tests/ambercast` であり、デフォルトターゲットは `http://localhost:3000` で Chromium を使用する `web-user` です。
- 設定ファイルが存在する場合は `$schema` が必須となりますが、設定ファイルが存在しない構成（no-file configuration）は `RawConfig` の外部で処理されます。
- クイックスタートにはブラウザドライバーを設定する `run` が含まれるため、チュートリアル全体の前提条件として、Node.js 22.14 以降、Chromium バイナリ、およびインストールと認証が完了している Claude Code または Codex CLI が必要です。
- 初回の `generate` は Node.js とインストール・認証済みのプロバイダーを直接必要とします。ブラウザドライバーの設定は行わないため、Chromium は生成時ではなく、後続の `run` の実行時に必要となります。
- 生成時に利用可能なプロバイダーが存在しない場合、環境エラーコードは `AI_EXECUTOR_UNAVAILABLE` となります。

## 手順 {#steps}

1. 設定ファイルは作成しません。`tests/ambercast/find-page.test.md` を正確に作成します。

```markdown
# Find a page

When I open the application, navigate to the search page, search for "ambercast", and see "Search results".
```

末尾の `.test.md` サフィックスは、コンパニオンパス解決の対象となります。

2. 人間またはオペレーターが `http://localhost:3000` でアプリケーションを起動して確認した後、`npx ambercast generate tests/ambercast/find-page.test.md` を実行します。

セットアッププロンプト（[セットアッププロンプト](/ambercast/ja/agents/setup-prompt/#copy-paste-prompt)）を使用するエージェントはサーバーがすでに実行されていると想定し、要求がない限りサーバーを起動しません。生成が成功すると終了コード `0` で終了し、結果ステータスは `generated` になります。レポートフィールドは `planFile` であり、生成処理によって指定されたプロンプトの隣に派生した2つのコンパニオンが書き出されます。

3. `npx ambercast run tests/ambercast/find-page.test.md` を実行します。

リプレイが成功すると終了コード `0` で終了します。`run` は設定された runs ディレクトリ配下に呼び出しごとの `report.json` を作成します。

4. まず `git status --short` を実行します。追跡対象の変更されたすべてのファイルを `git diff -- <path>` でレビューします。そこに表示された未追跡のプロンプト、プラン、グラウンディングの各パスについては、内容全体を検査するか `git diff --no-index /dev/null <path>` を実行してください。その後、人間がレビュー済みの3つのファイルをコミットします。

エージェントは変更セット全体を提示し、会話内で明示的な要求があった後にのみコミットします。CLI フラグも `--yes` もその承認には該当しません（[セットアッププロンプト](/ambercast/ja/agents/setup-prompt/#copy-paste-prompt)）。

スコープに関する注意: 引数なしの形式である `npx ambercast generate` および `npx ambercast run` は、設定されたテストディレクトリ、マッチ規則、および無視規則に一致するすべてのテストを検出します。どちらの形式も、別途承認された全検出テストの操作においてのみ使用してください。本チュートリアルのコマンドでは、意図的に1つの `.test.md` を指定しています。

## 完了状態 {#completion-state}

- リゾルバーによって、プロンプトが `tests/ambercast/find-page.ambercast.plan.json` および `tests/ambercast/find-page.ambercast.grounding.json` にマッピングされます。
- `npx ambercast run` が終了コード `0` で終了し、対象ケースについて `passed` が報告されます。

関連情報: [設定](/ambercast/ja/reference/configuration/), [ファイルレイアウト](/ambercast/ja/reference/file-layout/), [ambercast generate](/ambercast/ja/reference/cli/generate/), [ambercast run](/ambercast/ja/reference/cli/run/), [効果的なプロンプトの作成](/ambercast/ja/how-to/write-effective-prompts/)
