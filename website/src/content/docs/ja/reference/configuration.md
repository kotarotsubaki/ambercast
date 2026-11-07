---
title: 設定
description: ambercast の設定キー、既定値、設定ファイルを選ぶ規則を示すリファレンス。
---

ambercast は、1 つの設定ファイルと組み込みの既定値から設定を組み立てる。このページは、ファイルの選び方、ターゲットの設定、すべてのキーを扱う。

## ファイルの選択 {#file-selection}

存在する設定ファイルには `$schema` が必須である。そのほかの宣言済みのキーは、すべて任意である。

ambercast は、次の順でファイルを選ぶ。

1. コマンドの `--config` の値。`generate`、`check`、`view` が受け付け、`run`、`heal`、`init`、`mcp` は受け付けない。[コマンドとフラグの対応表](/ambercast/ja/reference/cli/overview/#command-flag-matrix)を参照する。
2. 環境変数 `AMBERCAST_CONFIG`。詳細は[環境変数](/ambercast/ja/reference/environment-variables/#configuration)を参照する。
3. 祖先ディレクトリにある `ambercast.config.json`。
4. 組み込みの既定値。

明示したパスが存在しなければエラーになる。検出や既定値には切り替わらない。

指定した `targets` オブジェクトは、既定のターゲットとマージせず、置き換える。置き換えで `defaultTarget` を省くと、既定のターゲットは解除される。

## ターゲット {#targets}

ターゲットは、Web サーフェスとブラウザーの接続先を与える。ambercast は `healReplayIsolation` と `resolveTimeoutMs` を、heal の前と要素の解決の前に、その場で解決する。これらは計画（plan）のフィールドではなく、`inputsDigest` にも入らない。

ファイルを読み込むとき、ambercast は記述された `locale` を `Intl.getCanonicalLocales` で正規化する。たとえば `"ja-jp"` は `"ja-JP"` になる。`RangeError` を投げる値、空文字列、文字列以外の値は、issue path（問題のパス） `targets.<name>.locale` で `CONFIG_INVALID`（終了コード 2）として失敗する。

正規化した locale は、計画のターゲット定義と Playwright のブラウザーコンテキストに渡る。そのターゲットのページの `navigator.language` と、最初のリクエストの `Accept-Language` ヘッダーに影響する。

この設定の効果は、そこまでである。タイムゾーン、アプリ側の言語 Cookie、アプリ側の設定は変えない。それらとの優先順位も定めない。

## キー一覧 {#key-table}

| キーのパス | 型 | 既定値 | 制約 | 使う側 |
| --- | --- | --- | --- | --- |
| `$schema` | string | — | 設定ファイルがある場合は必須 | ローダー |
| `testDir` | string | `tests/ambercast` | 絶対パスのレイアウトに解決される | generate、run、check、heal（検出とレイアウト） |
| `runsDir` | string | `tests/ambercast/.runs` | 絶対パスのレイアウトに解決される | run（レポートと証拠）、heal（範囲を限った書き込み） |
| `testMatch` | string[] | `["**/*.test.md"]` | `*`/`**` に限った一致規則。すべてのパターンは `.test.md` で終わる必要があり、そうでなければ読み込みは `CONFIG_INVALID` で失敗する | generate、run、check、heal（検出） |
| `testIgnore` | string[] | `["**/.runs/**","**/*.ambercast.plan.json","**/*.ambercast.grounding.json"]` | 包含の判定のあとで除外する | generate、run、check、heal（検出） |
| `secrets.allow` | `SecretName[] \| "*"` | `[]` | 空配列は、すべてのシークレット名に同意を求める。`"*"` は同意なしですべての名前を許可する（非推奨）。空でない配列は、列挙した名前だけを許可する | generate、run、heal |
| `targets.<name>.baseUrl` | string | `web-user` では `http://localhost:3000` | 自分で書くすべてのターゲットで必須。リテラルの `{{secrets.` を含まない http(s) URL。ターゲットのレコード全体を置き換える | generate（入力）、run、check、heal（計画が参照するターゲット） |
| `targets.<name>.surface` | `web` | — | TP1 では `web` だけである。省略可能なフィールドで、スキーマの既定値ではなく、使用時に `web` に解決される | generate、計画のターゲット定義 |
| `targets.<name>.description` | string | — | 任意の生成コンテキスト | generate |
| `targets.<name>.executor.kind` | `playwright` | `playwright` | 実行時の UI 実行器の種類。計画のダイジェストには含めない | run、heal（実行器の組み立て） |
| `targets.<name>.executor.browser` | `chromium` | `chromium` | 実行時の実行器が使うブラウザー。計画のダイジェストには含めない | run、heal（実行器の組み立て） |
| `targets.<name>.secretSinkOrigins` | `Record<SecretRef, SecretSinkOrigin[]>` | — | シークレットの項目がなければ、許可するのは `baseUrl` だけである。空配列は、そのシークレットをすべての場所で拒否する。空でない配列は、この既定値を置き換える。各オリジンは `scheme://host[:port]` の形で、ポートは 1〜65535 とし、パス、クエリ、フラグメント、ワイルドカード、ユーザー情報、リテラルの `{{secrets.` を含められない | generate、run、heal（シークレットの送り先の方針）、check（鮮度） |
| `targets.<name>.healReplayIsolation` | `idempotent\|stateful` | `stateful` | heal は、計画が参照するすべてのターゲットが `idempotent` であることを求める | heal |
| `targets.<name>.locale` | string | — | `Intl.getCanonicalLocales` で正規化される。正規化に失敗した値は `CONFIG_INVALID` になる | generate、計画のターゲット定義、run（ブラウザーコンテキスト） |
| `targets.<name>.resolveTimeoutMs` | integer | `5000` | 0〜60000 | run、heal |
| `defaultTarget` | string | `web-user` | ターゲットに解決される必要がある。プロンプトがステップのターゲットを示さないとき、ジェネレーターが使う | generate |
| `ai.provider` | `claude\|codex\|auto` | `auto` | CLI のフラグまたは環境変数で上書きできる | generate、run（フォールバック）、heal |
| `ai.maxGenerateAttempts` | positive integer | `2` | 1〜5。ファイルごとの生成の試行回数 | generate だけ。heal の第 3 段階では使わない |
| `ai.timeoutMs` | positive integer | `600000` | 正の数 | generate、run（フォールバック）、heal |
| `viewer.port` | integer | `4600` | 1〜65535。探索の開始候補で、`--port` で上書きされる | view |
| `ci.heal` | boolean | `false` | CI で、一覧表示以外の heal を使うための明示的な選択 | heal |
| `ci.updateGroundingCache` | boolean | `false` | CI で、キャッシュの書き戻しを使うための明示的な選択 | run |
| `grounding.repositoryPolicy` | `committed\|uncommitted` | `committed` | 取りうる値は有限である | check |
| `grounding.localWriteBack` | `auto\|explicit` | `auto` | CI では無視される | run |
| `heal.maxStepRepairs` | positive integer | — | 実プロバイダーへの増分の呼び出し回数だけを制限する | heal |
| `heal.caseTimeoutMs` | positive integer | `300000` | ケースを受け付ける期限 | heal |

`testMatch` と `testIgnore` のパターンは、[パターン言語](/ambercast/ja/reference/discovery-patterns/#pattern-language)に従う。

## シークレットの同意 {#secret-consent}

`secrets.allow` は、生成中に見つかった論理的なシークレット名を保存する許可リストである。`generate` は、リストにない名前を確認し、承認した名前をファイルに追記する。CI など対話できない環境では、確認済みの名前をあらかじめリストに入れておく。

`"*"` は名前ごとの同意を省き、AI が提案した任意の名前を受け入れる。より安全な既定値ではなく、リスクの高い抜け道である。提案された任意の名前を確認せずに受け入れる意図があるときだけ使う。

## AI の設定 {#ai}

`ai.maxGenerateAttempts` は、`generate` がプロンプト 1 つについてプロバイダーに問い合わせる最大回数であり、初回を含む。再試行するのは、ローカルの検証が応答を退けたときだけである。範囲は 1 から 5 で、既定値は 2 である。heal の修復には適用しない。

`ai.timeoutMs` は、プロバイダーへの 1 回の呼び出しの期限をミリ秒で示す。既定値は 600000 である。generate、run、heal のすべての呼び出しに適用する。heal のケースの期限は受け付けの判断にだけ使うため、受け付けた呼び出しはこの値まで動き続けることがある。

## heal の設定 {#heal}

`heal.maxStepRepairs` は、実プロバイダーへの増分の呼び出しの回数を制限する。`heal.caseTimeoutMs` は、ケース全体の受け付けの期限である。

## グラウンディングの書き戻し {#grounding}

| 環境 | 解決される方針 | グラウンディングを書き込む条件 |
| --- | --- | --- |
| ローカル | `localWriteBack: auto` | グラウンディングの結果が変わったとき |
| ローカル | `localWriteBack: explicit` | `--update-cache` を渡したとき |
| CI | `localWriteBack` は無視される | `--update-cache` を渡したとき、または `ci.updateGroundingCache: true` のとき |

コマンドの動作は [ambercast run](/ambercast/ja/reference/cli/run/#grounding-write-back) を参照する。

## 関連項目 {#see-also}

- [CLIの概要](/ambercast/ja/reference/cli/overview/#command-flag-matrix)
- [ディスカバリーパターン](/ambercast/ja/reference/discovery-patterns/#pattern-language)
- [環境変数](/ambercast/ja/reference/environment-variables/#configuration)
- [ambercast run](/ambercast/ja/reference/cli/run/#grounding-write-back)
