---
title: CLIの概要
description: ambercast の 7 つのコマンド、コマンドごとのオプション、ファイル探索の既定値をまとめたリファレンス。
---

`ambercast` はコマンドごとに引数を解析する。ファイルを指定しない場合の選択は、設定された探索に任せる。

## コマンド体系 {#command-surface}

実装済みのコマンドは `init`・`generate`・`run`・`check`・`heal`・`view`・`mcp` の 7 つだけである。

`ambercast run <file>`・`ambercast check <file>`・`ambercast heal <file>` は、手順が実行先のターゲットを名指しする計画（plan）を対象にする。

最上位の `--help` と `--version` は、コマンドの振り分けより前に処理される。認識されたコマンドの後ろで `--` より前に置いた `--help` も、そのコマンドがすぐに処理する。形式が不正な引数は、レポートを出さずに終了コード `2` で終わり、使い方を標準エラーに書く。

次の使い方ブロックは、CLI 自身のヘルプ出力と一致する。`AI configuration` と `Heal configuration` の行も含む。

```text
Usage: ambercast <command> [options]

Commands:
  init                 Scaffold config and a sample prompt
  generate [files...]  Generate deterministic plans
  run [files...]       Replay deterministic plans
  check [files...]     Check plan freshness
  heal [files...]      Repair deterministic plans
  view                 Browse run results in a browser
  mcp                  Serve the MCP stdio server

Init options:
  --dir <path>  --yes, -y  --force  --no-color

Generate options:
  --force  --dry-run  --target <name>  --ai <claude|codex>
  --allow-empty  --list  --json  --config <path>  --no-color

Run options:
  --grep <pattern>  --headed  --resolve  --update-cache  --allow-empty  --list
  --stale <fail>  --ai <claude|codex>  --json  --no-color

Check options:
  --allow-empty  --list  --json  --config <path>  --no-color

Heal options:
  --dry-run  --yes, -y  --ai <claude|codex>  --allow-empty  --list  --json  --no-color

View options:
  --port <n>  --host <addr>  --allow-headless  --config <path>  --no-color

Mcp options:
  --dir <path>  --sync-wait-ms <n>

AI configuration:
  ai.timeoutMs: Deadline in milliseconds for one provider dispatch. Applies to every generate, run, and heal dispatch. The heal case deadline is an admission boundary only, so an admitted dispatch may still run up to this value. Default 600000.
  ai.maxGenerateAttempts: Maximum provider attempts per prompt during generate when the local validators reject a response. Between 1 and 5, default 2. Never applies to heal repairs.

Heal configuration:
  heal.maxStepRepairs: Hard limit on real provider dispatches started during incremental repair. Charged at dispatch time regardless of outcome. Includes element confirmation dispatches. Excludes the cache-only baseline and Stage 3.
  heal.caseTimeoutMs: see docs/configuration.md for its admission-boundary contract.
```

## コマンドとオプションの対応表 {#command-flag-matrix}

| コマンド | 位置引数 | 受け付けるオプション | 設定の経路 |
| --- | --- | --- | --- |
| init | なし | dir, yes/-y, force, no-color | `--dir` 引数（省略時はカレントディレクトリ） |
| generate | リテラルパス。なしなら探索 | force, dry-run, target, ai, allow-empty, list, json, config, no-color | `--config` > `AMBERCAST_CONFIG` > 探索 |
| run | リテラルパス。なしなら探索 | grep, headed, resolve, update-cache, stale, ai, allow-empty, list, json, no-color | `AMBERCAST_CONFIG` > 探索 |
| check | リテラルパス。なしなら探索 | allow-empty, list, json, config, no-color | `--config` > `AMBERCAST_CONFIG` > 探索 |
| heal | リテラルパス。なしなら探索 | dry-run, yes/-y, ai, allow-empty, list, json, no-color | `AMBERCAST_CONFIG` > 探索 |
| view | なし | port, host, allow-headless, config, no-color | `--config` > `AMBERCAST_CONFIG` > 探索 |
| mcp | なし | dir, sync-wait-ms | `--dir` 引数がセッションルートを選ぶ（省略時はカレントディレクトリ） |

`generate`・`run`・`check`・`heal` は、`--list` を除き、位置引数を `testDir` 内のリテラルパスとして受け取る。`.test.md` の前の名前は空であってはならず、接尾辞は正確に `.test.md` でなければならない。条件を満たさないパスは `PROMPT_PATH_INVALID` になる。

- `--` を渡すと、そこでオプションの解析が終わり、以降の引数はすべてリテラルパスになる。
- `--json` と `--no-color` は、共有のグローバルフラグではなく、コマンドごとに処理される。
- `generate --target` は、生成器が使えるターゲット定義を絞る。`run`・`check`・`heal` は、各計画に記録されたターゲット名を使う。

## 探索の既定値 {#discovery-default}

`generate`・`run`・`check`・`heal` にリテラルのファイルを渡さないと、設定された探索がテストファイルを選ぶ。`init`・`view`・`mcp` はプロンプトファイルの引数を取らない。

- 既定の `testMatch` は `**/*.test.md` である。
- 既定の `testIgnore` は `**/.runs/**` と、計画およびグラウンディングのコンパニオンファイルである。
- 探索は POSIX 形式の相対パスを評価する。包含パターンの一致が先で、除外パターンの一致があればそのパスは外れる。

詳細は次のページにある。

- [設定](/ambercast/ja/reference/configuration/#file-selection)
- [探索パターン](/ambercast/ja/reference/discovery-patterns/#selection)
- [ambercast init](/ambercast/ja/reference/cli/init/#flags)
- [ambercast generate](/ambercast/ja/reference/cli/generate/#flags)
- [ambercast run](/ambercast/ja/reference/cli/run/#flags)
- [ambercast check](/ambercast/ja/reference/cli/check/#flags)
- [ambercast heal](/ambercast/ja/reference/cli/heal/#flags)
- [ambercast view](/ambercast/ja/reference/cli/view/#flags)
- [ambercast mcp](/ambercast/ja/reference/cli/mcp/#usage)
