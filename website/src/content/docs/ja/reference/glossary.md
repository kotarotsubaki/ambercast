---
title: 用語集
description: ambercast全体で使用される用語の規範的定義と、翻訳時に保持すべき不変トークンのレジストリを提供します。
---

ambercast全体で使用される用語の規範的な定義と、ドキュメントの翻訳や各種実装において正確に保持すべき不変トークン（リテラルトークン）の一覧です。各定義は1文の規範的記述として定義されています。フィールド、フラグ、ステータス、エラーコードの詳細な仕様については、各所有ドキュメントのリンク先を参照してください。なお、計画中と記載されたトークンには0.3.1におけるランタイムセマンティクスは存在せず、現時点で利用可能な機能としては提供されません。

## アーティファクトに関する用語 {#artifact-terms}

スキーマおよびリゾルバーに拘束される定義です。

| 用語 | 規範的定義 | 所有スキーマ / コマンド | 混同しやすい概念 |
| --- | --- | --- | --- |
| plan | Planとは、`inputsDigest` に正規化プロンプトの出所を記録し、本体に名前付きターゲットと実行可能ステップを記録する、スキーマに準拠した `PlanDocument` です。 | `PlanDocument`; [計画ドキュメント](/ambercast/ja/spec/plan-document/) | prompt または grounding |
| grounding | Groundingとは、ステップをキーとするエントリを1つのPlanに紐付ける、`planDigest` を備えたスキーマ準拠のPlan単位キャッシュです。 | `GroundingDocument`; [グラウンディングドキュメント](/ambercast/ja/spec/grounding-document/) | Plan または run レポート |
| artifact | アーティファクトとは、ツリー内の `.test.md` プロンプトから派生したコンパニオンであるPlanまたはGroundingです。 | レイアウト解決ツール; [ファイルレイアウト](/ambercast/ja/reference/file-layout/#companions) | runの実行エビデンス |
| fingerprint | フィンガープリントとは、リテラル `a11y-neighborhood-v2` アルゴリズムとSHA-256ハッシュを含む、要素グラウンディングの値です。 | `Fingerprint`; [要素フィンガープリント](/ambercast/ja/spec/fingerprint/) | `planDigest` |
| inputs digest | 入力ダイジェストとは、正規化プロンプト、Planスキーマバージョン、ジェネレーターテンプレートのフィンガープリント、プロデューサバンドルのフィンガープリント、および名前付きターゲットから生成される、出所確認用の標準的なSHA-256ダイジェストです。 | `computeInputsDigest`; [鮮度とダイジェスト](/ambercast/ja/spec/freshness/) | `planDigest` |
| plan digest | プランダイジェストとは、Groundingを紐付けるために使用される、`generatorMeta` を除外したスキーマ準拠Planの標準的なSHA-256ハッシュです。 | `computePlanDigest`; [鮮度とダイジェスト](/ambercast/ja/spec/freshness/) | `inputsDigest` |
| normalized test prompt | 正規化テストプロンプトとは、先頭の最大1つのU+FEFFを除去し、CRLFおよび単独のCRをLFにマッピングしつつ、その他の要素をすべて維持したプロンプトです。 | `normalizeTestMd`; [プロンプトファイルのフォーマット](/ambercast/ja/reference/prompt-format/#normalization-and-grants) | 書式クリーンアップ |

`PlanDocument` および `GroundingDocument` は厳格なランタイムの信頼境界であり、これらからJSON Schemaが導出されます。

## 実行に関する用語 {#execution-terms}

コマンドおよびレポートに拘束される定義です。

| 用語 | 規範的定義 | 所有スキーマ / コマンド | 混同しやすい概念 |
| --- | --- | --- | --- |
| freshness | 鮮度（freshness）とは、実行結果ではなく、Plan/Groundingアーティファクトに対して `check` が報告する出所の状態です。 | `ambercast check`; [鮮度とダイジェスト](/ambercast/ja/spec/freshness/) | runの成功 |
| stale | ステール（stale）とは、鮮度が信頼できないアーティファクトに対して出力される、完了した `check` のステータスです。 | `CompletedCheckResult`; [ambercast check](/ambercast/ja/reference/cli/check/#status-vocabulary) | UIドリフト |
| drift | ドリフト（drift）とは、要素のフィンガープリントを変化させる、要素のアクセシビリティ近傍における局所的な変化です。 | フィンガープリント解決ツール; [要素フィンガープリント](/ambercast/ja/spec/fingerprint/) | ステールなPlanの出所 |
| heal | Healとは、非リストモードにおいてはCIポリシーおよび選択されたターゲットが `idempotent` である場合のみ許可される修復コマンドです。 | `ambercast heal`; [ambercast heal](/ambercast/ja/reference/cli/heal/) | run実行時のグラウンディングフォールバック |
| target | ターゲットとは、明示的、設定上のデフォルト、または唯一設定されたターゲットである場合に選択される、設定済みの名前付きブラウザ接続先です。 | `resolveTarget`; [設定](/ambercast/ja/reference/configuration/#key-table) | プロンプト |
| replay isolation | リプレイ分離（replay isolation）とは、ターゲットポリシーである `healReplayIsolation` を指し、`idempotent` はhealを許可し、`stateful` はhealを拒絶します。 | ターゲット設定 / `ambercast heal` | Planのターゲット定義 |
| report envelope | レポートエンベロープとは、レポート生成コマンドによって返される、バージョン管理されコマンドごとに識別される構造化結果です。 | `ReportEnvelope`; [レポート](/ambercast/ja/reference/reports/#envelope) | 永続化された `report.json` |
| report persistence | レポート永続化（report persistence）とは、確定したエンベロープの書き込みに関する、runエンベロープの状態（`persisted`、`failed`、または `not-attempted`）です。 | runの `ReportEnvelope`; [レポート](/ambercast/ja/reference/reports/#persistence) | セマンティックなテスト結果 |
| secret reference | シークレット参照とは、`SecretRef` で受け入れられる完全一致文字列であり、`secrets.` の後にASCII英数字またはアンダースコアで構成される1つ以上のドット区切りセグメントが続きます。 | `SecretRef`; [プロンプトファイルのフォーマット](/ambercast/ja/reference/prompt-format/#secret-references) | リテラルのシークレット値 |
| secret grant | シークレット付与（secret grant）とは、CommonMarkコード範囲外にある、ソース順で記述された完全な `@ambercast-secret <secret reference>` 行です。 | `extractSecretGrants`; [プロンプトファイルのフォーマット](/ambercast/ja/reference/prompt-format/#normalization-and-grants) | シークレット参照そのもの |

`stale` はcheckの結果に属するステータスであり、runの結果ステータスではありません。また、healの冪等ターゲット検証（idempotent-target check）がスキップされるのはリストモード時のみです。

## 翻訳不変レジストリ {#translation-invariant-registry}

ドキュメント全体において翻訳せず保持すべきトークンの網羅的一覧です。

| 不変トークン | 規範的定義 | 所有者 | 混同しやすい概念 |
| --- | --- | --- | --- |
| `$id` | `$id` はJSON Schemaの識別子用として予約されていますが、生成される0.3.1のスキーマでは設定されていません。 | [JSON スキーマ](/ambercast/ja/reference/json-schemas/#publication-metadata) | 設定の `$schema` |
| `$schema` | `$schema` は設定ファイルが存在する場合の必須識別子フィールドであり、生成されるスキーマにおけるDraft宣言です。 | `RawConfig`; [設定](/ambercast/ja/reference/configuration/#key-table) | `$id` |
| `**` | `**` はパス区切り文字をまたぐ検出用ワイルドカードです。 | マッチャー; [ディスカバリーパターン](/ambercast/ja/reference/discovery-patterns/#pattern-language) | 1セグメントの `*` |
| `--` | `--` はオプション解析を終了し、後続のトークンをリテラルパスとして扱います。 | CLIパーサー; [CLIの概要](/ambercast/ja/reference/cli/overview/#command-flag-matrix) | `--` で始まるファイル名 |
| `--allow-empty` | `--allow-empty` は、このフラグを解析するコマンドにおいて空の選択を許容します。 | CLIパーサー; [CLIの概要](/ambercast/ja/reference/cli/overview/#command-flag-matrix) | `--list` |
| `--allow-headless` | `--allow-headless` は計画中（0.3.1では未実装）であり、受け入れられる0.3.1パーサーセマンティクスはありません。 | [ambercast view](/ambercast/ja/reference/cli/view/#planned-interface) | 実装済みの `--headed` |
| `--cache-only` | `--cache-only` は、runの実行時にグラウンディングのミスが発生した場合にAIフォールバックを呼び出さず拒絶させます。 | `ambercast run`; [ambercast run](/ambercast/ja/reference/cli/run/#flags) | オフラインテスト検出 |
| `--clear` | `--clear` は計画中（0.3.1では未実装）であり、受け入れられる0.3.1ベースラインパーサーセマンティクスはありません。 | [ambercast baseline と ambercast restore](/ambercast/ja/reference/cli/baseline-restore/#planned-boundary) | 現行コマンドによるファイル削除 |
| `--config` | `--config` はコマンドローカルのフラグであり、generateとcheckでのみ解析されます。 | CLIパーサー; [CLIの概要](/ambercast/ja/reference/cli/overview/#command-flag-matrix) | `AMBERCAST_CONFIG` |
| `--dir` | `--dir` は計画中（0.3.1では未実装）であり、受け入れられる0.3.1 initパーサーセマンティクスはありません。 | [ambercast init](/ambercast/ja/reference/cli/init/#planned-interface) | 設定の `testDir` |
| `--dry-run` | `--dry-run` は、generateおよびhealにおいてアーティファクトの書き込みを保留します。 | generate/heal; [ambercast generate](/ambercast/ja/reference/cli/generate/#flags) | `--list` |
| `--force` | `--force` は、実装済みのgenerateコマンドにおいて最新のPlanの再利用を無効化します。 | `ambercast generate`; [ambercast generate](/ambercast/ja/reference/cli/generate/#flags) | healの `--yes` |
| `--host` | `--host` は計画中（0.3.1では未実装）であり、受け入れられる0.3.1 viewerパーサーセマンティクスはありません。 | [ambercast view](/ambercast/ja/reference/cli/view/#undecided-items) | ターゲットの `baseUrl` |
| `--json` | `--json` は、実装済みコマンドの実行完了後にシリアライズされた構造化レポート出力を選択します。 | CLIレンダラー; [レポート](/ambercast/ja/reference/reports/#envelope) | MCP JSON-RPC |
| `--list` | `--list` は実装されているすべてのコマンドで解析されます。一覧表示の結果セマンティクスは各コマンドのドキュメントが所有します。 | CLIパーサー; [CLIの概要](/ambercast/ja/reference/cli/overview/#command-flag-matrix) | `--allow-empty` |
| `--no-reset` | `--no-reset` は計画中（0.3.1では未実装）であり、受け入れられる0.3.1 runパーサーセマンティクスはありません。 | [ambercast baseline と ambercast restore](/ambercast/ja/reference/cli/baseline-restore/#planned-boundary) | `--force` |
| `--port` | `--port` は計画中（0.3.1では未実装）であり、受け入れられる0.3.1 viewerパーサーセマンティクスはありません。 | [ambercast view](/ambercast/ja/reference/cli/view/#planned-interface) | 設定の `viewer.port` |
| `--target` | `--target` は、実装されている各コマンドに対して設定済みの実行ターゲットを指定します。 | CLIパーサー / ターゲット解決ツール; [CLIの概要](/ambercast/ja/reference/cli/overview/#command-flag-matrix) | ターゲット定義そのもの |
| `--yes` | `--yes` は、対話的な確認なしでhealの適用を承認します。 | `ambercast heal`; [ambercast heal](/ambercast/ja/reference/cli/heal/#flags) | generateの `--force` |
| `.ambercast.grounding.json` | `.ambercast.grounding.json` は、隣接するGroundingコンパニオンの正確なサフィックスです。 | レイアウト解決ツール; [ファイルレイアウト](/ambercast/ja/reference/file-layout/#companions) | Planのサフィックス |
| `.ambercast.plan.json` | `.ambercast.plan.json` は、隣接するPlanコンパニオンの正確なサフィックスです。 | レイアウト解決ツール; [ファイルレイアウト](/ambercast/ja/reference/file-layout/#companions) | Groundingのサフィックス |
| `.baseline` | `.baseline` は計画中（0.3.1では未実装）であり、0.3.1のレイアウト解決ツールが導出することはありません。 | [ambercast baseline と ambercast restore](/ambercast/ja/reference/cli/baseline-restore/#planned-storage-and-freshness) | 実装済みの `.runs` |
| `.runs` | `.runs` はデフォルトの `runsDir` の最終セグメントであり、独立して解決されるルートではありません。 | 設定 / [ファイルレイアウト](/ambercast/ja/reference/file-layout/#run-artifacts) | コンパニオンアーティファクト |
| `.test.md` | `.test.md` は、検出されたプロンプトパスがレイアウトマッピングを受け取るために必要な正確なサフィックスです。 | レイアウト解決ツール; [プロンプトファイルのフォーマット](/ambercast/ja/reference/prompt-format/#file-identity) | 任意のMarkdown |
| `0.1.0` | `0.1.0` はリポジトリのチェンジログに記載されている2026-09-03のリリースを示します。 | [変更履歴](/ambercast/ja/reference/changelog/#release-010) | アーティファクトのスキーマバージョン |
| `0.3.1` | `0.3.1` は、このリファレンス群が対象とする現在のパッケージバージョンです。 | パッケージ / [互換性と再生成](/ambercast/ja/reference/compatibility/#compatibility-table) | レポートの `3.0` |
| `2 > 3 > 4 > 1 > 5 > 0` | `2 > 3 > 4 > 1 > 5 > 0` は、最も強い優先度から最も弱い優先度への固定されたプロセス終了コードの優先順位です。 | 終了コードセレクター; [終了コード](/ambercast/ja/reference/exit-codes/#aggregation-priority) | 数値順 |
| `@ambercast-secret` | `@ambercast-secret` は、CommonMarkコード外で完全な付与行を開始します。 | 付与抽出ツール; [プロンプトファイルのフォーマット](/ambercast/ja/reference/prompt-format/#normalization-and-grants) | シークレット参照 |
| `AMBERCAST_AI_PROVIDER` | `AMBERCAST_AI_PROVIDER` は、環境変数によるプロバイダーのオーバーライドを指定します。 | 設定環境変数; [環境変数](/ambercast/ja/reference/environment-variables/#configuration) | CLI `--ai` |
| `AMBERCAST_CONFIG` | `AMBERCAST_CONFIG` は、環境変数による設定ファイルパスのオーバーライドを指定します。 | 設定環境変数; [環境変数](/ambercast/ja/reference/environment-variables/#configuration) | CLI `--config` |
| `AMBERCAST_ENV_*` | `AMBERCAST_ENV_*` はAIプロバイダーの子プロセスから除外される名前空間であり、Ambercastの入力一覧には含まれません。 | 子プロセスランナー; [環境変数](/ambercast/ja/reference/environment-variables/#provider-child-environment) | `AMBERCAST_SECRET_*` |
| `AMBERCAST_SECRET_*` | `AMBERCAST_SECRET_*` はシークレット参照を解決し、AIプロバイダーの子プロセスからは除外されます。 | シークレットアダプター / 子プロセスランナー; [環境変数](/ambercast/ja/reference/environment-variables/#secrets) | `AMBERCAST_ENV_*` |
| `CI` | `CI` は、定義されており、空文字でなく、正確に小文字の `false` でない場合にアクティブと判定されます。 | 環境情報; [環境変数](/ambercast/ja/reference/environment-variables/#secrets) | 一般的な真偽値（truthy）判定 |
| `CONFIG_INVALID` | `CONFIG_INVALID` は、無効な設定に対する構造化使用方法エラーコードです。 | レポートスキーマ; [エラーコード](/ambercast/ja/reference/error-codes/#code-vocabulary) | プロセス終了コード2そのもの |
| `FS_IO_ERROR` | `FS_IO_ERROR` は、ファイルシステムI/O障害に対する構造化環境エラーコードです。 | レポートスキーマ; [エラーコード](/ambercast/ja/reference/error-codes/#code-vocabulary) | 拒絶されたアーティファクト全般 |
| `GitHub Security Advisories` | GitHub Security Advisoriesは、非公開の脆弱性報告チャネルです。 | `SECURITY.md`; [セキュリティポリシー](/ambercast/ja/reference/security-policy/#vulnerability-reporting) | 公開issue |
| `GroundingDocument` | `GroundingDocument` は、Groundingの `schemaVersion`、`planDigest`、およびエントリを所有する厳格なスキーマです。 | `GroundingDocument`; [グラウンディングドキュメント](/ambercast/ja/spec/grounding-document/) | `PlanDocument` |
| `INTERRUPTED` | `INTERRUPTED` は、中断された実行に対する構造化環境エラーコードです。 | レポートスキーマ; [エラーコード](/ambercast/ja/reference/error-codes/#code-vocabulary) | アサーション失敗 |
| `JSON-RPC` | `JSON-RPC` はMCPトランスポート用として計画中（0.3.1では未実装）であり、0.3.1サーバーランタイムはありません。 | [ambercast mcp](/ambercast/ja/reference/cli/mcp/#planned-interface) | CLI `--json` |
| `PlanDocument` | `PlanDocument` は、Planのバージョン、出所、ターゲット、およびステップを所有する厳格なスキーマです。 | `PlanDocument`; [計画ドキュメント](/ambercast/ja/spec/plan-document/) | `GroundingDocument` |
| `SECRET_REF_PATTERN` | `SECRET_REF_PATTERN` は、`SECRET_REF_SOURCE` から構築される完全一致用の固定正規表現です。 | `SecretRef`; [プロンプトファイルのフォーマット](/ambercast/ja/reference/prompt-format/#secret-references) | アンカーなしの断片 |
| `a11y-neighborhood-v2` | `a11y-neighborhood-v2` は、唯一受け入れられる要素フィンガープリントのアルゴリズムリテラルです。 | `Fingerprint`; [要素フィンガープリント](/ambercast/ja/spec/fingerprint/) | Planスキーマバージョン2 |
| `ambercast` | `ambercast` はパッケージバイナリ名でありCLIプログラムです。 | パッケージ / CLI概要 | アーティファクトスキーマ |
| `ambercast baseline` | `ambercast baseline` は計画中（0.3.1では未実装）であり、0.3.1パーサーによって拒絶されます。 | [ambercast baseline と ambercast restore](/ambercast/ja/reference/cli/baseline-restore/#status) | 実装済みコマンド |
| `ambercast check` | `ambercast check` は実装済みの読み取り専用鮮度確認コマンドです。 | [ambercast check](/ambercast/ja/reference/cli/check/) | `ambercast run` |
| `ambercast generate` | `ambercast generate` は実装済みのPlan生成コマンドです。 | [ambercast generate](/ambercast/ja/reference/cli/generate/) | `ambercast run` |
| `ambercast heal` | `ambercast heal` は実装済みの保護されたアーティファクト修復コマンドです。 | [ambercast heal](/ambercast/ja/reference/cli/heal/) | runフォールバック |
| `ambercast init` | `ambercast init` は計画中（0.3.1では未実装）であり、0.3.1パーサーによって拒絶されます。 | [ambercast init](/ambercast/ja/reference/cli/init/#status) | 実装済みコマンド |
| `ambercast mcp` | `ambercast mcp` は計画中（0.3.1では未実装）であり、0.3.1パーサーによって拒絶されます。 | [ambercast mcp](/ambercast/ja/reference/cli/mcp/#status) | MCPツール名 |
| `ambercast restore` | `ambercast restore` は計画中（0.3.1では未実装）であり、0.3.1パーサーによって拒絶されます。 | [ambercast baseline と ambercast restore](/ambercast/ja/reference/cli/baseline-restore/#status) | 実装済みコマンド |
| `ambercast review` | `ambercast review` は計画中（0.3.1では未実装）です（ランタイムレポートスキーマにreviewブランチが含まれている場合でも同様です）。 | [ambercast review](/ambercast/ja/reference/cli/review/#status) | スキーマ上の利用可能性 |
| `ambercast run` | `ambercast run` は実装済みの決定論的リプレイコマンドです。 | [ambercast run](/ambercast/ja/reference/cli/run/) | `ambercast generate` |
| `ambercast view` | `ambercast view` は計画中（0.3.1では未実装）であり、0.3.1パーサーによって拒絶されます。 | [ambercast view](/ambercast/ja/reference/cli/view/#status) | 実装済みコマンド |
| `ambercast_check` | `ambercast_check` は計画中のMCPツールトークンであり、0.3.1サーバーランタイムはありません。 | [MCP ツール](/ambercast/ja/reference/mcp-tools/#tool-table) | CLI `ambercast check` |
| `ambercast_generate` | `ambercast_generate` は計画中のMCPツールトークンであり、0.3.1サーバーランタイムはありません。 | [MCP ツール](/ambercast/ja/reference/mcp-tools/#tool-table) | CLI `ambercast generate` |
| `ambercast_heal` | `ambercast_heal` は計画中のMCPツールトークンであり、0.3.1サーバーランタイムはありません。 | [MCP ツール](/ambercast/ja/reference/mcp-tools/#tool-table) | CLI `ambercast heal` |
| `ambercast_review` | `ambercast_review` は計画中のMCPツールトークンであり、0.3.1サーバーランタイムはありません。 | [MCP ツール](/ambercast/ja/reference/mcp-tools/#tool-table) | 計画中のCLI review |
| `ambercast_run` | `ambercast_run` は計画中のMCPツールトークンであり、0.3.1サーバーランタイムはありません。 | [MCP ツール](/ambercast/ja/reference/mcp-tools/#tool-table) | CLI `ambercast run` |
| `config.schema.json` | `config.schema.json` は生成される設定JSON Schemaであり、npmのconfig-schemaエクスポート先です。 | [JSON スキーマ](/ambercast/ja/reference/json-schemas/#generated-artifacts) | 設定インスタンス |
| `dryRun` | `dryRun` はCLI/MCPのhealプレビュー要求用の入力フィールドです。完了した `HealResult` は `dryRun` フィールドではなく `application: preview-only` でプレビューを表します。 | heal要求 / [MCP ツール](/ambercast/ja/reference/mcp-tools/#heal-safety-default) | HealResultの表現 |
| `fresh-without-grounding` | `fresh-without-grounding` は、`fresh` とは区別される完了したcheckステータスです。 | check結果; [ambercast check](/ambercast/ja/reference/cli/check/#status-vocabulary) | 欠落しているPlan |
| `grounding.schema.json` | `grounding.schema.json` は生成されるGrounding JSON Schemaであり、npmのエクスポート先です。 | [JSON スキーマ](/ambercast/ja/reference/json-schemas/#generated-artifacts) | Groundingインスタンス |
| `healReplayIsolation` | `healReplayIsolation` はhealにおいて `idempotent` の値が要求されるターゲットポリシーです。 | ターゲット設定 / heal | ブラウザモード |
| `inputsDigest` | `inputsDigest` は5つの入力からなるPlanの出所ダイジェストを記録します。 | `computeInputsDigest`; [鮮度とダイジェスト](/ambercast/ja/spec/freshness/) | `planDigest` |
| `isError` | `isError` は計画中のMCP結果分類であり、0.3.1 MCPランタイムセマンティクスはありません。 | [MCP ツール](/ambercast/ja/reference/mcp-tools/#tool-table) | test-redステータス |
| `outputSchema` | `outputSchema` は計画中のMCPスキーマメタデータであり、0.3.1 MCPランタイムセマンティクスはありません。 | [MCP ツール](/ambercast/ja/reference/mcp-tools/#planned-tool-contract) | 生成されるnpm JSON Schema |
| `plan.schema.json` | `plan.schema.json` は生成されるPlan JSON Schemaであり、npmのエクスポート先です。 | [JSON スキーマ](/ambercast/ja/reference/json-schemas/#generated-artifacts) | Planインスタンス |
| `planDigest` | `planDigest` は、`generatorMeta` を除外したリプレイ関連のPlan内容にGroundingを紐付けます。 | `computePlanDigest`; [鮮度とダイジェスト](/ambercast/ja/spec/freshness/) | `inputsDigest` |
| `producerBundleFingerprint` | `producerBundleFingerprint` はプロデューサコントラクトの出所を示し、その変更は `inputsDigest` を変化させます。 | generateの出所 / [互換性と再生成](/ambercast/ja/reference/compatibility/#regeneration-boundary) | 要素フィンガープリント |
| `report.json` | `report.json` は呼び出しディレクトリ配下に配置される、run実行時のみ永続化される確定エンベロープです。 | run / [ファイルレイアウト](/ambercast/ja/reference/file-layout/#run-artifacts) | stdoutのエンベロープ |
| `reportPersistence` | `reportPersistence` は、永続化の試行に関するrunエンベロープの状態です。 | runレポート; [レポート](/ambercast/ja/reference/reports/#persistence) | テストステータス |
| `review` | `review` はレポートスキーマのコマンドブランチであり、実装済みCLIコマンドの存在を示すものではありません。 | `ReportEnvelope`; [レポート](/ambercast/ja/reference/reports/#result-shapes) | 利用可能なコマンド |
| `schemaVersion` | `schemaVersion` はバージョン管理されたPlan、Grounding、またはレポートコントラクトを識別します。 | IR/レポートスキーマ | パッケージバージョン |
| `stderr` | `stderr` は成功したレポート出力ではなく、CLIの使用方法エラー、クラッシュ診断、永続化警告を出力します。 | CLIランタイム / [ambercast mcp](/ambercast/ja/reference/cli/mcp/#planned-interface) | stdoutの応答 |
| `stdio` | `stdio` は計画中のMCPトランスポートであり、0.3.1サーバーランタイムはありません。 | [ambercast mcp](/ambercast/ja/reference/cli/mcp/#planned-interface) | ネットワークポート |
| `stdout` | `stdout` はヘルプ/バージョン情報および完了したコマンドレポートを出力し、プロセスのステータスは個別に割り当てられます。 | CLIランタイム / [レポート](/ambercast/ja/reference/reports/#envelope) | stderrの診断情報 |
| `structuredContent` | `structuredContent` は計画中のMCP結果ペイロードであり、0.3.1 MCPランタイムセマンティクスはありません。 | [MCP ツール](/ambercast/ja/reference/mcp-tools/#planned-tool-contract) | CLI JSONテキスト |
| `testIgnore` | `testIgnore` は包含された相対パスから一致するパスを除外します。 | 検出マッチャー; [ディスカバリーパターン](/ambercast/ja/reference/discovery-patterns/#selection) | `testMatch` |
| `testMatch` | `testMatch` は相対パスに対して少なくとも1つの一致を要求します。 | 検出マッチャー; [ディスカバリーパターン](/ambercast/ja/reference/discovery-patterns/#selection) | `testIgnore` |
| `{{secrets.name}}` | `{{secrets.name}}` は、環境変数のキーに対応する完全一致のシークレット参照の例です。 | `SecretRef`; [プロンプトファイルのフォーマット](/ambercast/ja/reference/prompt-format/#secret-references) | リテラルの認証情報 |

関連リンク: [CLIの概要](/ambercast/ja/reference/cli/overview/), [設定](/ambercast/ja/reference/configuration/), [レポート](/ambercast/ja/reference/reports/), [エラーコード](/ambercast/ja/reference/error-codes/), [終了コード](/ambercast/ja/reference/exit-codes/), [JSON スキーマ](/ambercast/ja/reference/json-schemas/), [環境変数](/ambercast/ja/reference/environment-variables/), [MCP ツール](/ambercast/ja/reference/mcp-tools/)
