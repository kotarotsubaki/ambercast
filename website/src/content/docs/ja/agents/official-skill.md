---
title: official skill
description: ambercast が同梱する AI コーディングエージェント向け official skill と、エージェント向けインターフェースにおけるその役割について説明します。
---

本ページでは、ambercast が同梱する official skill と、エージェント向けインターフェースにおけるその役割について説明します。

## official skill とは {#what-it-is}

ambercast は `skills/ambercast/SKILL.md` に `ambercast` という名前の [Agent Skills](https://agentskills.io) スキルを同梱しています。コーディングエージェントに `<name>.test.md` プロンプトの書き方、CLI を通じた `generate` / `run` / `check` / `heal` ループの回し方、`--json` レポートの読み取りと終了コードの処理、次に取るべき安全なアクションの選び方を教えます。

インストール方法（Claude Code、Codex CLI、`gh skill` 対応エージェント、skills.sh、またはインストール済みパッケージからの手動コピー）は [README](https://github.com/kotarotsubaki/ambercast#official-skill) を参照してください。依頼されたテストを扱うエージェントに対しレビューを最優先とする境界を規定する、コピー＆ペースト可能な完全な運用プロンプトは [セットアッププロンプト](/ambercast/ja/agents/setup-prompt/) を参照してください。

## 想定される役割 {#intended-role}

エージェントインターフェースの設計では、人間向けのプロンプトやビューアのサーフェスと並び、コーディングエージェントをファーストクラスのユーザーとして扱います。

関連リンク: [AIエージェントからのambercastの利用](/ambercast/ja/agents/overview/), [セットアッププロンプト](/ambercast/ja/agents/setup-prompt/), [MCP サーバー](/ambercast/ja/agents/mcp-server/), [ステータスとロードマップ](/ambercast/ja/explanation/status-and-roadmap/)
