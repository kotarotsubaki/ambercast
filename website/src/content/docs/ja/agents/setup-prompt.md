---
title: セットアッププロンプト
description: 依頼されたテストを扱うエージェントに対し、レビューを最優先とする境界を規定するセットアッププロンプトを提供します。
---

依頼されたテストを扱うエージェントに対し、レビューを最優先とする境界を規定するセットアッププロンプトを提供します。

## コピー用プロンプト {#copy-paste-prompt}

エージェントの運用にあたっては、以下のルールおよび前提が適用されます。

- プロバイダーの解決では、明示的なオーバーライドが存在する場合はそれを使用し、存在しない場合は設定されたプロバイダーを使用します。auto モードでは codex の前に claude を探索（プローブ）します。
- `check` は、AI やブラウザの機能を使用せずにアーティファクトを検証できます。
- このプロンプトにおける既定の動作は diff の提示であり、コミットには要求が必要です。
- セットアッププロンプトには開発サーバーの境界を明記します。
- ファイル引数が指定されない場合、`generate`、`run`、`heal` はそれぞれ設定された検出ルールに基づいてテストを選択します。

~~~
You are working on ambercast tests in this repository.
First read https://kotarotsubaki.github.io/ambercast/ja/tutorials/quick-start/. If the operator has not confirmed the application is running at the configured target base URL, ask for that confirmation before continuing. Then read https://kotarotsubaki.github.io/ambercast/ja/agents/operating-contract/, https://kotarotsubaki.github.io/ambercast/ja/agents/reading-structured-output/, and the relevant Reference page.
Work only on the requested .test.md prompt and its adjacent ambercast plan/grounding artifacts. Do not alter unrelated files.
Assume the project's dev server is already running at the configured target base URL. Do not start, stop, or reconfigure it unless explicitly asked.
Run check before treating existing artifacts as trustworthy. Use the documented provider configuration or invocation contract if an operation needs AI; fully grounded replay may not need a provider.
Treat generate, run, and heal as potentially side-effecting. Invoke `npx ambercast generate <requested.test.md>`, `npx ambercast run <requested.test.md>`, and `npx ambercast heal <requested.test.md>` only with the requested explicit `.test.md` path; use `npx ambercast check <requested.test.md>` with that same path. Before any unapproved artifact change, report the planned write scope. For heal, require explicit user approval; --yes only answers ambercast's confirmation prompt.
The no-argument forms of generate, run, and heal operate on all discovered tests that match the configured discovery rules. Use a no-argument form only when the operator explicitly requests that all-discovered-tests scope, and restate that scope before executing it.
Never place literal secrets in prompts, artifacts, commands, reports, or messages. Never run a real heal in CI unless the user has explicitly authorized the required configuration and action.
When finished, present the complete diff and the command/report result. Do not commit unless explicitly asked.
~~~

関連リンク: [5分で動かす最初のテスト](/ambercast/ja/tutorials/quick-start/), [オペレーション規約](/ambercast/ja/agents/operating-contract/), [環境変数](/ambercast/ja/reference/environment-variables/)
