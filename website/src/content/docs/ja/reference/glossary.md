---
title: 用語集
description: ambercast 全体で使う用語の規範的な定義と、翻訳で変えないリテラルトークンの索引である。
---

各定義は規範であり、簡潔に述べる。フィールド、フラグ、ステータス、エラーの完全な表は、各定義にリンクした所有ドキュメントを参照する。予定段階のトークンには現行のランタイムセマンティクスがなく、現行版では使えない。

## アーティファクトに関する用語 {#artifact-terms}

次の定義は、スキーマとリゾルバーが規定するアーティファクトの中核モデルを定める。

| 用語 | 規範的定義 | 所有スキーマ / コマンド | 混同しやすい概念 |
| --- | --- | --- | --- |
| plan | 計画（plan）とは、`inputsDigest` に正規化プロンプトの出所を記録し、本体に名前付きターゲットと実行可能なステップを記録する、スキーマ準拠の `PlanDocument` である。 | `PlanDocument`; [計画ドキュメント](/ambercast/ja/spec/plan-document/) | prompt または grounding |
| grounding | グラウンディング（grounding）とは、ステップをキーとするエントリを、`planDigest` によって1つの計画に紐付ける、スキーマ準拠の計画単位のキャッシュである。 | `GroundingDocument`; [グラウンディングドキュメント](/ambercast/ja/spec/grounding-document/) | 計画または run レポート |
| artifact | アーティファクトとは、ツリー内の `.test.md` プロンプトから派生した、計画またはグラウンディングのコンパニオンである。 | レイアウト解決ツール; [ファイルレイアウト](/ambercast/ja/reference/file-layout/#companions) | runの実行エビデンス |
| fingerprint | フィンガープリントとは、リテラル `a11y-neighborhood-v2` のアルゴリズムと SHA-256 ハッシュを含む、要素グラウンディングの値である。 | `Fingerprint`; [要素フィンガープリント](/ambercast/ja/spec/fingerprint/) | `planDigest` |
| inputs digest | 入力ダイジェストとは、正規化プロンプト、計画のスキーマバージョン、ジェネレーターテンプレートのフィンガープリント、プロデューサーバンドルのフィンガープリント、名前付きターゲットから求める、出所確認用の標準的な SHA-256 ダイジェストである。 | `computeInputsDigest`; [鮮度とダイジェスト](/ambercast/ja/spec/freshness/) | `planDigest` |
| plan digest | 計画ダイジェストとは、グラウンディングを紐付けるために使う、`generatorMeta` を除いたスキーマ準拠の計画の標準的な SHA-256 ハッシュである。 | `computePlanDigest`; [鮮度とダイジェスト](/ambercast/ja/spec/freshness/) | `inputsDigest` |
| normalized test prompt | 正規化テストプロンプトとは、先頭の U+FEFF を最大1つ除去し、CRLF と単独の CR を LF に置き換え、それ以外をすべて保持したプロンプトである。 | `normalizeTestMd`; [プロンプトファイルのフォーマット](/ambercast/ja/reference/prompt-format/#normalization) | 書式の整形 |

`PlanDocument` と `GroundingDocument` は厳格なランタイムの信頼境界であり、JSON Schema はこれらから導出する。

## 実行に関する用語 {#execution-terms}

次の定義は、コマンドとレポートが規定する実行、ターゲット解決、レポートの契約を定める。

| 用語 | 規範的定義 | 所有スキーマ / コマンド | 混同しやすい概念 |
| --- | --- | --- | --- |
| replay | 再生（replay）とは、`run` が計画をそのグラウンディングとともに実行することである。`--resolve` を付けない再生は AI を呼ばない。 | `ambercast run`; [ambercast run](/ambercast/ja/reference/cli/run/) | heal |
| freshness | 鮮度（freshness）とは、実行結果ではなく、計画とグラウンディングのアーティファクトについて `check` が報告する出所の状態である。 | `ambercast check`; [鮮度とダイジェスト](/ambercast/ja/spec/freshness/) | runの成功 |
| stale | ステール（stale）とは、鮮度を信頼できないアーティファクトに対する、完了した `check` のステータスである。 | `CompletedCheckResult`; [ambercast check](/ambercast/ja/reference/cli/check/#status-vocabulary) | UIドリフト |
| drift | ドリフト（drift）とは、要素のフィンガープリントを変える、要素のアクセシビリティ近傍における局所的な変化である。 | フィンガープリント解決ツール; [要素フィンガープリント](/ambercast/ja/spec/fingerprint/) | ステールな計画の出所 |
| heal | healは修復コマンドである。`--list` 以外では、計画が参照するすべてのターゲットに `healReplayIsolation: "idempotent"` を要求し、CI では `ci.heal: true` も要求する。 | `ambercast heal`; [ambercast heal](/ambercast/ja/reference/cli/heal/#preconditions); [CIでのheal](/ambercast/ja/reference/cli/heal/#ci) | run実行時のグラウンディングフォールバック |
| target | ターゲットとは、設定済みの名前付きブラウザ接続先である。計画の各ステップがターゲットを名指しし、`generate` は設定済みターゲットから選ぶ。プロンプトが指定しないときは `defaultTarget` を使う。`run`、`check`、`heal` は計画からターゲットを取る。 | `defaultTarget`; [設定](/ambercast/ja/reference/configuration/#key-table) | プロンプト |
| replay isolation | 再生分離（replay isolation）とは、ターゲットポリシー `healReplayIsolation` を指す。`idempotent` はhealを許可し、`stateful` は拒絶する。healは計画が参照するすべてのターゲットを検査する。 | ターゲット設定 / `ambercast heal` | 計画のターゲット定義 |
| report envelope | レポートエンベロープとは、レポートを返すコマンドが返す、バージョン付きでコマンドごとに識別される構造化結果である。 | `ReportEnvelope`; [レポート](/ambercast/ja/reference/reports/#envelope) | 永続化された `report.json` |
| report persistence | レポート永続化（report persistence）とは、確定したエンベロープの書き込みに関する run エンベロープの状態であり、`persisted`、`failed`、`not-attempted` のいずれかである。 | runの `ReportEnvelope`; [レポート](/ambercast/ja/reference/reports/#persistence) | セマンティックなテスト結果 |
| secret reference | シークレット参照とは、`SecretRef` が受け入れる値全体の文字列であり、`secrets.` の後に、ASCII の英数字またはアンダースコアからなるドット区切りのセグメントが1つ以上続く。 | `SecretRef`; [プロンプトファイルのフォーマット](/ambercast/ja/reference/prompt-format/#secret-references) | リテラルのシークレット値 |
| consent | 同意とは、`generate` が `secrets.allow` の外にあるシークレット名を含む候補を永続化する前に必要な、対話式の判断である。 | `ambercast generate`; [シークレットの管理](/ambercast/ja/how-to/manage-secrets/) | 実行時のシークレット値解決 |
| allowlist | 許可リストとは、生成が候補を永続化する前に `secrets.allow` が受け入れる、レビュー済みの論理シークレット名の集合である。 | 設定 / `ambercast generate`; [設定](/ambercast/ja/reference/configuration/#secret-consent) | シークレットシンクのオリジン |
| `secrets.allow` | `secrets.allow` は、事前承認済みの論理シークレット名を並べる設定の配列である。高リスクな `"*"` を指定すると、AI が提案したすべての名前を名前ごとのレビューなしで受け入れる。 | `RawConfig`; [設定](/ambercast/ja/reference/configuration/#secret-consent) | `AMBERCAST_SECRET_*` の値 |
| `SecretNameChoice` | `SecretNameChoice` は、投影された `allowedName` と新しい `nameHint` のどちらかを選ぶ、プロバイダー向けの厳格な選択である。コミット済みの `SecretRef` が存在する前に、どちらもローカルで解決する。 | `SecretNameChoice`; [値型](/ambercast/ja/spec/value-types/#shared-types) | コミット済みの `SecretRef` |

`stale` はcheckの結果に属するステータスであり、runの結果ステータスではない。healの冪等ターゲットの検査をスキップするのはリストモードのときである。

## 翻訳不変レジストリ {#translation-invariant-registry}

レファレンス全体で翻訳せずに保持するリテラルトークンの索引である。バージョン行の第4列は、そのリリースのリリースコミットに記録された `REPORT_SCHEMA_VERSION` を示す。

| 不変トークン | 規範的定義 | 所有者 | 混同しやすい概念 |
| --- | --- | --- | --- |
| `$id` | `$id` は、生成される各スキーマに公開される JSON Schema の識別子である。 | [JSON スキーマ](/ambercast/ja/reference/json-schemas/#publication-metadata) | 設定の `$schema` |
| `$schema` | `$schema` は設定ファイルが存在する場合の必須識別子フィールドであり、生成されるスキーマにおけるDraft宣言である。 | `RawConfig`; [設定](/ambercast/ja/reference/configuration/#key-table) | `$id` |
| `**` | `**` はパス区切り文字をまたぐ検出用ワイルドカードである。 | マッチャー; [ディスカバリーパターン](/ambercast/ja/reference/discovery-patterns/#pattern-language) | 1セグメントの `*` |
| `--` | `--` はオプション解析を終了し、後続のトークンをリテラルパスとして扱う。 | CLIパーサー; [CLIの概要](/ambercast/ja/reference/cli/overview/#command-flag-matrix) | `--` で始まるファイル名 |
| `--allow-empty` | `--allow-empty` は、このフラグを解析するコマンドにおいて空の選択を許容する。 | CLIパーサー; [CLIの概要](/ambercast/ja/reference/cli/overview/#command-flag-matrix) | `--list` |
| `--allow-headless` | `--allow-headless` は view の非対話拒否を解除する。既に対話端末である場合は no-op である。 | `ambercast view`; [ambercast view](/ambercast/ja/reference/cli/view/#interactive-gate) | 実装済みの `--headed` |
| `--resolve` | `--resolve` は、グラウンディングが不足している場合に run がライブ AI 解決を行うことを明示的に許可する。指定しない場合、run はミスを拒絶する。 | `ambercast run`; [ambercast run](/ambercast/ja/reference/cli/run/#flags) | オフラインテスト検出 |
| `--clear` | `--clear` は計画中（現行版では未実装）であり、現行版で受け入れられるベースラインパーサーセマンティクスはない。 | [ambercast baseline と ambercast restore](/ambercast/ja/reference/cli/baseline-restore/#planned-boundary) | 現行コマンドによるファイル削除 |
| `--config` | `--config` はコマンドローカルのフラグであり、`generate`、`check`、`view` が解析する。 | CLIパーサー; [CLIの概要](/ambercast/ja/reference/cli/overview/#command-flag-matrix) | `AMBERCAST_CONFIG` |
| `--dir` | `--dir` は `ambercast init` がスキャフォールドする先のディレクトリを指定し、`ambercast mcp` ではセッションルートを選ぶ。 | `ambercast init`; [ambercast init](/ambercast/ja/reference/cli/init/#flags); [ambercast mcp](/ambercast/ja/reference/cli/mcp/#flags) | 設定の `testDir` |
| `--dry-run` | `--dry-run` は、generateおよびhealにおいてアーティファクトの書き込みを保留する。 | generate/heal; [ambercast generate](/ambercast/ja/reference/cli/generate/#flags) | `--list` |
| `--force` | `--force` は、実装済みのgenerateコマンドにおいて最新の計画の再利用を無効化する。`ambercast init` では既存の設定ファイルを拒否せず置き換える。 | `ambercast generate`; [ambercast generate](/ambercast/ja/reference/cli/generate/#flags); [ambercast init](/ambercast/ja/reference/cli/init/#flags) | healの `--yes` |
| `--host` | `--host` は view のバインドアドレスを選択する。具体的な IP または `localhost` のみで、ワイルドカードは不可である。 | `ambercast view`; [ambercast view](/ambercast/ja/reference/cli/view/#host-binding) | ターゲットの `baseUrl` |
| `--json` | `--json` はシリアライズされた構造化レポートの出力を選ぶ。`generate`、`run`、`check`、`heal` が受け付ける。 | CLIレンダラー; [レポート](/ambercast/ja/reference/reports/#envelope) | MCP JSON-RPC |
| `--list` | `--list` は `generate`、`run`、`check`、`heal` で解析される。一覧表示の結果セマンティクスは各コマンドのドキュメントが所有する。`init`、`view`、`mcp` は受け付けない。 | CLIパーサー; [CLIの概要](/ambercast/ja/reference/cli/overview/#command-flag-matrix) | `--allow-empty` |
| `--no-reset` | `--no-reset` は計画中（現行版では未実装）であり、現行版で受け入れられる run パーサーセマンティクスはない。 | [ambercast baseline と ambercast restore](/ambercast/ja/reference/cli/baseline-restore/#planned-boundary) | `--force` |
| `--port` | `--port` は view を候補自動増分ではなく単一の厳格なポートに固定する。 | `ambercast view`; [ambercast view](/ambercast/ja/reference/cli/view/#port-selection) | 設定の `viewer.port` |
| `--yes` | `--yes` は、対話的な確認なしでhealの適用を承認し、initの確認プロンプトを省略する。いずれも利用者自身のレビューの代わりにならない。 | `ambercast heal`; [ambercast heal](/ambercast/ja/reference/cli/heal/#flags); [ambercast init](/ambercast/ja/reference/cli/init/#flags) | generateの `--force` |
| `.ambercast.grounding.json` | `.ambercast.grounding.json` は、隣接するグラウンディングコンパニオンの正確なサフィックスである。 | レイアウト解決ツール; [ファイルレイアウト](/ambercast/ja/reference/file-layout/#companions) | 計画のサフィックス |
| `.ambercast.plan.json` | `.ambercast.plan.json` は、隣接する計画コンパニオンの正確なサフィックスである。 | レイアウト解決ツール; [ファイルレイアウト](/ambercast/ja/reference/file-layout/#companions) | グラウンディングのサフィックス |
| `.baseline` | `.baseline` は計画中（現行版では未実装）であり、現行版のレイアウト解決ツールが導出することはない。 | [ambercast baseline と ambercast restore](/ambercast/ja/reference/cli/baseline-restore/#planned-storage-and-freshness) | 実装済みの `.runs` |
| `.runs` | `.runs` はデフォルトの `runsDir` の最終セグメントであり、独立して解決されるルートではない。 | 設定 / [ファイルレイアウト](/ambercast/ja/reference/file-layout/#run-artifacts) | コンパニオンアーティファクト |
| `.test.md` | `.test.md` は、検出されたプロンプトパスがレイアウトマッピングを受け取るために必要な正確なサフィックスである。 | レイアウト解決ツール; [プロンプトファイルのフォーマット](/ambercast/ja/reference/prompt-format/#file-identity) | 任意のMarkdown |
| `0.1.0` | `0.1.0` はリポジトリのチェンジログに記載されている2026-09-03のリリースを示す。 | [変更履歴](/ambercast/ja/reference/changelog/#release-010) | アーティファクトのスキーマバージョン |
| `0.10.0` | `0.10.0` は、このリファレンス群が対象とする現在のパッケージバージョンである。 | パッケージ / [互換性と再生成](/ambercast/ja/reference/compatibility/#compatibility-table) | レポートの `3.11` |
| `2 > 3 > 4 > 1 > 5 > 0` | `2 > 3 > 4 > 1 > 5 > 0` は、最も強い優先度から最も弱い優先度への固定されたプロセス終了コードの優先順位である。 | 終了コードセレクター; [終了コード](/ambercast/ja/reference/exit-codes/#aggregation-priority) | 数値順 |
| `@ambercast-secret` | `@ambercast-secret` は拒否されるレガシープロンプト構文であり、計画 v3 のアーティファクトを再生成する前に除去する必要がある。 | プロンプトパーサー; [シークレットグラントの移行](/ambercast/ja/how-to/upgrade/#migrate-secret-grants) | シークレット参照 |
| `AMBERCAST_AI_PROVIDER` | `AMBERCAST_AI_PROVIDER` は、環境変数によるプロバイダーのオーバーライドを指定する。 | 設定環境変数; [環境変数](/ambercast/ja/reference/environment-variables/#configuration) | CLI `--ai` |
| `AMBERCAST_CONFIG` | `AMBERCAST_CONFIG` は、環境変数による設定ファイルパスのオーバーライドを指定する。 | 設定環境変数; [環境変数](/ambercast/ja/reference/environment-variables/#configuration) | CLI `--config` |
| `AMBERCAST_ENV_*` | `AMBERCAST_ENV_*` はAIプロバイダーの子プロセスから除外される名前空間であり、Ambercastの入力一覧には含まれない。 | 子プロセスランナー; [環境変数](/ambercast/ja/reference/environment-variables/#provider-child-environment) | `AMBERCAST_SECRET_*` |
| `AMBERCAST_SECRET_*` | `AMBERCAST_SECRET_*` はシークレット参照を解決し、AIプロバイダーの子プロセスからは除外される。 | シークレットアダプター / 子プロセスランナー; [環境変数](/ambercast/ja/reference/environment-variables/#secrets) | `AMBERCAST_ENV_*` |
| `CI` | `CI` は、定義されており、空文字でなく、正確に小文字の `false` でない場合にアクティブと判定される。 | 環境情報; [環境変数](/ambercast/ja/reference/environment-variables/#secrets) | 一般的な真偽値（truthy）判定 |
| `CONFIG_INVALID` | `CONFIG_INVALID` は、無効な設定に対する、使用方法エラーを表す構造化コードである。 | レポートスキーマ; [エラーコード](/ambercast/ja/reference/error-codes/#code-vocabulary) | プロセス終了コード2そのもの |
| `FS_IO_ERROR` | `FS_IO_ERROR` は、ファイルシステムI/O障害に対する構造化環境エラーコードである。 | レポートスキーマ; [エラーコード](/ambercast/ja/reference/error-codes/#code-vocabulary) | 拒絶されたアーティファクト全般 |
| `GitHub Security Advisories` | GitHub Security Advisoriesは、非公開の脆弱性報告チャネルである。 | `SECURITY.md`; [セキュリティポリシー](/ambercast/ja/reference/security-policy/#vulnerability-reporting) | 公開issue |
| `GroundingDocument` | `GroundingDocument` は、グラウンディングの `schemaVersion`、`planDigest`、およびエントリを所有する厳格なスキーマである。 | `GroundingDocument`; [グラウンディングドキュメント](/ambercast/ja/spec/grounding-document/) | `PlanDocument` |
| `INTERRUPTED` | `INTERRUPTED` は、中断された実行に対する構造化環境エラーコードである。 | レポートスキーマ; [エラーコード](/ambercast/ja/reference/error-codes/#code-vocabulary) | アサーション失敗 |
| `JSON-RPC` | `JSON-RPC` は実装済み MCP サーバーの stdio メッセージを運ぶ。 | [ambercast mcp](/ambercast/ja/reference/cli/mcp/#usage) | CLI `--json` |
| `PlanDocument` | `PlanDocument` は、計画のバージョン、出所、ターゲット、およびステップを所有する厳格なスキーマである。 | `PlanDocument`; [計画ドキュメント](/ambercast/ja/spec/plan-document/) | `GroundingDocument` |
| `SECRET_REF_PATTERN` | `SECRET_REF_PATTERN` は、`SECRET_REF_SOURCE` から構築される完全一致用の固定正規表現である。 | `SecretRef`; [プロンプトファイルのフォーマット](/ambercast/ja/reference/prompt-format/#secret-references) | アンカーなしの断片 |
| `a11y-neighborhood-v2` | `a11y-neighborhood-v2` は、唯一受け入れられる要素フィンガープリントのアルゴリズムリテラルである。 | `Fingerprint`; [要素フィンガープリント](/ambercast/ja/spec/fingerprint/) | 計画スキーマバージョン2 |
| `ambercast` | `ambercast` はパッケージバイナリ名でありCLIプログラムである。 | パッケージ / CLI概要 | アーティファクトスキーマ |
| `ambercast baseline` | `ambercast baseline` は計画中（現行版では未実装）であり、現行版のパーサーによって拒絶される。 | [ambercast baseline と ambercast restore](/ambercast/ja/reference/cli/baseline-restore/#status) | 実装済みコマンド |
| `ambercast check` | `ambercast check` は実装済みの読み取り専用鮮度確認コマンドである。 | [ambercast check](/ambercast/ja/reference/cli/check/) | `ambercast run` |
| `ambercast generate` | `ambercast generate` は実装済みの計画生成コマンドである。 | [ambercast generate](/ambercast/ja/reference/cli/generate/) | `ambercast run` |
| `ambercast heal` | `ambercast heal` は実装済みの保護されたアーティファクト修復コマンドである。 | [ambercast heal](/ambercast/ja/reference/cli/heal/) | runフォールバック |
| `ambercast init` | `ambercast init` は実装済みで、4つのスキャフォールド用アーティファクトの作成を予定し、既存のものは省略できる。 | [ambercast init](/ambercast/ja/reference/cli/init/#usage) | `ambercast generate` |
| `ambercast mcp` | `ambercast mcp` は実装済みの stdio MCP サーバーを起動する。 | [ambercast mcp](/ambercast/ja/reference/cli/mcp/#usage) | MCPツール名 |
| `ambercast restore` | `ambercast restore` は計画中（現行版では未実装）であり、現行版のパーサーによって拒絶される。 | [ambercast baseline と ambercast restore](/ambercast/ja/reference/cli/baseline-restore/#status) | 実装済みコマンド |
| `ambercast review` | `ambercast review` は計画中（現行版では未実装）である。ランタイムのレポートスキーマに review ブランチが含まれていても同様である。 | [ambercast review](/ambercast/ja/reference/cli/review/#status) | スキーマ上の利用可能性 |
| `ambercast run` | `ambercast run` は実装済みの決定論的な再生コマンドである。 | [ambercast run](/ambercast/ja/reference/cli/run/) | `ambercast generate` |
| `ambercast view` | `ambercast view` は実装済みの読み取り専用ローカル結果ビューアである。 | [ambercast view](/ambercast/ja/reference/cli/view/) | `ambercast run` |
| `ambercast_check` | `ambercast_check` は実装済みの読み取り専用 MCP 鮮度確認ツールである。 | [MCP ツール](/ambercast/ja/reference/mcp-tools/#tool-table) | CLI `ambercast check` |
| `ambercast_generate` | `ambercast_generate` は実装済みの MCP 計画生成ツールである。 | [MCP ツール](/ambercast/ja/reference/mcp-tools/#tool-table) | CLI `ambercast generate` |
| `ambercast_heal` | `ambercast_heal` はプレビューと token 認可による適用を持つ実装済み MCP 修復ツールである。 | [MCP ツール](/ambercast/ja/reference/mcp-tools/#tool-table) | CLI `ambercast heal` |
| `ambercast_job_cancel` | `ambercast_job_cancel` はこのサーバープロセスのジョブの取消を要求する。 | [MCP ツール](/ambercast/ja/reference/mcp-tools/#tool-table) | CLI コマンド |
| `ambercast_job_status` | `ambercast_job_status` はジョブ一覧または単一ジョブの状態と結果を取得する。 | [MCP ツール](/ambercast/ja/reference/mcp-tools/#tool-table) | CLI コマンド |
| `ambercast_review` | `ambercast_review` は将来の MCP ツールであり、実装済みの 6 ツールには含まれない。 | [MCP ツール](/ambercast/ja/reference/mcp-tools/#tool-table) | 計画中の CLI review |
| `ambercast_run` | `ambercast_run` は実装済みの MCP 再生ツールである。 | [MCP ツール](/ambercast/ja/reference/mcp-tools/#tool-table) | CLI `ambercast run` |
| `config.schema.json` | `config.schema.json` は生成される設定JSON Schemaであり、npmのconfig-schemaエクスポート先である。 | [JSON スキーマ](/ambercast/ja/reference/json-schemas/#generated-artifacts) | 設定インスタンス |
| `dryRun` | `dryRun` はCLI/MCPのhealプレビュー要求用の入力フィールドである。完了した `HealResult` は `dryRun` フィールドではなく `application: preview-only` でプレビューを表す。 | heal要求 / [MCP ツール](/ambercast/ja/reference/mcp-tools/#heal-preview-and-apply) | HealResultの表現 |
| `fresh-without-grounding` | `fresh-without-grounding` は、`fresh` とは区別される完了したcheckステータスである。 | check結果; [ambercast check](/ambercast/ja/reference/cli/check/#status-vocabulary) | 欠落している計画 |
| `grounding.schema.json` | `grounding.schema.json` は生成されるグラウンディング用の JSON Schema であり、npmのエクスポート先である。 | [JSON スキーマ](/ambercast/ja/reference/json-schemas/#generated-artifacts) | グラウンディングインスタンス |
| `healReplayIsolation` | `healReplayIsolation` は、heal が計画の参照するすべてのターゲットに対して `idempotent` を要求するターゲットポリシーである。 | ターゲット設定 / heal | ブラウザモード |
| `inputsDigest` | `inputsDigest` は5つの入力からなる計画の出所ダイジェストを記録する。 | `computeInputsDigest`; [鮮度とダイジェスト](/ambercast/ja/spec/freshness/) | `planDigest` |
| `isError` | `isError` は exit code の写像と MCP 固有の失敗によって実装済み MCP ツールの結果を分類する。 | [MCP ツール](/ambercast/ja/reference/mcp-tools/#tool-table) | test-redステータス |
| `outputSchema` | report スキーマが `tools/list` に載せるには大きすぎるため、実装済みの全 MCP ツール定義では `outputSchema` を省略する。 | [MCP ツール](/ambercast/ja/reference/mcp-tools/#tool-table) | 生成されるnpm JSON Schema |
| `plan.schema.json` | `plan.schema.json` は生成される計画用の JSON Schema であり、npmのエクスポート先である。 | [JSON スキーマ](/ambercast/ja/reference/json-schemas/#generated-artifacts) | 計画インスタンス |
| `planDigest` | `planDigest` は、`generatorMeta` を除外した再生関連の計画内容にグラウンディングを紐付ける。 | `computePlanDigest`; [鮮度とダイジェスト](/ambercast/ja/spec/freshness/) | `inputsDigest` |
| `producerBundleFingerprint` | `producerBundleFingerprint` はプロデューサコントラクトの出所を示し、その変更は `inputsDigest` を変化させる。 | generateの出所 / [互換性と再生成](/ambercast/ja/reference/compatibility/#regeneration-boundary) | 要素フィンガープリント |
| `report.json` | `report.json` は呼び出しディレクトリ配下に配置される、run実行時のみ永続化される確定エンベロープである。 | run / [ファイルレイアウト](/ambercast/ja/reference/file-layout/#run-artifacts) | stdoutのエンベロープ |
| `reportPersistence` | `reportPersistence` は、永続化の試行に関するrunエンベロープの状態である。 | runレポート; [レポート](/ambercast/ja/reference/reports/#persistence) | テストステータス |
| `review` | `review` はレポートスキーマのコマンドブランチであり、実装済みCLIコマンドの存在を示すものではない。 | `ReportEnvelope`; [レポート](/ambercast/ja/reference/reports/#result-shapes) | 利用可能なコマンド |
| `schemaVersion` | `schemaVersion` はバージョン管理された計画、グラウンディング、またはレポートコントラクトを識別する。 | IR/レポートスキーマ | パッケージバージョン |
| `stderr` | `stderr` は CLI の使用方法エラー、クラッシュ診断、永続化警告、および MCP 起動ログを出力する。 | CLIランタイム / [ambercast mcp](/ambercast/ja/reference/cli/mcp/#usage) | stdoutの応答 |
| `stdio` | `stdio` は実装済み MCP サーバーのトランスポートである。 | [ambercast mcp](/ambercast/ja/reference/cli/mcp/#usage) | ネットワークポート |
| `stdout` | `stdout` はヘルプ/バージョン情報および完了したコマンドレポートを出力し、プロセスのステータスは個別に割り当てられる。 | CLIランタイム / [レポート](/ambercast/ja/reference/reports/#envelope) | stderrの診断情報 |
| `structuredContent` | `structuredContent` は実装済み MCP 応答で report envelope または Job record を運ぶ。 | [MCP ツール](/ambercast/ja/reference/mcp-tools/#tool-table) | CLI JSONテキスト |
| `testIgnore` | `testIgnore` は包含された相対パスから一致するパスを除外する。 | 検出マッチャー; [ディスカバリーパターン](/ambercast/ja/reference/discovery-patterns/#selection) | `testMatch` |
| `testMatch` | `testMatch` は相対パスに対して少なくとも1つの一致を要求する。 | 検出マッチャー; [ディスカバリーパターン](/ambercast/ja/reference/discovery-patterns/#selection) | `testIgnore` |
| `{{secrets.name}}` | `{{secrets.name}}` は、環境変数のキーに対応する完全一致のシークレット参照の例である。 | `SecretRef`; [プロンプトファイルのフォーマット](/ambercast/ja/reference/prompt-format/#secret-references) | リテラルの認証情報 |

## 関連項目 {#see-also}

- [CLIの概要](/ambercast/ja/reference/cli/overview/)
- [設定](/ambercast/ja/reference/configuration/)
- [レポート](/ambercast/ja/reference/reports/)
- [エラーコード](/ambercast/ja/reference/error-codes/)
- [終了コード](/ambercast/ja/reference/exit-codes/)
- [JSON スキーマ](/ambercast/ja/reference/json-schemas/)
- [環境変数](/ambercast/ja/reference/environment-variables/)
- [MCP ツール](/ambercast/ja/reference/mcp-tools/)
