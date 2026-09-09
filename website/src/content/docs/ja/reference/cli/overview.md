---
title: CLIの概要
description: ambercast CLI のパーサー全体の仕様、コマンド体系、および自動探索の既定動作を解説します。
---

`ambercast` CLI におけるパーサー全体の動作仕様、実装されているコマンド体系、およびオプションの対応関係について解説します。本ツールには `generate`、`run`、`check`、`heal` の 4 つのコマンドが実装されています。

## コマンド体系 {#command-surface}

```text
Usage: ambercast <command> [options]

Commands:
  generate [files...]  Generate deterministic plans
  run [files...]       Replay deterministic plans
  check [files...]     Check plan freshness
  heal [files...]      Repair deterministic plans

Generate options:
  --strict  --force  --dry-run  --target <name>  --ai <claude|codex>
  --allow-empty  --list  --json  --config <path>  --no-color

Run options:
  --grep <pattern>  --target <name>  --headed  --cache-only  --update-cache  --allow-empty  --list
  --stale <fail>  --json  --no-color

Check options:
  --target <name>  --allow-empty  --list  --json  --config <path>  --no-color

Heal options:
  --dry-run  --yes, -y  --target <name>  --ai <claude|codex>  --allow-empty  --list  --json  --no-color

AI configuration:
  ai.timeoutMs: Deadline in milliseconds for one provider dispatch. Applies to every generate, run, and heal dispatch. The heal case deadline is an admission boundary only, so an admitted dispatch may still run up to this value. Default 600000.
  ai.maxGenerateAttempts: Maximum provider attempts per prompt during generate when the local validators reject a response. Between 1 and 5, default 2. Never applies to heal repairs.

Heal configuration:
  heal.maxStepRepairs: Hard limit on real provider dispatches started during incremental repair. Charged at dispatch time regardless of outcome. Includes element confirmation dispatches. Excludes the cache-only baseline and Stage 3.
  heal.caseTimeoutMs: see docs/configuration.md for its admission-boundary contract.
```

実装されているコマンドは `generate`、`run`、`check`、`heal` です。

トップレベルの `--help` および `--version` は、コマンドのディスパッチ前に処理を終了（ショートサーキット）します。不正な形式の引数が指定された場合は、レポートを出力せずに終了コード 2 で終了します。

## コマンド・オプション対応表 {#command-flag-matrix}

| コマンド | 位置引数 | 受け付けるオプション | 設定ファイルの探索優先順位 |
| --- | --- | --- | --- |
| generate | リテラルパス（パス未指定時は探索） | `strict`（厳格）、`force`（強制）、`dry-run`（ドライラン）、`target`（ターゲット指定）、`ai`（AIプロバイダー）、`allow-empty`（空結果の許可）、`list`（一覧表示）、`json`（JSON出力）、`config`（設定パス）、`no-color`（カラー無効化） | `--config` > `AMBERCAST_CONFIG` > 探索 |
| run | リテラルパス（パス未指定時は探索） | `grep`（パターン抽出）、`target`（ターゲット指定）、`headed`（ブラウザ表示）、`cache-only`（キャッシュのみ）、`update-cache`（キャッシュ更新）、`stale`（stale（古くなった状態））、`ai`（AIプロバイダー）、`allow-empty`（空結果の許可）、`list`（一覧表示）、`json`（JSON出力）、`config`（設定パス）、`no-color`（カラー無効化） | `AMBERCAST_CONFIG` > 探索 |
| check | リテラルパス（パス未指定時は探索） | `target`（ターゲット指定）、`allow-empty`（空結果の許可）、`list`（一覧表示）、`json`（JSON出力）、`config`（設定パス）、`no-color`（カラー無効化） | `--config` > `AMBERCAST_CONFIG` > 探索 |
| heal | リテラルパス（パス未指定時は探索） | `dry-run`（ドライラン）、`yes`/`-y`（プロンプト確認の省略）、`target`（ターゲット指定）、`ai`（AIプロバイダー）、`allow-empty`（空結果の許可）、`list`（一覧表示）、`json`（JSON出力）、`config`（設定パス）、`no-color`（カラー無効化） | `AMBERCAST_CONFIG` > 探索 |

`--` はオプション解析を終了し、後続のすべての引数をリテラルパスとして残します。

`--json` および `--no-color` は、グローバルフラグの抽象化機構ではなく、各コマンドによって個別に解析されます。

`--list` を除き、各位置引数は `testDir` 内にあり、空でない名前部分を持ち、拡張子が正確に `.test.md` であるリテラルパスでなければなりません。適格でないパスは、黙って無視されたり実行時クラッシュに至ったりする代わりに `PROMPT_PATH_INVALID` を発生させます。

ターゲットの優先順位は、明示的に指定されたターゲット、設定された既定値、単一のみ設定されたターゲットの順序で評価され、いずれにも該当しない場合は選択に失敗します。

## 探索の既定動作 {#discovery-default}

リテラルファイルが指定されていない場合、実装されているすべてのコマンドは対象の選択を設定済みの自動探索に委譲します。既定の包含パターンは `**/*.test.md` であり、既定の除外対象には `.runs`、Plan コンパニオン、および Grounding コンパニオンが含まれます。

探索処理は POSIX 相対パスを評価し、包含パターンのマッチ（inclusion match）を要求した上で、除外パターンのマッチ（ignore match）によって該当するパスを除外します。

関連情報: [設定](/ambercast/ja/reference/configuration/#file-selection)、[ディスカバリーパターン](/ambercast/ja/reference/discovery-patterns/#selection)、[ambercast generate](/ambercast/ja/reference/cli/generate/#flags)、[ambercast run](/ambercast/ja/reference/cli/run/#flags)、[ambercast check](/ambercast/ja/reference/cli/check/#flags)、[ambercast heal](/ambercast/ja/reference/cli/heal/#flags)
