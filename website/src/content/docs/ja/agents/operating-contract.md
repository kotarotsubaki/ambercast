---
title: オペレーション規約
description: コマンドごとに、実行前に満たすべき条件、書き込みの範囲、ユーザーの承認の要否と、終了コードやレポートのエラーを受けた次の行動を定める。
---

エージェントはこのページで、コマンドを実行してよいか、実行後に何をするかを決める。CLIが実装しているコマンドは`init`、`generate`、`run`、`check`、`heal`、`view`、`mcp`の7つである。

## コマンドごとの規約 {#command-contract}

コマンドを実行する前に、前提条件と副作用を確かめる。`check`と`view`は、書き込み用ストレージ、AIプロバイダー、ブラウザのいずれも必要としない。`heal`は計画（plan）とグラウンディングの変更を確認まで保留するが、確認の前や`--dry-run`の最中にも、`runsDir`の下へ試行の証跡を書くことがある。

| コマンド | 前提条件 | 副作用 | 承認 | CIでの利用 |
| --- | --- | --- | --- | --- |
| `init` | 対象ディレクトリへの書き込み権限 | 設定ファイル、サンプルのプロンプト、2行の`.gitignore`の追記、`AGENTS.md`のブロックを書くことがある | ユーザーの明示的な承認が必要。`--yes`はエージェントの承認にならない | `--yes`なしの非対話実行は拒否される。CIで使っても承認の境界は変わらない |
| `generate` | 選んだプロンプトとターゲットが有効であること | 計画とグラウンディングを書く。対話での同意の後、承認された機密名を`secrets.allow`へ加える | 同意と書き込みに承認が必要。コミットの前に差分を示す | レビュー済みの名前が`secrets.allow`にあれば使える |
| `run` | 選んだプロンプトに信頼できる計画があること | レポートを保存する。グラウンディングは書き戻しの条件を満たすときだけ書く | 依頼の範囲が書き込みを認めていなければ必要 | 書き戻しの方針に従って使える |
| `check` | テストを検出できること | プロンプトと成果物を読むだけ | 不要 | 使える |
| `heal` | 計画が参照する全ターゲットで`healReplayIsolation: "idempotent"`を設定済みであること | 試行の証跡を書くことがある。計画とグラウンディングの変更は確認の後にだけ書く | ユーザーの明示的な承認が必要。`--yes`はエージェントの承認にならない | 既定では使えない。`--list`以外は`ci.heal: true`のときだけ使える |
| `view` | stdinとstderrが端末で`CI`が無効か、`--allow-headless`を渡すこと。`--port`なしなら連続20ポートまで試す | なし。保存済みのレポートを読み取り専用で配信する | 不要 | 既定では使えない。`--allow-headless`で非対話の実行を許す |
| `mcp` | セッションルートのディレクトリが存在すること | stdioのサーバーを起動する。呼んだツールがそれぞれの書き込みと承認の境界に従う | 呼ぶツールによる | 呼ぶツールによる |

`heal`の前提を満たさないと、終了コード2で`CONFIG_INVALID`になる。

