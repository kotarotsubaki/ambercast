---
title: official skill
description: ambercastは、プロンプトを書き、実行し、レポートを読むループをコーディングエージェントに教えるAgent Skillsのskill`ambercast`を同梱している。
---

エージェントはこのページで、skillが何を教えるか、セットアッププロンプトやMCPサーバーとどう使い分けるかを決める。

## skillの内容 {#what-it-is}

ambercastは、[Agent Skills](https://agentskills.io)のskillを`skills/ambercast/SKILL.md`に同梱している。名前は`ambercast`である。コーディングエージェントに、`<name>.test.md`のプロンプトの書き方、CLIで`generate`、`run`、`check`、`heal`を動かす手順、`--json`のレポートと終了コードの読み方、次の安全な行動の選び方を教える。

導入方法はClaude Code、Codex CLI、`gh skill`対応のエージェント、skills.sh、インストール済みパッケージからの手動コピーで、[README](https://github.com/kotarotsubaki/ambercast#official-skill)にある。

## 想定する役割 {#intended-role}

skillは、実行のループを教える。[セットアッププロンプト](/ambercast/ja/agents/setup-prompt/)は、依頼された1つのテストに対して、差分を先に示すという境界を置く。[MCP サーバー](/ambercast/ja/agents/mcp-server/)は、シェルではなくツール呼び出しで動くクライアントのための接続である。

ambercastはコーディングエージェントを、人向けのプロンプトやビューアと並ぶ第一級の利用者として扱う。

関連リンク: [AIエージェントからのambercastの利用](/ambercast/ja/agents/overview/)、[セットアッププロンプト](/ambercast/ja/agents/setup-prompt/)、[MCP サーバー](/ambercast/ja/agents/mcp-server/)、[ステータスとロードマップ](/ambercast/ja/explanation/status-and-roadmap/)
