---
title: 設定
description: ambercast の設定キーと設定解決に関する仕様です。
---

ambercast の設定キーと設定解決の仕様について説明します。設定ファイルが存在する場合、`$schema` の指定が必須となりますが、それ以外のすべてのキーは任意です。設定はコマンドライン引数、環境変数、設定ファイル、組み込みデフォルト値の解決順序に従ってロードされます。

## ファイルの選択 {#file-selection}

存在する設定ファイルには `$schema` が必ず含まれている必要があります。それ以外の宣言可能なキーはすべて省略可能です。

設定の選択優先順位は次の順序に従います。

1. コマンドの `--config` オプション（`generate` および `check` のみ）
2. 環境変数 `AMBERCAST_CONFIG`
3. 祖先ディレクトリを遡って検索される `ambercast.config.json`
4. 組み込みのデフォルト値

明示的に指定された設定ファイルのパスが存在しない場合はエラーとなり、探索やデフォルト値へのフォールスルーは行われません。

設定ファイルで `targets` オブジェクトを指定した場合、デフォルトのターゲットとディープマージされるのではなく、ターゲット設定全体が置き換えられます。この置き換えに伴い `defaultTarget` を省略した場合は、デフォルトターゲットの指定がクリアされます。

## ターゲット {#targets}

ターゲット設定はブラウザの接続先を提供します。ターゲットの `healReplayIsolation` 設定は修復（heal）の実行前に解決され、Plan や inputs-digest のフィールドには含まれません。なお、`healReplayIsolation` の既定値は `stateful` です。

## 設定キー一覧 {#key-table}

| キーパス | 型 | デフォルト値 | 制約 | 利用箇所 |
| --- | --- | --- | --- | --- |
| `$schema` | string | — | 存在するファイルでは必須 | ローダー |
| `testDir` | string | `tests/ambercast` | 絶対配置パスへと解決 | generate、run、check、heal の探索／配置 |
| `runsDir` | string | `tests/ambercast/.runs` | 絶対配置パスへと解決 | run のレポート／エビデンス、heal 内の書き込み |
| `testMatch` | string[] | `["**/*.test.md"]` | 限定された `*`/`**` マッチャー。すべてのパターンは `.test.md` で終わる必要があり、そうでなければ設定読み込みは `CONFIG_INVALID` で失敗 | generate、run、check、heal の探索 |
| `testIgnore` | string[] | `["**/.runs/**","**/*.ambercast.plan.json","**/*.ambercast.grounding.json"]` | 包含マッチ後に除外 | generate、run、check、heal の探索 |
| `targets.<name>.baseUrl` | string | `web-user` において `http://localhost:3000` | ターゲットレコード全体を置換 | generate、run、check、heal のターゲット選択 |
| `targets.<name>.browser` | `chromium` | `web-user` において `chromium` | ターゲットフィールド | generate、run、heal のブラウザ構成、check（鮮度） |
| `targets.<name>.secretSinkOrigins` | `Record<SecretRef, SecretSinkOrigin[]>` | なし | シークレットエントリが存在しない場合は `baseUrl` のみを許可。空配列の場合はそのシークレットをすべての場所で拒否。空でない配列の場合はそのデフォルトを置換 | generate、run、heal のシークレットシンクポリシー、check（鮮度） |
| `targets.<name>.healReplayIsolation` | `idempotent|stateful` | `stateful` | heal には選択された `idempotent` ターゲットが必要 | heal |
| `defaultTarget` | string | `web-user` | ターゲットへと解決される必要あり | generate、run、check、heal のターゲット選択 |
| `ai.provider` | `claude|codex|auto` | `auto` | CLI や環境変数によって上書きされる場合あり | generate、run のフォールバック、heal |
| `ai.timeoutMs` | 正の整数 | `120000` | 正の値 | generate、run のフォールバック、heal |
| `viewer.port` | 整数 | `4600` | 1〜65535。viewer コマンドは計画段階です | 計画されている `view` のみ |
| `ci.heal` | boolean | `false` | CI におけるリスト表示以外の heal のオプトイン | heal |
| `ci.updateGroundingCache` | boolean | `false` | CI での書き戻しのオプトイン | run |
| `grounding.repositoryPolicy` | `committed|uncommitted` | `committed` | 定義済みの語彙 | check |
| `grounding.localWriteBack` | `auto|explicit` | `auto` | CI では無視される | run |
| `heal.maxStepRepairs` | 正の整数 | なし | 実際のプロバイダーへの増分ディスパッチのみを制限 | heal |
| `heal.caseTimeoutMs` | 正の整数 | `300000` | ケース受付のデッドライン | heal |

## 自己修復設定 {#heal}

`heal.maxStepRepairs` は実際のプロバイダーに対する段階的なディスパッチ回数を制御し、`heal.caseTimeoutMs` はテストケース全体の受付期限（デッドライン）を設定します。

## Groundingの書き戻し {#grounding}

| 環境 | 解決されたポリシー | Groundingが書き戻される条件 |
| --- | --- | --- |
| ローカル | `localWriteBack: auto` | Grounding の結果が変更された後に自動的 |
| ローカル | `localWriteBack: explicit` | `--update-cache` が渡されたとき |
| CI | `localWriteBack` は無視される | `--update-cache` が渡されたとき、または `ci.updateGroundingCache: true` のとき |

関連リンク: [CLIの概要](/ambercast/ja/reference/cli/overview/#command-flag-matrix), [ディスカバリーパターン](/ambercast/ja/reference/discovery-patterns/#pattern-language), [環境変数](/ambercast/ja/reference/environment-variables/#configuration), [ambercast run](/ambercast/ja/reference/cli/run/#grounding-write-back)
