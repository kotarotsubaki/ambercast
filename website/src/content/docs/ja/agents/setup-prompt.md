---
title: セットアッププロンプト
description: 依頼された1つのテストだけを扱い、差分を示し、依頼のない書き込みの前に確認するよう、コーディングエージェントへ貼り付ける1本のプロンプトである。
---

このプロンプトをエージェントに渡すと、エージェントは何を読んでから、どの範囲で、どの順に動くかが決まる。内容は英語のまま貼り付ける。

## コピー用プロンプト {#copy-paste-prompt}

プロンプトは次の5つの規則を置く。

1. AIプロバイダーは、明示した指定、設定されたプロバイダーの順に選ぶ。`auto`のときは`claude`、`codex`の順に探す。
2. `check`は、AIとブラウザを使わずに成果物を調べる。
3. 既定の動作は差分を示すことで、コミットは依頼があったときだけ行う。
4. 開発サーバーはオペレーターのものである。エージェントは、設定されたベースURLでアプリがすでに動いていると仮定し、起動や停止をしない。
5. ファイルを指定しない`generate`、`run`、`heal`は、設定された検出規則に合う全テストを選ぶ。

~~~markdown
You are working on ambercast tests in this repository.
First read https://kotarotsubaki.github.io/ambercast/ja/tutorials/quick-start/. If the operator has not confirmed the application is running at the configured target base URL, ask for that confirmation before continuing. Then read https://kotarotsubaki.github.io/ambercast/ja/agents/operating-contract/, https://kotarotsubaki.github.io/ambercast/ja/agents/reading-structured-output/, and the relevant Reference page.
Work only on the requested .test.md prompt and its adjacent ambercast plan/grounding artifacts. Do not alter unrelated files.
Assume the project's dev server is already running at the configured target base URL. Do not start, stop, or reconfigure it unless explicitly asked.
Run check before treating existing artifacts as trustworthy. Use the documented provider configuration or invocation contract if an operation needs AI; fully grounded replay may not need a provider.
Treat generate, run, and heal as potentially side-effecting. Invoke `npx ambercast generate <requested.test.md>`, `npx ambercast run <requested.test.md>`, and `npx ambercast heal <requested.test.md>` only with the requested explicit `.test.md` path; use `npx ambercast check <requested.test.md>` with that same path. Before any unapproved artifact change, report the planned write scope. For heal, require explicit user approval; --yes only answers ambercast's confirmation prompt.
The no-argument forms of generate, run, and heal operate on all discovered tests that match the configured discovery rules. Use a no-argument form only when the operator explicitly requests that all-discovered-tests scope, and restate that scope before executing it.
Never place literal secret values in prompts, artifacts, commands, reports, or messages. Never write secret references or legacy `@ambercast-secret` grant lines in `.test.md` prompt text; a committed Plan or Grounding artifact may correctly contain a valid `secretRef` after local resolution and consent. When generate proposes a secret name outside `secrets.allow`, obtain the operator's approval interactively or ask them to add a reviewed name to `secrets.allow`; never use `"*"` without explicit operator approval. Never run a real heal in CI unless the user has explicitly authorized the required configuration and action.
When finished, present the complete diff and the command/report result. Do not commit unless explicitly asked.
~~~

関連リンク: [5分で動かす最初のテスト](/ambercast/ja/tutorials/quick-start/)、[オペレーション規約](/ambercast/ja/agents/operating-contract/)、[環境変数](/ambercast/ja/reference/environment-variables/)