関連リンク: [CLIの概要](/ambercast/ja/reference/cli/overview/)、[ambercast init](/ambercast/ja/reference/cli/init/#confirmation)、[ambercast heal](/ambercast/ja/reference/cli/heal/#preconditions)、[ambercast run](/ambercast/ja/reference/cli/run/#grounding-write-back)

## 禁止事項 {#prohibitions}

次の制限は例外なく守る。

- プロンプト、成果物、コマンド、レポート、メッセージに、機密の値そのものを書かない。`SecretRef`と環境変数の値を使い、ターゲットのシンク方針に従う。
- `SECRET_LITERAL_REJECTED`は狭い検出にすぎず、機密の値を書かないという禁止の代わりにならない。
- `@ambercast-secret`の許可行を加えない。`secrets.allow`にない名前は、オペレーターの同意を得るか、レビュー済みの名前をオペレーターに加えてもらう。`"*"`はAIが提案する任意の名前を通すため、明示的な承認が要る。
- CIでは、`ci.heal`が`true`でない限り実際のhealを実行しない。
- `--yes`が答えるのはCLIの確認プロンプトだけである。`--dry-run`は計画とグラウンディングを書き換えない。

関連リンク: [機密情報を管理する](/ambercast/ja/how-to/manage-secrets/)、[ヒーリングモデル](/ambercast/ja/explanation/healing-model/#confirmation-and-writes)

## 終了コードごとの次の行動 {#next-action-by-exit-code}

複数の結果があるときの終了コードは、結果の並びではなく固定の優先順位で決まる。コードを受けたら、次の表に従う。

| 終了コード | 意味 | 次の安全な行動 |
| --- | --- | --- |
| 0 | 成功、または候補なし | 許可された差分を確かめ、範囲内で続ける |
| 1 | コマンド固有の否定的な結果 | 失敗の証跡を読む。自動でhealや再生成をしない |
| 2 | 使用方法または設定の問題 | `errors[].code`を読み、その境界を直す |
| 3 | 環境の問題 | JSONレポートを残し、テストの意味ではなく環境を直す |
| 4 | 計画またはグラウンディングを信頼できない | `MISSING_PLAN`、`STALE_PLAN`、`INTEGRITY_VIOLATION`では、古い成果物の復旧手順に従う。`GROUNDING_UNRESOLVED`では、依頼の範囲がAIの呼び出しとグラウンディングの書き込みを認めるときだけ`--resolve`を付けて再実行し、認めないなら報告する |
| 5 | 選択が空 | 空の選択を許すか、依頼の意図を確かめ直す |

関連リンク: [終了コード](/ambercast/ja/reference/exit-codes/#aggregation-priority)

## レポートのエラーごとの次の行動 {#next-action-by-report-error}

レポートスキーマは、15個の使用方法コードと8個の環境コードを定義している。`INTERRUPTED`は実行単位のエラーで、影響を受けたケースは`skipped`の行に表れる。コードは次のどれか1行に当てはまる。

| コード | 次の安全な行動 |
| --- | --- |
| `CONFIG_INVALID`、`PROMPT_PATH_INVALID`、`TARGET_UNRESOLVED`、`EXECUTOR_UNSUPPORTED`、`PROMPT_AMBIGUOUS` | 該当するリファレンスを読み、値を推測せずに境界を直す |
| `SECRET_UNRESOLVED`、`SECRET_LITERAL_REJECTED`、`SECRET_ENV_VAR_COLLISION`、`SECRET_SYNTAX_REJECTED` | 機密の参照と環境変数を直す。値をプロンプトへ書かない |
| `SECRET_CONSENT_REQUIRED` | 対話で承認を得るか、レビュー済みの名前を`secrets.allow`へ加える。同意済みとして再試行しない |
| `MISSING_PLAN`、`STALE_PLAN`、`INTEGRITY_VIOLATION` | 成果物を信頼せず、古い成果物の復旧手順に従う |
| `GROUNDING_UNRESOLVED` | 依頼の範囲が認めるときだけ`--resolve`を付けて再実行し、認めないなら報告する |
| `BROWSER_LAUNCH_FAILED`、`AI_EXECUTOR_UNAVAILABLE`、`AI_RESPONSE_INVALID`、`FS_IO_ERROR`、`UNEXPECTED_CRASH` | JSONレポートを残し、環境を直す |
| `AGENTIC_STEP_FAILED`、`CASE_ABORTED` | `details`を読む。ケースの結果を推測せず、環境か呼び出しの条件を直す |
| `INTERRUPTED` | 残りの作業を未完了として扱い、ケースの結果を推測しない |

関連リンク: [エラーコード](/ambercast/ja/reference/error-codes/)、[構造化出力の読み取り](/ambercast/ja/agents/reading-structured-output/#decision-tree)、[よくある失敗のトラブルシューティング](/ambercast/ja/how-to/troubleshoot/)
